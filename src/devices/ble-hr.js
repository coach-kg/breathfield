// Any Bluetooth heart-rate sensor that uses the standard Heart Rate Service
// (Polar H10/H9, Garmin HRM, Wahoo TICKR, most chest straps). RR intervals
// come straight from the strap, which is the most accurate source we support.
// Needs Chrome or Edge (Web Bluetooth). Safari and Firefox do not have it.

import { Device } from './device.js';

/** Parse a Heart Rate Measurement (0x2A37) value. RR in ms. */
export function parseHeartRateMeasurement(view) {
  const flags = view.getUint8(0);
  let i = 1;
  let hr;
  if (flags & 0x01) { hr = view.getUint16(i, true); i += 2; } else { hr = view.getUint8(i); i += 1; }
  if (flags & 0x08) i += 2; // energy expended
  const rr = [];
  if (flags & 0x10) {
    for (; i + 1 < view.byteLength; i += 2) rr.push((view.getUint16(i, true) / 1024) * 1000);
  }
  return { hr, rr, contact: (flags & 0x06) === 0x06 ? true : (flags & 0x04 ? false : null) };
}

/**
 * What kind of Bluetooth heart sensor this is, from its advertised name, and the
 * model without the serial number ("Polar Unite A46B3A28" → watch, "Polar Unite").
 * approx: it sent heart rate without beat intervals, which watches usually do.
 */
export function describeBle(name = '', approx = false) {
  const model = name.replace(/\s+[0-9A-F]{6,}$/i, '').replace(/\s*\(.*\)$/, '').trim();
  let kind = 'bluetooth';
  if (/verity|\boh1\b|rhythm|armband|whoop|scosche/i.test(name)) kind = 'armband';
  else if (/\bh10\b|\bh9\b|\bh7\b|\bh6\b|hrm|tickr|strap|chest|coospo|magene|moofit|\bdual\b/i.test(name)) kind = 'strap';
  else if (/watch|unite|ignite|vantage|grit|pacer|forerunner|f[eē]nix|venu|vivo|epix|instinct|amazfit|\bgtr\b|\bgts\b|band|fitbit|versa|charge|coros|suunto|galaxy|gear|pixel/i.test(name)) kind = 'watch';
  else if (approx) kind = 'watch';
  return { kind, model: model.length > 18 ? `${model.slice(0, 17)}…` : model };
}

export class BleHeartRate extends Device {
  /** showAll: list every nearby device, for watches that do not advertise the heart-rate service. */
  constructor({ showAll = false } = {}) {
    super('ble', 'Bluetooth heart-rate strap');
    this.kind = 'sensor';
    this.lag = 1.2; // intervals arrive in batches about once a second
    this.showAll = showAll;
  }

  static support() {
    if (!('bluetooth' in navigator)) return 'Needs Chrome or Edge on Mac, Windows, Android or ChromeOS.';
    return null;
  }

  async connect() {
    this.status(this.showAll ? 'Pick your watch or strap from the list…' : 'Choose your strap or watch in the browser dialog…');
    const dev = await navigator.bluetooth.requestDevice(this.showAll
      ? { acceptAllDevices: true, optionalServices: ['heart_rate'] }
      : { filters: [{ services: ['heart_rate'] }] });
    this.btDevice = dev;
    dev.addEventListener('gattserverdisconnected', () => this.status('Disconnected', 'off'));
    this.status(`Connecting to ${dev.name || 'strap'}…`);
    const server = await dev.gatt.connect();
    let svc;
    try { svc = await server.getPrimaryService('heart_rate'); } catch (e) {
      throw new Error(`${dev.name || 'This device'} has no heart-rate service right now. On the watch, start sharing heart rate first (for Polar: Start training, then Share HR with other devices).`);
    }
    const ch = await svc.getCharacteristic('heart_rate_measurement');
    this._onValue = (e) => this.handle(e.target.value);
    ch.addEventListener('characteristicvaluechanged', this._onValue);
    await ch.startNotifications();
    this.ch = ch;
    this.label = dev.name || this.label;
    this.lastBeatT = null;
    this.status(`Connected to ${this.label}`, 'on');
  }

  handle(view) {
    const m = parseHeartRateMeasurement(view);
    const now = performance.now() / 1000;
    if (!m.rr.length) {
      // Watches and armbands often share heart rate only. The slow rise and fall of
      // heart rate with the breath still shows, so use it as an approximate series.
      if (m.hr > 25) {
        if (!this.approx) this.status(`${this.label}: heart rate only, no beat-to-beat timing. Coherence is approximate with this source.`, 'warn');
        this.approx = true;
        this.emit('beat', { t: now, ibi: 60000 / m.hr, approx: true });
      }
      return;
    }
    this.approx = false;
    // RR values arrive in a batch about once a second; place beats back from now.
    let t = this.lastBeatT == null ? now - m.rr.reduce((a, b) => a + b, 0) / 1000 : this.lastBeatT;
    for (const rr of m.rr) {
      t += rr / 1000;
      this.emit('beat', { t: Math.min(t, now), ibi: rr });
    }
    // Keep our clock tied to real time so drift never accumulates.
    this.lastBeatT = Math.abs(t - now) > 2 ? now : t;
  }

  async disconnect() {
    try { if (this.ch) await this.ch.stopNotifications(); } catch (e) { /* already gone */ }
    try { this.btDevice && this.btDevice.gatt.connected && this.btDevice.gatt.disconnect(); } catch (e) { /* ignore */ }
    this.status('Disconnected', 'off');
  }
}
