// Pulse wave → heart beats. Used by the fingertip camera, and by the emWave
// adapter if its USB stream turns out to carry the raw pulse wave.

export class BeatDetector {
  /** invert: true when systole makes the signal go down (camera red channel). */
  constructor({ invert = false } = {}) {
    this.invert = invert;
    this.reset();
  }

  reset() {
    this.base = null;
    this.y = [0, 0, 0];
    this.t = [0, 0, 0];
    this.amp = 0;
    this.lastBeat = null;
    this.prevT = null;
    this.filtered = 0;
  }

  /** Feed one sample. Returns {t, ibi} when a beat completes an interval. */
  push(t, value) {
    const v = this.invert ? -value : value;
    const dt = this.prevT == null ? 1 / 30 : Math.max(1e-3, t - this.prevT);
    this.prevT = t;
    if (this.base == null) this.base = v;
    this.base += (v - this.base) * Math.min(1, dt / 0.75);   // ~0.2 Hz high-pass
    const hp = v - this.base;
    this.filtered += (hp - this.filtered) * Math.min(1, dt / 0.05); // ~3 Hz low-pass
    this.y.shift(); this.y.push(this.filtered);
    this.t.shift(); this.t.push(t);
    this.amp *= Math.pow(0.5, dt / 4);                        // forget amplitude over ~4 s

    const [a, b, c] = this.y;
    if (!(b > a && b >= c && b > 0)) return null;
    if (b < this.amp * 0.5) return null;
    // Parabolic interpolation gives sub-frame beat timing.
    const den = a - 2 * b + c;
    const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    const step = (this.t[2] - this.t[0]) / 2;
    const tp = this.t[1] + off * step;
    if (this.lastBeat != null && tp - this.lastBeat < 0.33) return null;
    this.amp = this.amp ? this.amp + (b - this.amp) * 0.25 : b;
    const prev = this.lastBeat;
    this.lastBeat = tp;
    if (prev == null) return null;
    return { t: tp, ibi: (tp - prev) * 1000 };
  }
}
