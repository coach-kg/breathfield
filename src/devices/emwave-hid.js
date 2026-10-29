// HeartMath emWave 2 / emWave Pro USB sensor (vendor ID 0x0E30) over WebHID.
//
// Reading only. Nothing is ever written to the device, so it cannot change
// settings or erase the sessions stored on an emWave 2. Quit emWave Pro
// first: only one program can hold the sensor at a time.
//
// The protocol (decoded from recordings, see docs/DEVICES.md):
//
//   0x75 lo hi 00…          keep-alive with a 16-bit counter, about every 1.3 s
//   0x66 lo hi len text…    `len` bytes of ASCII text, a 16-bit counter in lo/hi
//
// While a session runs on the emWave, the text is a stream of messages:
//
//   <I 736 >                         one heartbeat: interval since the last beat, ms
//   <2 I=760 R=F H=79 >              the beat intervals resampled at 2 Hz;
//                                    R=T marks an artifact, H is heart rate
//   <1 L=1 T=295 S=2 A=43 E=222 >    every 5 s: challenge level, session seconds,
//                                    zone (0 low, 1 medium, 2 high),
//                                    accumulated achievement score, and E, which
//                                    tracks HeartMath's "entrainment parameter"
//                                    (peak/below × peak/above) times 100

import { Device } from './device.js';

export const HEARTMATH_VENDOR_ID = 0x0e30;
// Seen on an emWave 2 (firmware 0.81, made by Quantum Intech Inc.):
// product 0x0008, vendor-defined HID (usage page 0xFF00).
export const EMWAVE2_PRODUCT_ID = 0x0008;
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** Parse the text inside one <…> message. */
export function parseMessage(m) {
  const text = m.trim();
  const beat = /^I\s+(\d+)$/.exec(text);
  if (beat) return { type: 'beat', ibi: +beat[1] };
  const parts = text.split(/\s+/);
  const kv = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf('=');
    if (i > 0) kv[p.slice(0, i)] = p.slice(i + 1);
  }
  if (parts[0] === '2' && kv.I) return { type: 'sample', ibi: +kv.I, artifact: kv.R === 'T', hr: kv.H ? +kv.H : null };
  if (parts[0] === '1' && kv.S != null) {
    return { type: 'status', level: +kv.L, time: +kv.T, zone: +kv.S, achievement: +kv.A, entrainment: kv.E != null ? +kv.E : null };
  }
  return { type: 'unknown', text };
}

/** Turns HID reports into messages. Feed it the full report, type byte first. */
export class EmWaveParser {
  constructor() { this.reset(); }
  reset() { this.buf = ''; this.lastSeq = null; this.gaps = 0; }

  push(bytes) {
    if (!bytes.length || bytes[0] !== 0x66) return [];
    const seq = bytes[1] | (bytes[2] << 8);
    if (this.lastSeq != null && seq !== ((this.lastSeq + 1) & 0xffff)) { this.gaps++; this.buf = ''; }
    this.lastSeq = seq;
    const len = Math.min(bytes[3], bytes.length - 4);
    for (let i = 0; i < len; i++) this.buf += String.fromCharCode(bytes[4 + i]);
    const out = [];
    let k;
    while ((k = this.buf.indexOf('>')) >= 0) {
      const raw = this.buf.slice(0, k);
      this.buf = this.buf.slice(k + 1);
      const s = raw.lastIndexOf('<');
      if (s >= 0) out.push(parseMessage(raw.slice(s + 1)));
    }
    if (this.buf.length > 4000) this.buf = '';
    return out;
  }
}

export class EmWaveHid extends Device {
  constructor() {
    super('emwave', 'emWave (USB)');
    this.kind = 'sensor';
    this.packets = [];
    this.parser = new EmWaveParser();
    this.lastStatus = null;
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
    this.parser.reset();
    this.lastBeatT = null;
    this.lastStatus = null;
    this.lastTextT = null;
    this.idle = false;
    this.started = performance.now() / 1000;
    this._onReport = (e) => this.onReport(e);
    dev.addEventListener('inputreport', this._onReport);
    this.status(`Connected to ${this.label}. Listening…`, 'busy');
    clearTimeout(this.silentTimer);
    this.silentTimer = setTimeout(() => {
      if (!this.packets.length) {
        this.status(`${this.label} is connected but silent. Unplug and replug it, and make sure emWave Pro is closed.`, 'warn');
      }
    }, 6000);
  }

  onReport(e) {
    const t = performance.now() / 1000;
    const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    // Depending on the platform the type byte arrives as the report ID or as the first data byte.
    const bytes = e.reportId ? Uint8Array.from([e.reportId, ...data]) : data;
    if (this.packets.length < 200000) this.packets.push({ t: +(t - this.started).toFixed(4), hex: hex(bytes) });
    if (bytes[0] === 0x75) {
      // Keep-alives only: no session is running on the handheld (never started, or ended).
      const quiet = t - (this.lastTextT ?? this.started);
      if (quiet > 5 && !this.idle) {
        this.idle = true;
        this.lastBeatT = null;
        this.emit('idle', { t });
        this.status(`${this.label} is connected, but no session is running on it. Press the emWave's button to start one, then put your finger or the ear clip on the sensor.`, 'warn');
      }
      return;
    }
    this.lastTextT = t;
    if (this.idle) {
      this.idle = false;
      this.emit('active', { t });
      this.status(`${this.label}: session running, waiting for the first beats…`, 'busy');
    }
    for (const m of this.parser.push(bytes)) this.handle(m, t);
  }

  handle(m, now) {
    if (m.type === 'beat') {
      this.hadText = true;
      // Beats arrive in batches about once a second; space them back from now.
      let t = this.lastBeatT == null || now - this.lastBeatT > 3 ? now - m.ibi / 1000 : this.lastBeatT;
      t += m.ibi / 1000;
      if (t > now) t = now;
      this.lastBeatT = t;
      this.emit('beat', { t, ibi: m.ibi });
      if (this.state !== 'on') this.status(`Connected to ${this.label}`, 'on');
    } else if (m.type === 'status') {
      this.hadText = true;
      this.lastStatus = m;
      this.emit('verdict', { ...m, t: now });
      const zone = ['low', 'medium', 'high'][m.zone] || '?';
      this.status(`${this.label}: its own verdict is ${zone} (challenge level ${m.level}, E ${m.entrainment ?? '–'}).`, 'on');
    } else if (m.type === 'sample') {
      this.emit('sample', { ...m, t: now });
    }
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
    this.hadText = false;
    if (this.dev) {
      this.dev.removeEventListener('inputreport', this._onReport);
      try { await this.dev.close(); } catch (e) { /* already closed */ }
    }
    this.status('Disconnected', 'off');
  }
}
