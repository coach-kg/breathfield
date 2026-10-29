// Heart-rhythm coherence from inter-beat intervals (IBIs).
//
// Follows the method HeartMath describes publicly: take the most recent
// 64 seconds of IBIs, recompute every 5 seconds, build a power spectrum,
// find the dominant peak between 0.04 and 0.26 Hz and compare the power in
// that peak with the power in the rest of the spectrum.
//
//   ratio = peakPower / (totalPower - peakPower)
//   score = 100 * peakPower / totalPower     (0..100, same ordering as ratio)
//
// This is a transparent reimplementation, not HeartMath's code, so numbers
// will be close to emWave's but not identical.

export const WINDOW_SEC = 64;
export const STEP_SEC = 5;
export const MIN_SEC = 30;          // first score after 30 s of clean beats
export const FS = 2;                // resample the tachogram at 2 Hz
export const N = WINDOW_SEC * FS;   // 128 samples, 1/64 Hz resolution
export const PEAK_BAND = [0.04, 0.26];
export const TOTAL_BAND = [0.0033, 0.4];
export const PEAK_HALF_WIDTH = 0.015; // peak = ±0.015 Hz around the maximum

const IBI_MIN = 300, IBI_MAX = 2000;  // 30–200 bpm

/** In-place radix-2 FFT. re/im are Float64Arrays of equal power-of-two length. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/**
 * Resample beats onto an even FS grid ending at tEnd.
 * beats: [{t: seconds, ibi: ms}] sorted by t, already cleaned.
 * Returns Float64Array of length n (zero-padded at the start if short) and
 * the number of real samples.
 */
export function resample(beats, tEnd, n = N, fs = FS) {
  const out = new Float64Array(n);
  const t0 = tEnd - (n - 1) / fs;
  let k = 0, real = 0;
  const first = beats[0].t;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / fs;
    if (t < first) continue;
    while (k < beats.length - 2 && beats[k + 1].t < t) k++;
    const a = beats[k], b = beats[Math.min(k + 1, beats.length - 1)];
    const span = b.t - a.t;
    const u = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
    out[i] = a.ibi + (b.ibi - a.ibi) * u;
    real++;
  }
  return { samples: out, real };
}

/** Coherence of a tachogram window. Returns {ratio, score, peakHz, power}. */
export function spectrumCoherence(samples, real, fs = FS) {
  const n = samples.length;
  const start = n - real;
  // Linear detrend over the real part, Hann window over the real part.
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < real; i++) {
    const y = samples[start + i];
    sx += i; sy += y; sxx += i * i; sxy += i * y;
  }
  const den = real * sxx - sx * sx || 1;
  const slope = (real * sxy - sx * sy) / den;
  const icpt = (sy - slope * sx) / real;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < real; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (real - 1));
    re[start + i] = (samples[start + i] - (icpt + slope * i)) * w;
  }
  fft(re, im);
  const df = fs / n;
  const power = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];

  const bin = (f) => Math.round(f / df);
  let pk = bin(PEAK_BAND[0]);
  for (let i = pk; i <= bin(PEAK_BAND[1]); i++) if (power[i] > power[pk]) pk = i;
  const hw = Math.max(1, Math.round(PEAK_HALF_WIDTH / df));
  let peak = 0, total = 0;
  for (let i = bin(TOTAL_BAND[0]); i <= bin(TOTAL_BAND[1]); i++) {
    total += power[i];
    if (Math.abs(i - pk) <= hw) peak += power[i];
  }
  if (total <= 0) return { ratio: 0, score: 0, peakHz: pk * df, power };
  const rest = Math.max(total - peak, 1e-9);
  return { ratio: peak / rest, score: (100 * peak) / total, peakHz: pk * df, power };
}

/**
 * Streaming engine. Feed beats as they arrive; call update(now) as often as
 * you like, a new score appears every STEP_SEC once MIN_SEC of data exists.
 */
export class CoherenceEngine {
  constructor() { this.reset(); }

  reset() {
    this.beats = [];          // clean beats only
    this.recent = [];         // last accepted IBIs, for artifact rejection
    this.lastCompute = -Infinity;
    this.latest = null;
    this.artifacts = 0;
    this.accepted = 0;
  }

  /** t: seconds (beat time), ibi: ms. Returns true if accepted. */
  addBeat(t, ibi) {
    if (!(ibi >= IBI_MIN && ibi <= IBI_MAX)) { this.artifacts++; return false; }
    if (this.recent.length >= 5) {
      const med = [...this.recent].sort((a, b) => a - b)[this.recent.length >> 1];
      if (Math.abs(ibi - med) / med > 0.3) {
        this.artifacts++;
        // Let a sustained shift through: after 3 rejects in a row, re-seed.
        this._rejectRun = (this._rejectRun || 0) + 1;
        if (this._rejectRun < 3) return false;
        this.recent = [];
      }
    }
    this._rejectRun = 0;
    this.recent.push(ibi);
    if (this.recent.length > 7) this.recent.shift();
    this.beats.push({ t, ibi });
    this.accepted++;
    const cut = t - WINDOW_SEC - 10;
    while (this.beats.length && this.beats[0].t < cut) this.beats.shift();
    return true;
  }

  /** Heart rate (bpm) from the last ~5 beats. */
  heartRate() {
    const b = this.beats.slice(-5);
    if (!b.length) return null;
    return 60000 / (b.reduce((s, x) => s + x.ibi, 0) / b.length);
  }

  /** Returns a fresh result when one was computed this call, else null. */
  update(now) {
    if (now - this.lastCompute < STEP_SEC) return null;
    const usable = this.beats.filter((b) => b.t >= now - WINDOW_SEC);
    if (usable.length < 4 || now - usable[0].t < MIN_SEC) return null;
    // Also require that the stream is live (a beat within the last 4 s).
    if (now - usable[usable.length - 1].t > 4) return null;
    this.lastCompute = now;
    const { samples, real } = resample(usable, now, N, FS);
    const r = spectrumCoherence(samples, real, FS);
    this.latest = { t: now, score: r.score, ratio: r.ratio, peakHz: r.peakHz, hr: this.heartRate() };
    return this.latest;
  }
}
