// Finding your resonance pace.
//
// Each person's heart rate swings most when they breathe at their own
// resonance rate, usually between 4.5 and 6.5 breaths a minute (taller
// people and slower hearts tend to sit lower). The clinical method (Lehrer
// and colleagues) paces 6.5, 6, 5.5, 5 and 4.5 breaths a minute for two
// minutes each and compares the heart-rate swings. Without a breathing belt
// we use the pacer as the breath, which works as long as you follow it.
//
// Per rate, from the last 90 seconds of each block (the first 30 settle in):
//   amp    peak-to-trough of the heart-rate wave at the breathing rate (bpm)
//   maxMin average of max − min heart rate within each breath (bpm)
//   fit    share of the heart-rate variation that is that one wave (0..1)
//   phase  when heart rate peaks relative to the end of the in-breath (degrees;
//          about 0 at resonance, positive = later, negative = earlier)
// The rate with the best combination wins; amplitude counts most.

export const TEST_RATES = [6.5, 6, 5.5, 5, 4.5];
export const BLOCK_SEC = 120;
export const SETTLE_SEC = 30;

const TAU = Math.PI * 2;

/**
 * beats: [[t, ibiMs]] with t in seconds since the block's pacer started (breathing in at t = 0).
 * rate: breaths a minute of an even in/out pacer. Returns null if there is too little data.
 */
export function analyseBlock(beats, rate, { from = SETTLE_SEC, to = BLOCK_SEC } = {}) {
  // An interval belongs to the middle of the beat-to-beat span it measures, not its end.
  const use = beats.map(([tb, ibi]) => [tb - ibi / 2000, ibi]).filter(([t]) => t >= from - 3 && t <= to + 3).sort((a, b) => a[0] - b[0]);
  const span = to - from;
  if (use.length < span * 0.6 || use[0][0] > from + 5 || use[use.length - 1][0] < to - 5) return null;
  const fs = 4, n = Math.floor(span * fs);
  const w = (TAU * rate) / 60;
  const t = new Float64Array(n), hr = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const tt = from + i / fs;
    while (k < use.length - 2 && use[k + 1][0] < tt) k++;
    const [t0, i0] = use[k], [t1, i1] = use[Math.min(k + 1, use.length - 1)];
    const u = t1 > t0 ? Math.min(1, Math.max(0, (tt - t0) / (t1 - t0))) : 0;
    t[i] = tt; hr[i] = 60000 / (i0 + (i1 - i0) * u);
  }
  // Least squares: hr ≈ c0 + c1·t + a·cos(wt) + b·sin(wt)
  const cols = [(i) => 1, (i) => t[i] - from - span / 2, (i) => Math.cos(w * t[i]), (i) => Math.sin(w * t[i])];
  const A = cols.map(() => new Float64Array(4)), y = new Float64Array(4);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 4; r++) {
      const vr = cols[r](i);
      y[r] += vr * hr[i];
      for (let c = 0; c < 4; c++) A[r][c] += vr * cols[c](i);
    }
  }
  const [c0, c1, a, b] = solve4(A, y);
  let ssTrend = 0, ssWave = 0;
  for (let i = 0; i < n; i++) {
    const trend = c0 + c1 * (t[i] - from - span / 2);
    const wave = a * Math.cos(w * t[i]) + b * Math.sin(w * t[i]);
    ssTrend += (hr[i] - trend) ** 2;
    ssWave += (hr[i] - trend - wave) ** 2;
  }
  const fit = ssTrend > 0 ? Math.max(0, 1 - ssWave / ssTrend) : 0;
  const amp = 2 * Math.hypot(a, b);
  // hr wave = R·cos(wt − φ) peaks at wt = φ; the pacer's in-breath ends at wt = π.
  let phase = (Math.atan2(b, a) - Math.PI) * (180 / Math.PI);
  phase = ((phase + 540) % 360) - 180;
  // max − min inside each whole breath
  const cyc = 60 / rate, swings = [];
  for (let c0t = Math.ceil(from / cyc) * cyc; c0t + cyc <= to; c0t += cyc) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) if (t[i] >= c0t && t[i] < c0t + cyc) { lo = Math.min(lo, hr[i]); hi = Math.max(hi, hr[i]); }
    if (hi > lo) swings.push(hi - lo);
  }
  const maxMin = swings.length ? swings.reduce((s, x) => s + x, 0) / swings.length : 0;
  const meanHr = 60000 / (use.reduce((s, x) => s + x[1], 0) / use.length);
  return { rate, amp: round(amp, 2), maxMin: round(maxMin, 2), fit: round(fit, 3), phase: Math.round(phase), meanHr: round(meanHr, 1), beats: use.length };
}

/** Rank the rates. Returns { best, ranked: [{rate, score}], edge, close } or null. */
export function pickResonance(results) {
  const ok = results.filter(Boolean);
  if (ok.length < 3) return null;
  const maxAmp = Math.max(...ok.map((r) => r.amp)) || 1;
  const maxMM = Math.max(...ok.map((r) => r.maxMin)) || 1;
  const ranked = ok.map((r) => ({
    rate: r.rate,
    score: round(0.4 * (r.amp / maxAmp) + 0.25 * (r.maxMin / maxMM) + 0.2 * r.fit + 0.15 * (1 - Math.abs(r.phase) / 180), 3),
  })).sort((x, y) => y.score - x.score);
  const best = ranked[0].rate;
  const rates = ok.map((r) => r.rate);
  return {
    best,
    ranked,
    edge: best === Math.max(...rates) || best === Math.min(...rates), // the true pace may lie beyond the tested range
    close: ranked.length > 1 && ranked[0].score - ranked[1].score < 0.04 ? ranked[1].rate : null,
  };
}

/** An even pacer for a rate, or a slightly longer exhale (45 : 55). Seconds, rounded to 0.1. */
export function paceFor(rate, longerOut = false) {
  const cyc = 60 / rate;
  const inS = Math.round((longerOut ? cyc * 0.45 : cyc / 2) * 10) / 10;
  return { inS, holdIn: 0, outS: Math.round((cyc - inS) * 10) / 10, holdOut: 0 };
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

function solve4(A, y) {
  const M = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[4] / (row[i] || 1e-12));
}
