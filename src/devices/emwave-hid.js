// HeartMath emWave 2 / emWave Pro USB sensor (vendor ID 0x0E30) over WebHID.
//
// Status: the USB data format is not decoded yet. This adapter connects,
// listens without sending anything to the device, and records every packet
// so we can work out the format. Once the decoder below knows the layout it
// emits beats (and the raw pulse wave, if the device sends one) like any
// other sensor.
//
// Reading only. Nothing is ever written to the device, so it cannot erase
// the sessions stored on an emWave 2.
//
// If Chrome's device picker shows nothing, the sensor is probably not a HID
// device. tools/emwave_probe.py tells you for sure. Quit emWave Pro first:
// only one program can hold the sensor at a time.

import { Device } from './device.js';
import { BeatDetector } from './ppg.js';

export const HEARTMATH_VENDOR_ID = 0x0e30;
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');

/**
 * Decoder, to be filled in from captured packets.
 * Return {beats: [ibiMs…], pulse: [value…]} or null when unknown.
 */
export function decodeReport(/* reportId, bytes */) {
  return null;
}

export class EmWaveHid extends Device {
  constructor() {
    super('emwave', 'emWave (USB)');
    this.kind = 'sensor';
    this.packets = [];
    this.detector = new BeatDetector();
  }

  static support() {
    if (!('hid' in navigator)) return 'Needs Chrome or Edge on a computer (WebHID).';
    return null;
  }

  async connect() {
    this.status('Choose the HeartMath device in the browser dialog…');
    const list = await navigator.hid.requestDevice({ filters: [{ vendorId: HEARTMATH_VENDOR_ID }] });
    const dev = list && list[0];
    if (!dev) throw new Error('No HeartMath device was chosen. If the list was empty, quit emWave Pro and check that the sensor is plugged in.');
    if (!dev.opened) await dev.open();
    this.dev = dev;
    this.label = dev.productName || this.label;
    this.packets = [];
    this.started = performance.now() / 1000;
    this._onReport = (e) => this.onReport(e);
    dev.addEventListener('inputreport', this._onReport);
    this.status(`Connected to ${this.label}. Listening…`, 'busy');
    clearTimeout(this.silentTimer);
    this.silentTimer = setTimeout(() => {
      if (!this.packets.length) {
        this.status(`${this.label} is connected but has sent nothing yet. It may need a start command that only emWave Pro knows. See docs/DEVICES.md.`, 'warn');
      }
    }, 6000);
  }

  onReport(e) {
    const t = performance.now() / 1000;
    const bytes = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    if (this.packets.length < 200000) this.packets.push({ t: +(t - this.started).toFixed(4), id: e.reportId, hex: hex(bytes) });
    const dec = decodeReport(e.reportId, bytes);
    if (!dec) {
      if (this.packets.length % 50 === 1) this.status(`Recording raw data from ${this.label}: ${this.packets.length} packets. Not decoded yet.`, 'warn');
      return;
    }
    for (const v of dec.pulse || []) {
      this.emit('pulse', { t, v });
      const beat = this.detector.push(t, v);
      if (beat) this.emit('beat', beat);
    }
    for (const ibi of dec.beats || []) this.emit('beat', { t, ibi });
    if (this.state !== 'on') this.status(`Connected to ${this.label}`, 'on');
  }

  /** Everything we know about the device plus the packets, for decoding. */
  capture() {
    const d = this.dev;
    return {
      app: 'breathfield',
      kind: 'emwave-capture',
      capturedAt: new Date().toISOString(),
      device: d && {
        vendorId: d.vendorId, productId: d.productId, productName: d.productName,
        collections: (d.collections || []).map((c) => ({
          usagePage: c.usagePage, usage: c.usage,
          inputReports: (c.inputReports || []).map((r) => ({ reportId: r.reportId, items: (r.items || []).map((i) => ({ reportSize: i.reportSize, reportCount: i.reportCount, usages: i.usages })) })),
          outputReports: (c.outputReports || []).map((r) => r.reportId),
          featureReports: (c.featureReports || []).map((r) => r.reportId),
        })),
      },
      note: 'Times are seconds since connecting. Write down what you did while recording (sensor off, on ear, breathing slowly…).',
      packets: this.packets,
    };
  }

  async disconnect() {
    clearTimeout(this.silentTimer);
    if (this.dev) {
      this.dev.removeEventListener('inputreport', this._onReport);
      try { await this.dev.close(); } catch (e) { /* already closed */ }
    }
    this.status('Disconnected', 'off');
  }
}
