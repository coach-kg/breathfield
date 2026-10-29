// Fingertip on the phone camera (photoplethysmography).
//
// Each heartbeat pushes a little more blood into the fingertip, which makes
// it slightly darker to the camera. We average the red channel of every frame
// and find the beats in that signal.
//
// Works best on a phone's back camera with the flashlight on (Android Chrome
// can switch the light on; iPhone Safari cannot, so hold your fingertip over
// the lens facing a bright lamp or window). Keep the finger still and the
// pressure light. A laptop webcam is much less reliable.

import { Device } from './device.js';
import { BeatDetector } from './ppg.js';

export class CameraPpg extends Device {
  constructor() {
    super('camera', 'Fingertip on camera');
    this.kind = 'sensor';
  }

  static support() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return 'This browser has no camera access.';
    return null;
  }

  async connect() {
    this.status('Allow camera access…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } },
    });
    this.track = this.stream.getVideoTracks()[0];
    this.torch = false;
    try {
      const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
      if (caps.torch) { await this.track.applyConstraints({ advanced: [{ torch: true }] }); this.torch = true; }
    } catch (e) { /* no light control */ }

    const v = document.createElement('video');
    v.playsInline = true; v.muted = true; v.srcObject = this.stream;
    await v.play();
    this.video = v;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 32; this.canvas.height = 24;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.detector = new BeatDetector({ invert: true });
    this.finger = false;
    this.running = true;
    this.status(this.torch ? 'Cover the camera and the light with your fingertip.' : 'Cover the camera with your fingertip and face a bright light.', 'busy');
    this.loop();
  }

  loop() {
    if (!this.running) return;
    const v = this.video;
    const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback((now) => this.frame(now)) : requestAnimationFrame((now) => this.frame(now)));
    this._next = next;
    next();
  }

  frame(nowMs) {
    if (!this.running) return;
    const t = nowMs / 1000;
    try {
      this.ctx.drawImage(this.video, 0, 0, 32, 24);
      const px = this.ctx.getImageData(0, 0, 32, 24).data;
      let r = 0, g = 0;
      for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; }
      const n = px.length / 4; r /= n; g /= n;
      const finger = r > 60 && r > g * 1.8;
      if (finger !== this.finger) {
        this.finger = finger;
        if (finger) this.status('Finger detected. Hold still…', 'on');
        else { this.status('Place your fingertip over the camera.', 'warn'); this.detector.reset(); }
      }
      if (finger) {
        this.emit('pulse', { t, v: -r });
        const beat = this.detector.push(t, r);
        if (beat) this.emit('beat', beat);
      }
    } catch (e) { /* frame not ready */ }
    this._next();
  }

  async disconnect() {
    this.running = false;
    try {
      if (this.torch) await this.track.applyConstraints({ advanced: [{ torch: false }] });
    } catch (e) { /* ignore */ }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.status('Camera off', 'off');
  }
}
