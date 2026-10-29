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

  /** Open one camera (or the default back camera) and find out what it can do. */
  async openStream(id) {
    const video = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } };
    if (id) video.deviceId = { exact: id };
    else video.facingMode = { ideal: 'environment' };
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    this.track = this.stream.getVideoTracks()[0];
    this.torch = false;
    this.torchSupported = false;
    this.torchNote = '';
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.cameras = all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    } catch (e) { this.cameras = this.cameras || []; }
    this.current = (this.track.getSettings && this.track.getSettings().deviceId) || id;
    const cur = (this.cameras || []).find((c) => c.id === this.current);
    this.lens = cur ? cur.label : this.track.label;
    const facing = this.track.getSettings ? this.track.getSettings().facingMode : '';
    this.front = facing === 'user' || /front|user|facetime/i.test(this.lens || '');
    if (!this.video) {
      const v = document.createElement('video');
      v.playsInline = true; v.muted = true;
      v.className = 'campreview';
      v.setAttribute('aria-label', 'Camera preview');
      this.video = v;
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    // Some Android browsers only report the flashlight once the camera is
    // running, or after ImageCapture has looked at it. Ask both ways.
    await new Promise((r) => setTimeout(r, 400));
    await this.detectTorch();
  }

  async connect() {
    this.status('Allow camera access…');
    await this.openStream(this.deviceId);
    // On most phones only the main back lens owns the flashlight. When no lens
    // was chosen and this one has no light, try the other back lenses.
    if (!this.deviceId && !this.front && !this.torchSupported) {
      const first = this.current;
      const backs = (this.cameras || []).filter((c) => c.id !== first && !/front|user|facetime/i.test(c.label));
      for (const c of backs) {
        this.status(`Looking for the lens with the flashlight… (${c.label})`);
        try { await this.openStream(c.id); } catch (e) { continue; }
        if (this.torchSupported) { this.autoPicked = true; break; }
      }
      if (!this.torchSupported && this.current !== first) await this.openStream(first);
    }
    if (this.torchSupported) await this.setTorch(true);
    this.canvas = document.createElement('canvas');
    this.canvas.width = 32; this.canvas.height = 24;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.detector = new BeatDetector({ invert: true });
    this.trace = [];
    this.finger = false;
    this.running = true;
    this.status(this.torch
      ? `Light on${this.autoPicked ? ` (picked ${this.lens}, the lens next to the flashlight)` : ''}. Rest your fingertip gently over the lens and the light.`
      : this.front
        ? 'Front camera: it has no flashlight. Turn on Screen light below, or pick a back camera.'
        : this.torchSupported
          ? 'Could not switch the light on. Cover the lens with your fingertip and hold the phone toward a bright lamp.'
          : 'No lens offered light control in this browser (Firefox never does). Hold the phone toward a bright lamp, or try Chrome or Samsung Internet.', this.torch ? 'busy' : 'warn');
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
      let r = 0, g = 0, bl = 0;
      for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; bl += px[i + 2]; }
      const n = px.length / 4; r /= n; g /= n; bl /= n;
      const finger = r > 40 && r > g * 1.3 && r > bl * 1.3;
      if (finger !== this.finger) {
        this.finger = finger;
        if (finger) this.status(`Finger detected${this.torch ? '' : ' (no light)'}. Hold still and relax your hand…`, 'on');
        else { this.status('Place your fingertip over the camera.', 'warn'); this.detector.reset(); }
      }
      this.trace.push([t, -r, finger]);
      while (this.trace.length && this.trace[0][0] < t - 6) this.trace.shift();
      if (finger) {
        this.emit('pulse', { t, v: -r });
        const beat = this.detector.push(t, r);
        if (beat) this.emit('beat', beat);
      }
    } catch (e) { /* frame not ready */ }
    this._next();
  }

  async detectTorch() {
    let caps = {};
    try { caps = this.track.getCapabilities ? this.track.getCapabilities() : {}; } catch (e) { /* not available */ }
    let photo = null;
    if (!caps.torch && 'ImageCapture' in window) {
      try { photo = await new window.ImageCapture(this.track).getPhotoCapabilities(); } catch (e) { /* not available */ }
      try { caps = this.track.getCapabilities ? this.track.getCapabilities() : {}; } catch (e) { /* not available */ }
    }
    this.torchSupported = !!caps.torch;
    this.diag = {
      lens: this.lens || this.track.label,
      facing: (this.track.getSettings && this.track.getSettings().facingMode) || '?',
      torch: caps.torch ? 'offered' : 'not offered',
      fill: photo && photo.fillLightMode ? photo.fillLightMode.join('/') : '–',
      fps: (this.track.getSettings && this.track.getSettings().frameRate) || '?',
      imageCapture: 'ImageCapture' in window,
    };
  }

  /** Switch the flashlight on or off. Also tries when the browser does not advertise it. */
  async setTorch(on) {
    try {
      await this.track.applyConstraints({ advanced: [{ torch: on }] });
      // Chrome accepts unknown constraints silently, so check what actually happened.
      const s = this.track.getSettings ? this.track.getSettings() : {};
      this.torch = s.torch === undefined ? on && this.torchSupported : !!s.torch;
      this.torchNote = on && !this.torch ? 'The browser did not switch the light on for this camera.' : '';
      return this.torch === on;
    } catch (e) {
      this.torch = false;
      this.torchNote = 'The browser refused to switch the light on for this camera.';
      return false;
    }
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
