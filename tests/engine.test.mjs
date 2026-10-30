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

// ---------------------------------------------------------------- games
import { helpOf } from '../src/games/common.js';
import { fallInterval, timeScale } from '../src/games/stillfall.js';
import { snakeSpeed } from '../src/games/snake.js';

test('games: coherence only ever helps', () => {
  assert.equal(helpOf(0), 0);
  assert.equal(helpOf(1), 1);
  let prev = Infinity;
  for (let c = 0; c <= 1.0001; c += 0.05) {
    const ts = timeScale(c);
    assert.ok(ts <= 1 && ts >= 0.5, `time scale ${ts}`);
    assert.ok(ts <= prev + 1e-9, 'never faster when more coherent');
    prev = ts;
    assert.ok(snakeSpeed(10, c) <= snakeSpeed(10, 0) + 1e-9);
  }
  assert.ok(fallInterval(5) < fallInterval(1));
});

// ---------------------------------------------------------------- glow
import { createGlowTracker, CUE_GAP_SEC } from '../src/engine/glow.js';

test('glow: fills in high, slowly in medium, drains in low, never below zero', () => {
  const g = createGlowTracker('classic');
  let t = 0;
  for (let i = 0; i < 10; i++) g.update(2, (t += 5));
  assert.equal(g.glow, 20);
  for (let i = 0; i < 10; i++) g.update(1, (t += 5));
  assert.equal(g.glow, 30);
  for (let i = 0; i < 50; i++) g.update(0, (t += 5));
  assert.equal(g.glow, 0);
  const h = createGlowTracker('gentle');
  h.update(2, 5); h.update(0, 10);
  assert.equal(h.glow, 2, 'gentle: low holds');
  const s = createGlowTracker('steady');
  s.update(1, 5); s.update(1, 10);
  assert.equal(s.glow, 0, 'steady: medium holds');
});

test('glow: cues for zone changes, held minutes and milestones, without chatter', () => {
  const g = createGlowTracker();
  const all = [];
  let t = 0;
  const step = (z) => { all.push(...g.update(z, (t += 5)).map((e) => ({ ...e, t }))); };
  step(0); step(1); step(2);
  assert.deepEqual(all.map((e) => `${e.type}${e.to}`), ['up1', 'up2'], 'low → medium → high both ring');
  // flickering across one edge: quiet within the gap
  const n0 = all.length;
  for (let i = 0; i < 2; i++) step(i % 2 ? 2 : 1);
  assert.equal(all.length, n0);
  for (let i = 0; i < 8; i++) step(i % 2 ? 2 : 1);
  const changes = all.slice(n0).filter((e) => e.type === 'up' || e.type === 'down');
  for (let i = 1; i < changes.length; i++) assert.ok(changes[i].t - changes[i - 1].t >= CUE_GAP_SEC);
  // a full minute in high
  for (let i = 0; i < 13; i++) step(2);
  assert.ok(all.some((e) => e.type === 'held' && e.zone === 2 && e.minutes === 1));
  for (let i = 0; i < 40; i++) step(2);
  assert.ok(all.some((e) => e.type === 'milestone' && e.n === 100));
  assert.ok(!all.some((e) => e.type === 'held' && e.zone === 0));
});

test('coherence: heart-rate-only sources are scored at the pacer, not at slow drifts', async () => {
  const { CoherenceEngine: E } = await import('../src/engine/coherence.js');
  // 1 Hz bpm samples: a big slow drift (0.045 Hz) plus a small breathing wave at the pacer (0.1 Hz)
  const run = (approx, withBreath) => {
    const e = new E(); e.approx = approx; let last = null;
    for (let t = 0; t <= 90; t += 1) {
      const bpm = 62 + 4 * Math.sin(2 * Math.PI * 0.045 * t) + (withBreath ? 2 * Math.sin(2 * Math.PI * 0.1 * t) : 0);
      e.addBeat(t, 60000 / bpm);
      const r = e.update(t + 0.01, 0.1); if (r) last = r;
    }
    return last;
  };
  assert.ok(run(false, false).score > 50, 'normal scoring rewards the drift');
  assert.ok(run(true, false).score < 20, 'pacer scoring does not');
  assert.ok(run(true, true).score > run(true, false).score + 15, 'and rewards following the breath');
  assert.ok(Math.abs(run(true, true).peakHz - 0.1) < 0.02);
});

// ---------------------------------------------------------------- resonance pace test
import { analyseBlock, pickResonance, paceFor, TEST_RATES, BLOCK_SEC } from '../src/engine/resonance.js';

/** Beats from a heart whose breathing swing peaks at `rf` breaths/min. */
function resonantHeart(rate, rf, { noise = 0.6, lagPerBreath = 35, seed = 1 } = {}) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  const w = (2 * Math.PI * rate) / 60;
  const amp = 14 * Math.exp(-(((rate - rf) / 0.9) ** 2)) + 2;    // swing in bpm
  const phi = Math.PI + ((rate - rf) * lagPerBreath * Math.PI) / 180; // peak near end of inhale at rf
  const beats = []; let t = 0;
  while (t < BLOCK_SEC + 3) {
    const hr = 64 + (amp / 2) * Math.cos(w * t - phi) + noise * rnd() * 4 + 0.01 * t;
    const ibi = 60000 / hr; t += ibi / 1000; beats.push([t, ibi]);
  }
  return beats;
}

test('pace test: finds the rate where the heart swings most', () => {
  for (const rf of [4.5, 5, 5.5, 6, 6.5]) {
    const res = TEST_RATES.map((r) => analyseBlock(resonantHeart(r, rf, { seed: Math.round(r * 10) }), r));
    const pick = pickResonance(res);
    assert.equal(pick.best, rf, `expected ${rf}, got ${pick.best} ${JSON.stringify(pick.ranked)}`);
  }
  const at = analyseBlock(resonantHeart(5.5, 5.5), 5.5);
  assert.ok(Math.abs(at.phase) < 25, `phase ${at.phase}`);
  assert.ok(at.amp > 12 && at.fit > 0.6);
  assert.equal(analyseBlock([[40, 900], [41, 900]], 6), null, 'too few beats');
  assert.deepEqual(paceFor(5.5), { inS: 5.5, holdIn: 0, outS: 5.4, holdOut: 0 });
  assert.deepEqual(paceFor(6, true), { inS: 4.5, holdIn: 0, outS: 5.5, holdOut: 0 });
});

test('breath: switching patterns keeps the breath where it is', async () => {
  const { breathAt, matchPhase, PATTERNS } = await import('../src/engine/breath.js');
  const iEven = PATTERNS.findIndex((p) => p.id === 'six'), iLong = PATTERNS.findIndex((p) => p.id === 'longout'), iBox = PATTERNS.findIndex((p) => p.id === 'box');
  for (const t of [1, 2.5, 4, 6, 8.7]) {
    const a = breathAt(t, iEven);
    const b = breathAt(matchPhase(a, iLong), iLong);
    assert.equal(b.kind, a.kind, `t=${t}`);
    assert.ok(Math.abs(b.b - a.b) < 0.03, `t=${t}: ${a.b} vs ${b.b}`);
  }
  const top = breathAt(matchPhase({ kind: 'holdIn', b: 1 }, iBox), iBox);
  assert.equal(top.kind, 'holdIn');
  const turn = breathAt(matchPhase({ kind: 'holdIn', b: 1 }, iEven), iEven);
  assert.ok(turn.kind === 'in' && turn.b > 0.97, 'no hold: go to the top of the in-breath');
});
