import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoherenceEngine } from '../src/engine/coherence.js';
import { adaptAfterSession, initialLevelState, thresholdsFor, zoneOf, HOLD_SESSIONS } from '../src/engine/levels.js';
import { evaluate, gained } from '../src/engine/achievements.js';
import { byDay, runs, currentStreak, dayKey } from '../src/engine/progress.js';
import { parseHeartRateMeasurement } from '../src/devices/ble-hr.js';
import { BeatDetector } from '../src/devices/ppg.js';

// Seeded random so the tests are stable.
function rng(seed = 7) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Beats from a heart-rate function hr(t) in bpm. */
function beats(hrAt, seconds) {
  const out = [];
  let t = 0;
  while (t < seconds) {
    const ibi = 60000 / hrAt(t);
    t += ibi / 1000;
    out.push({ t, ibi });
  }
  return out;
}

function scoreOf(list, until) {
  const e = new CoherenceEngine();
  let last = null;
  for (const b of list) {
    e.addBeat(b.t, b.ibi);
    const r = e.update(b.t);
    if (r) last = r;
    if (b.t > until) break;
  }
  return last;
}

test('slow, regular rhythm at 0.1 Hz scores high', () => {
  const r = rng(1);
  const list = beats((t) => 66 + 8 * Math.sin(2 * Math.PI * 0.1 * t) + (r() - 0.5) * 2, 200);
  const res = scoreOf(list, 190);
  assert.ok(res.score > 70, `score ${res.score}`);
  assert.ok(Math.abs(res.peakHz - 0.1) < 0.02, `peak ${res.peakHz}`);
});

test('irregular rhythm scores low', () => {
  const r = rng(2);
  let hr = 70;
  const list = beats(() => { hr += (r() - 0.5) * 3; hr += (70 - hr) * 0.05; return hr; }, 200);
  const res = scoreOf(list, 190);
  assert.ok(res.score < 40, `score ${res.score}`);
});

test('artifacts are rejected', () => {
  const e = new CoherenceEngine();
  for (let i = 0; i < 10; i++) e.addBeat(i, 900);
  assert.equal(e.addBeat(11, 450), false);
  assert.equal(e.addBeat(12, 5000), false);
  assert.equal(e.addBeat(13, 920), true);
});

test('thresholds and zones', () => {
  const th = thresholdsFor(1.5);
  assert.deepEqual(th, { medium: 32, high: 53 });
  assert.equal(zoneOf(31, th), 0);
  assert.equal(zoneOf(40, th), 1);
  assert.equal(zoneOf(60, th), 2);
});

const sess = (high, extra = {}) => ({
  start: new Date().toISOString(), durationSec: 600, sensor: true,
  timeIn: [600 * (1 - high) / 2, 600 * (1 - high) / 2, 600 * high], ...extra,
});

test('difficulty rises with strong sessions and ranks up', () => {
  let s = initialLevelState();
  let ups = 0;
  for (let i = 0; i < 6; i++) {
    const r = adaptAfterSession(s, sess(0.95));
    s = r.state; ups += r.events.filter((e) => e.type === 'rankUp').length;
  }
  assert.ok(s.d > 1, `d ${s.d}`);
  assert.ok(s.rank >= 1 && ups >= 1);
  assert.equal(s.peakRank, s.rank);
});

test('rank holds through a grey zone before dropping', () => {
  let s = { ...initialLevelState(), d: 2.05, rank: 2, peakRank: 2 };
  const events = [];
  for (let i = 0; i < HOLD_SESSIONS + 3; i++) {
    const r = adaptAfterSession(s, sess(0.0));
    s = r.state; events.push(...r.events);
  }
  assert.ok(s.d >= s.rank - 0.5 - 1e-9, 'never sinks more than the grey zone below the shown rank');
  assert.equal(events.filter((e) => e.type === 'rankDown').length, 1);
  assert.equal(s.peakRank, 2, 'peak rank is kept');
});

test('pacer-only sessions do not move difficulty', () => {
  const s = initialLevelState();
  const r = adaptAfterSession(s, sess(0.95, { sensor: false }));
  assert.equal(r.state.d, 0);
});

test('streaks and repeat counts', () => {
  const mk = (iso) => ({ start: iso, durationSec: 300, sensor: false });
  const list = [];
  for (let d = 1; d <= 15; d++) {
    list.push(mk(`2026-03-${String(d).padStart(2, '0')}T10:00:00`));
    if (d <= 7) list.push(mk(`2026-03-${String(d).padStart(2, '0')}T20:00:00`));
  }
  const days = byDay(list);
  assert.equal(runs(days)[0].len, 15);
  assert.equal(currentStreak(days, '2026-03-16'), 15);
  assert.equal(currentStreak(days, '2026-03-18'), 0);
  const badges = Object.fromEntries(evaluate(list, initialLevelState()).map((b) => [b.id, b.count]));
  assert.equal(badges.streak7, 2, 'two full weeks → ×2');
  assert.equal(badges.streak3, 5);
  assert.equal(badges.twice7, 1);
  assert.equal(badges.first, 1);
});

test('day rollover keeps late-night sessions on the previous day', () => {
  assert.equal(dayKey('2026-03-05T01:30:00', 3), '2026-03-04');
  assert.equal(dayKey('2026-03-05T03:30:00', 3), '2026-03-05');
});

test('gained lists only increases', () => {
  const a = [{ id: 'x', count: 1 }, { id: 'y', count: 0 }];
  const b = [{ id: 'x', count: 2 }, { id: 'y', count: 0 }];
  assert.deepEqual(gained(a, b).map((g) => g.id), ['x']);
});

test('parses BLE heart rate measurement with RR intervals', () => {
  // flags 0x10: 8-bit HR, RR present. HR 64, RR 1024 (=1000 ms), 922 (~900 ms)
  const buf = new DataView(new Uint8Array([0x10, 64, 0x00, 0x04, 0x9a, 0x03]).buffer);
  const m = parseHeartRateMeasurement(buf);
  assert.equal(m.hr, 64);
  assert.equal(m.rr.length, 2);
  assert.equal(Math.round(m.rr[0]), 1000);
  assert.equal(Math.round(m.rr[1]), 900);
});

test('PPG beat detector finds beats in a synthetic pulse wave', () => {
  const det = new BeatDetector();
  const fs = 30, hr = 72;
  const found = [];
  for (let i = 0; i < fs * 30; i++) {
    const t = i / fs;
    const ph = (t * hr / 60) % 1;
    const v = Math.exp(-((ph - 0.2) ** 2) / 0.004) + 0.4 * Math.exp(-((ph - 0.5) ** 2) / 0.01);
    const beat = det.push(t, 100 + 10 * v);
    if (beat) found.push(beat);
  }
  const ibis = found.slice(3).map((b) => b.ibi);
  const mean = ibis.reduce((a, b) => a + b, 0) / ibis.length;
  assert.ok(Math.abs(mean - 60000 / hr) < 25, `mean ibi ${mean}`);
});

test('decodes real emWave 2 packets into beats, 2 Hz samples and status', async () => {
  const { readFileSync } = await import('node:fs');
  const { EmWaveParser } = await import('../src/devices/emwave-hid.js');
  const lines = readFileSync(new URL('./fixtures/emwave2-slow-breathing.jsonl', import.meta.url), 'utf8').trim().split('\n').slice(1);
  const p = new EmWaveParser();
  const msgs = [];
  for (const l of lines) msgs.push(...p.push(Uint8Array.from(JSON.parse(l).hex.split(' '), (h) => parseInt(h, 16))));
  const beats = msgs.filter((m) => m.type === 'beat');
  const samples = msgs.filter((m) => m.type === 'sample');
  const status = msgs.filter((m) => m.type === 'status');
  assert.equal(p.gaps, 0);
  assert.ok(beats.length >= 5, `beats ${beats.length}`);
  assert.ok(beats.every((b) => b.ibi > 300 && b.ibi < 2000));
  assert.ok(samples.every((s) => Math.abs(s.hr - 60000 / s.ibi) < 1.5), 'H matches 60000 / I');
  assert.deepEqual(status[0], { type: 'status', level: 1, time: 295, zone: 2, achievement: 43, entrainment: 222 });
  assert.equal(msgs.filter((m) => m.type === 'unknown').length, 0);
});
