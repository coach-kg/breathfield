// Sound that changes with you instead of announcing you.
//
// No dings when you go up a level and no bloops when you drop. A low drone
// breathes with the pacer (its filter opens as you breathe in). As coherence
// rises, a fifth fades in underneath, then a soft major chord shimmers on
// top. Layers arrive over a few seconds and leave even more slowly, so a dip
// sounds like the room getting a little quieter, nothing more.
//
// Zone cues are separate and optional: soft sine bells in the drone's key
// (A major pentatonic). Up a zone: a rising pair or a slow three-note rise.
// Down: one quiet falling pair. A minute held: a warm chord swell in high, a
// single note in medium. Every 100 glow points: a high shimmer. Low zones
// never get a sound of their own.

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Drone {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.volume = 0.6;
  }

  /** Create the audio graph without making the drone audible (needs a user gesture first). */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain(); this.master.gain.value = 0;
      this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 400; this.filter.Q.value = 3;
      this.filter.connect(this.master); this.master.connect(ctx.destination);
      const layer = (notes, dest = this.filter) => {
        const g = ctx.createGain(); g.gain.value = 0; g.connect(dest);
        const oscs = notes.map(([f, type, amp]) => {
          const o = ctx.createOscillator(), a = ctx.createGain();
          o.type = type; o.frequency.value = f; a.gain.value = amp;
          o.connect(a); a.connect(g); o.start();
          return o;
        });
        return { g, oscs };
      };
      this.root = layer([[55, 'sine', 0.55], [110, 'triangle', 0.2], [110.4, 'sine', 0.16]]);
      this.fifth = layer([[82.41, 'sine', 0.35], [164.81, 'triangle', 0.1]]);
      // Slow shimmer on the top layer: its gain swings between 0.5 and 1.
      const shimmer = ctx.createGain(); shimmer.gain.value = 0.75; shimmer.connect(this.filter);
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 0.13; depth.gain.value = 0.25;
      lfo.connect(depth); depth.connect(shimmer.gain); lfo.start();
      this.chord = layer([[220, 'sine', 0.09], [277.18, 'sine', 0.07], [329.63, 'sine', 0.07], [440, 'sine', 0.035]], shimmer);
      this.root.g.gain.value = 1;
      this.cueOut = ctx.createGain(); this.cueOut.gain.value = 1;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      this.cueOut.connect(lp); lp.connect(ctx.destination);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  start() {
    this.ensure();
    this.on = true;
  }

  /** A soft bell: sine plus a faint octave, slow attack, long fade. */
  bell(freq, when, amp, attack = 0.06, decay = 2.6) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.cueOut);
    for (const [mul, a] of [[1, 1], [2, 0.18], [3.01, 0.05]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq * mul; og.gain.value = a;
      o.connect(og); og.connect(g);
      o.start(t); o.stop(t + attack + decay + 0.1);
    }
  }

  /** type: up | down | held | milestone. level: 0..1 loudness from the setting. */
  cue(type, { to = 1, zone = 1, level = 0.5 } = {}) {
    if (!level || !this.ctx || this.ctx.state !== 'running') return;
    const v = 0.11 * level * (0.4 + 0.6 * this.volume);
    if (type === 'up') {
      const notes = to >= 2 ? [440, 554.37, 659.25] : [329.63, 440];
      notes.forEach((f, i) => this.bell(f, i * 0.22, v * (1 - i * 0.12)));
    } else if (type === 'down') {
      [329.63, 277.18].forEach((f, i) => this.bell(f, i * 0.3, v * 0.55, 0.08, 2));
    } else if (type === 'held') {
      if (zone >= 2) [220, 277.18, 329.63, 440].forEach((f, i) => this.bell(f, i * 0.05, v * 0.55, 1.2, 3.5));
      else this.bell(329.63, 0, v * 0.6, 0.5, 3);
    } else if (type === 'milestone') {
      [880, 1318.5].forEach((f, i) => this.bell(f, i * 0.35, v * 0.45, 0.3, 3.2));
    }
  }

  stop() { this.on = false; }

  /** b: breath 0..1, level: smoothed coherence 0..1 (null when unknown). */
  update(b, level) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const lv = level == null ? 0.3 : level;
    this.master.gain.setTargetAtTime(this.on ? this.volume * (0.12 + 0.06 * b) : 0, t, this.on ? 0.6 : 1.2);
    this.filter.frequency.setTargetAtTime(200 + 1400 * b * (0.55 + 0.45 * lv), t, 0.25);
    const ramp = (gainNode, target) => {
      const rising = target > gainNode.value;
      gainNode.setTargetAtTime(target, t, rising ? 2.5 : 6);
    };
    ramp(this.fifth.g.gain, smooth(0.3, 0.5, lv));
    ramp(this.chord.g.gain, 0.8 * smooth(0.62, 0.85, lv));
    // A little beating in the root when scattered, pure when settled.
    this.root.oscs[2].detune.setTargetAtTime((1 - lv) * 14, t, 1.5);
  }
}
