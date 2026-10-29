// Two heartbeat sources that need no sensor.
//
// Practice: you hold the space bar (or press and hold the screen) while you
// breathe in and let go while you breathe out. Heart rate follows your key
// the way it follows a real breath, so following the pacer evenly produces a
// clean slow rhythm and real coherence from the same engine.
//
// Demo: a pretend person whose rhythm locks onto the pacer over a few
// minutes, with some wandering. Handy for trying scenes and sounds.

import { Device } from './device.js';

class BeatSynth extends Device {
  constructor(id, label, hrAt) {
    super(id, label);
    this.hrAt = hrAt;
  }

  async connect() {
    const now = performance.now() / 1000;
    this.next = now + 0.8;
    this.t0 = now;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 100);
    this.ready();
  }

  ready() {}

  tick() {
    const now = performance.now() / 1000;
    // Catch up after a background tab, but never emit a flood.
    if (now - this.next > 5) this.next = now;
    while (this.next <= now) {
      const hr = Math.max(40, Math.min(150, this.hrAt(this.next, this.next - this.t0)));
      const ibi = 60000 / hr;
      this.next += ibi / 1000;
      this.emit('beat', { t: this.next, ibi });
    }
  }

  async disconnect() {
    clearInterval(this.timer);
    this.status('Stopped', 'off');
  }
}

export class PracticeKeys extends BeatSynth {
  /** app: {holding(): bool, lastInput(): seconds} */
  constructor(app) {
    let level = 0, wander = 0, prev = null;
    super('practice', 'Practice without a sensor', (t) => {
      const dt = prev == null ? 0.8 : Math.min(2, t - prev);
      prev = t;
      const idle = performance.now() / 1000 - app.lastInput() > 20;
      const target = idle ? 0 : app.holding() ? 1 : -1;
      level += (target - level) * Math.min(1, dt / 1.6);
      wander += (Math.random() - 0.5) * 1.6 * dt;
      wander *= Math.pow(0.6, dt);
      return 66 + 7 * level + wander + (idle ? 3 * Math.sin(t * 0.7) * Math.sin(t * 0.23) : 0);
    });
    this.kind = 'practice';
  }
  ready() { this.status('Hold space or press and hold the screen while you breathe in.', 'on'); }
}

export class DemoSensor extends BeatSynth {
  /** app: {breath(): 0..1 breath depth from the pacer} */
  constructor(app) {
    let wander = 0, prev = null, drift = 0;
    super('demo', 'Demo signal', (t, since) => {
      const dt = prev == null ? 0.8 : Math.min(2, t - prev);
      prev = t;
      const lock = Math.min(1, since / 150);
      drift += (Math.random() - 0.5) * 0.08 * dt; drift = Math.max(-0.35, Math.min(0.35, drift * 0.995));
      const amp = 2 + 6 * Math.max(0, lock + drift);
      wander += (Math.random() - 0.5) * (4.5 - 3 * lock) * dt;
      wander *= Math.pow(0.7, dt);
      return 66 + amp * (app.breath() - 0.5) * 2 + wander;
    });
    this.kind = 'demo';
  }
  ready() { this.status('Demo signal: a pretend heart that settles into the pacer over a few minutes.', 'on'); }
}
