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

export class BleHeartRate extends Device {
  constructor() {
    super('ble', 'Bluetooth heart-rate strap');
    this.kind = 'sensor';
    this.lag = 1.2; // intervals arrive in batches about once a second
  }

  static support() {
    if (!('bluetooth' in navigator)) return 'Needs Chrome or Edge on Mac, Windows, Android or ChromeOS.';
    return null;
  }

  async connect() {
    this.status('Choose your strap in the browser dialog…');
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    this.btDevice = dev;
    dev.addEventListener('gattserverdisconnected', () => this.status('Disconnected', 'off'));
    this.status(`Connecting to ${dev.name || 'strap'}…`);
    const server = await dev.gatt.connect();
    const svc = await server.getPrimaryService('heart_rate');
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
      this.status(`${this.label}: heart rate ${m.hr} bpm, but no beat intervals. This sensor cannot measure coherence.`, 'warn');
      this.emit('hr', { hr: m.hr });
      return;
    }
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
