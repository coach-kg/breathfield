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
  /** deviceId: a specific camera; otherwise the browser's default back camera. */
  constructor({ deviceId } = {}) {
    super('camera', 'Fingertip on camera');
    this.kind = 'sensor';
    this.deviceId = deviceId || null;
    this.lag = 0.05; // beats are found live, so the beat light can follow almost at once
  }

  static support() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return 'This browser has no camera access.';
    return null;
  }

  async connect() {
    this.status('Allow camera access…');
    const video = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } };
    if (this.deviceId) video.deviceId = { exact: this.deviceId };
    else video.facingMode = { ideal: 'environment' };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    this.track = this.stream.getVideoTracks()[0];
    this.torch = false;
    this.torchSupported = false;
    try {
      const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
      this.torchSupported = !!caps.torch;
      if (caps.torch) { await this.track.applyConstraints({ advanced: [{ torch: true }] }); this.torch = true; }
    } catch (e) { /* no light control */ }
    // Which lens is this, and which others are there? (labels are readable once access is granted)
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.cameras = all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      this.current = (this.track.getSettings && this.track.getSettings().deviceId) || this.deviceId;
      const cur = this.cameras.find((c) => c.id === this.current);
      this.lens = cur ? cur.label : this.track.label;
    } catch (e) { this.cameras = []; }

    const v = document.createElement('video');
    v.playsInline = true; v.muted = true; v.srcObject = this.stream;
    v.className = 'campreview';
    v.setAttribute('aria-label', 'Camera preview');
    await v.play();
    this.video = v;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 32; this.canvas.height = 24;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.detector = new BeatDetector({ invert: true });
    this.finger = false;
    this.running = true;
    this.status(this.torch
      ? 'Light on. Rest your fingertip gently over the lens and the light.'
      : this.torchSupported
        ? 'Could not switch the light on. Cover the lens with your fingertip and hold the phone toward a bright lamp.'
        : 'This browser cannot switch the phone light on (Firefox cannot; Chrome and Samsung Internet can). Cover the lens and hold the phone toward a bright lamp.', this.torch ? 'busy' : 'warn');
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
        if (finger) this.status(`Finger detected${this.torch ? '' : ' (no light)'}. Hold still and relax your hand…`, 'on');
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
