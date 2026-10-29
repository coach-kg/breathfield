import { PATTERNS, breathAt, perMinute } from './engine/breath.js';
import { CoherenceEngine, STEP_SEC, MIN_SEC } from './engine/coherence.js';
import { RANKS, thresholdsFor, zoneOf, visualLevel, initialLevelState, activeD, rankOf, adaptAfterSession, GREY, HOLD_SESSIONS } from './engine/levels.js';
import { evaluate, gained } from './engine/achievements.js';
import { byDay, runs, currentStreak, bestStreak, totals, dayKey, addDays, keyToDate, MIN_SESSION_SEC } from './engine/progress.js';
import * as store from './store.js';
import { Drone } from './audio.js';
import { SCENES, createScenes, drawGuide } from './visuals/scenes.js';
import { badgeGlyph } from './visuals/badges.js';
import { PracticeKeys, DemoSensor } from './devices/simulated.js';
import { BleHeartRate } from './devices/ble-hr.js';
import { EmWaveHid } from './devices/emwave-hid.js';
import { CameraPpg } from './devices/camera-ppg.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL = { low: css('--low'), mid: css('--mid'), high: css('--high') };
const ZONE_NAMES = ['low', 'medium', 'high'];
const fmtClock = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtMin = (m) => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);
const now = () => performance.now() / 1000;
const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.45 : 1;

const DEFAULT_SETTINGS = { scene: 0, pattern: 0, guide: true, volume: 0.6, sessionMin: 10, rollover: 3, device: 'practice' };

const app = {
  settings: { ...DEFAULT_SETTINGS },
  level: initialLevelState(),
  sessions: [],
  badges: [],
  holding: false,
  lastInput: -1e9,
  pacer0: now(),
  breathB: 0,
  device: null,
  deviceId: null,
  engine: new CoherenceEngine(),
  score: null,
  zone: null,
  hr: null,
  visual: 0.3,
  hist: [],
  beats: [],
  session: null,
};

// ---------------------------------------------------------------- devices

const DEVICES = [
  { id: 'practice', cls: PracticeKeys, make: () => new PracticeKeys({ holding: () => app.holding, lastInput: () => app.lastInput }),
    title: 'Practice without a sensor', short: 'Practice', tag: 'always works',
    desc: 'Hold space, or press and hold the screen, while you breathe in, and let go as you breathe out. Breathing evenly with the pacer builds coherence. Counts for streaks, not for rank.' },
  { id: 'ble', cls: BleHeartRate, title: 'Bluetooth heart-rate strap', short: 'Strap', tag: 'most accurate', good: true,
    desc: 'Polar H10, Garmin HRM, Wahoo TICKR or any strap that sends beat intervals. Chrome or Edge.' },
  { id: 'emwave', cls: EmWaveHid, title: 'emWave 2 (USB)', short: 'emWave', tag: 'read-only', good: true,
    desc: 'Quit emWave Pro, plug in the emWave 2 and start a session on it. Breathfield reads its heartbeats and its own low / medium / high verdict, and never writes to the device.' },
  { id: 'camera', cls: CameraPpg, title: 'Fingertip on the camera', short: 'Camera', tag: 'phone',
    desc: 'Rest a fingertip lightly on the back camera with the light on, and sit still. Studies of camera pulse during slow breathing found it close to ECG.' },
  { id: 'demo', cls: DemoSensor, make: () => new DemoSensor({ breath: () => app.breathB }), title: 'Demo signal', short: 'Demo', tag: 'not saved to streaks',
    desc: 'A pretend heart that settles into the pacer over a few minutes. For trying scenes and sounds.' },
];

async function connect(id) {
  const def = DEVICES.find((d) => d.id === id);
  if (!def) return;
  const why = def.cls.support();
  if (why) { toast(why); return; }
  const prev = app.device;
  app.device = null;
  if (prev) { try { await prev.disconnect(); } catch (e) { /* ignore */ } }
  const dev = def.make ? def.make() : new def.cls();
  app.deviceId = id;
  app.device = dev;
  app.engine.reset();
  app.score = null; app.zone = null; app.hr = null; app.beats = [];
  dev.addEventListener('beat', (e) => onBeat(dev, e.detail));
  dev.addEventListener('status', () => { if (app.device === dev) renderStatus(); });
  dev.addEventListener('verdict', (e) => {
    // The emWave's own low/medium/high and E, kept with the session to compare and calibrate.
    const v = e.detail, s = app.session;
    if (app.device === dev && s) s.emwave.push([+(v.t - s.t0).toFixed(1), v.zone, v.entrainment, v.level, v.achievement]);
  });
  renderStatus();
  renderDevices();
  try {
    await dev.connect();
    app.settings.device = id;
    saveSettings();
  } catch (err) {
    const msg = err && err.name === 'NotFoundError' ? 'No device was chosen.'
      : err && (err.name === 'SecurityError' || err.name === 'NotAllowedError') ? 'The browser blocked access. Run Breathfield from its own address (GitHub Pages or start.command) in Chrome or Edge, and allow access when asked.'
      : (err && err.message) || 'Could not connect.';
    dev.status(msg, 'warn');
  }
  renderDevices();
}

function onBeat(dev, { t, ibi }) {
  if (app.device !== dev) return;
  const ok = app.engine.addBeat(t, ibi);
  app.beats.push({ t, ibi, ok });
  while (app.beats.length && app.beats[0].t < t - 70) app.beats.shift();
  if (app.session && ok) app.session.ibis.push([+(t - app.session.t0).toFixed(3), Math.round(ibi)]);
}

function onScore(r) {
  const th = currentThresholds();
  app.score = r.score;
  app.zone = zoneOf(r.score, th);
  app.hr = r.hr;
  app.hist.push(r.score);
  if (app.hist.length > 24) app.hist.shift();
  const s = app.session;
  if (s) {
    s.scores.push([+(r.t - s.t0).toFixed(1), +r.score.toFixed(1)]);
    s.timeIn[zoneOf(r.score, s.thresholds)] += STEP_SEC;
    if (r.hr) s.hrs.push(r.hr);
  }
}

function currentThresholds() {
  return app.session ? app.session.thresholds : thresholdsFor(activeD(app.level));
}

// ---------------------------------------------------------------- sessions

function startSession() {
  const dev = app.device;
  const t = now();
  app.session = {
    id: (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    start: new Date().toISOString(),
    t0: t,
    device: app.deviceId,
    deviceLabel: dev ? dev.label : 'none',
    sensor: !!dev && dev.kind === 'sensor',
    demo: !!dev && dev.kind === 'demo',
    pattern: app.settings.pattern,
    patternId: PATTERNS[app.settings.pattern].id,
    scenes: new Set([SCENES[app.settings.scene].id]),
    d: +activeD(app.level).toFixed(3),
    thresholds: thresholdsFor(activeD(app.level)),
    timeIn: [0, 0, 0],
    scores: [],
    hrs: [],
    ibis: [],
    emwave: [],
  };
  const b = $('sessionBtn');
  b.textContent = 'End session'; b.classList.add('rec');
  toast(app.session.demo ? 'Recording a demo session. Demo sessions do not count toward streaks.' : 'Session started. Breathe with the ring.');
}

async function endSession(auto = false) {
  const s = app.session;
  if (!s) return;
  app.session = null;
  const b = $('sessionBtn');
  b.textContent = 'Start session'; b.classList.remove('rec');
  const durationSec = Math.round(now() - s.t0);
  if (durationSec < MIN_SESSION_SEC) {
    toast('Sessions shorter than 2 minutes are not saved.');
    return;
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const rec = {
    id: s.id, start: s.start, end: new Date().toISOString(), durationSec,
    device: s.device, deviceLabel: s.deviceLabel, sensor: s.sensor, demo: s.demo,
    pattern: s.pattern, patternId: s.patternId, scenes: [...s.scenes],
    d: s.d, thresholds: s.thresholds,
    timeIn: s.timeIn, avgScore: avg(s.scores.map((x) => x[1])), avgHr: avg(s.hrs),
    scores: s.scores, ibis: s.ibis, ...(s.emwave.length ? { emwave: s.emwave } : {}), endedBy: auto ? 'timer' : 'you',
  };
  if (rec.avgScore != null) rec.avgScore = +rec.avgScore.toFixed(1);
  if (rec.avgHr != null) rec.avgHr = +rec.avgHr.toFixed(1);

  const before = app.badges;
  const { state, events } = adaptAfterSession(app.level, rec);
  app.level = state;
  app.sessions.push(rec);
  await store.putSession(rec);
  await store.set('level', app.level);
  app.badges = evaluateBadges();
  const fresh = gained(before, app.badges);
  try { await store.writeBackup(false); } catch (e) { /* backup is best effort */ }
  showSummary(rec, events, fresh);
  renderJournal();
}

function evaluateBadges() {
  return evaluate(app.sessions, app.level, { rollover: app.settings.rollover, patternCount: PATTERNS.length });
}

function showSummary(rec, events, fresh) {
  const t = rec.timeIn, scored = t[0] + t[1] + t[2];
  const pct = (x) => (scored ? (100 * x) / scored : 0);
  const days = byDay(app.sessions, app.settings.rollover);
  const streak = currentStreak(days, dayKey(Date.now(), app.settings.rollover));
  let rankMsg = '';
  for (const e of events) {
    if (e.type === 'rankUp') rankMsg = `You reached <b>${RANKS[e.rank].name}</b>. The thresholds rise a little from here.`;
    if (e.type === 'rankHeld') rankMsg = `A quieter session. Your <b>${RANKS[e.rank].name}</b> rank holds; it only eases down after ${e.left} more like this in a row.`;
    if (e.type === 'rankDown') rankMsg = `Easing to <b>${RANKS[e.rank].name}</b> for now so practice stays enjoyable. Your earlier rank badge stays yours.`;
  }
  if (!rec.sensor) rankMsg = rec.demo ? 'Demo sessions are kept in the list but do not count for streaks, badges or rank.' : 'Practice sessions count for streaks and time badges. Rank changes need a heart sensor.';
  const badgeHtml = fresh.length ? `<div class="newb"><h3>New</h3>${fresh.map(badgeCard).join('')}</div>` : '';
  $('summaryCard').innerHTML = `
    <h2 id="sumTitle">${fmtClock(rec.durationSec)}</h2>
    <div class="stats">
      <div class="stat"><b>${rec.avgScore == null ? '—' : Math.round(rec.avgScore)}</b><span>avg coherence</span></div>
      <div class="stat"><b>${rec.avgHr == null ? '—' : Math.round(rec.avgHr)}</b><span>avg bpm</span></div>
      <div class="stat"><b>${rec.demo ? '—' : streak}</b><span>day streak</span></div>
    </div>
    ${scored ? `<div><div class="zonebar"><i style="width:${pct(t[0])}%"></i><i style="width:${pct(t[1])}%"></i><i style="width:${pct(t[2])}%"></i></div>
      <div class="legend" style="margin-top:8px"><span><i style="background:var(--low)"></i>low ${fmtClock(t[0])}</span><span><i style="background:var(--mid)"></i>medium ${fmtClock(t[1])}</span><span><i style="background:var(--high)"></i>high ${fmtClock(t[2])}</span></div></div>` : ''}
    <p class="msg">${rankMsg}</p>
    ${badgeHtml}
    <div class="btns"><button class="solo primary" id="sumClose">Done</button><button class="solo" id="sumJournal">Open journal</button></div>`;
  $('summary').hidden = false;
  $('sumClose').focus();
  $('sumClose').onclick = () => { $('summary').hidden = true; };
  $('sumJournal').onclick = () => { $('summary').hidden = true; openPanel('journalPanel'); };
}

// ---------------------------------------------------------------- rendering

function badgeCard(b) {
  const times = b.count > 1 ? `<span class="times">×${b.count}</span>` : '';
  return `<div class="badge ${b.count ? '' : 'locked'}" title="${esc(b.desc)}">${badgeGlyph(b, 44)}<b>${esc(b.name)}${times}</b><span>${esc(b.desc)}</span></div>`;
}

function renderStatus() {
  const dev = app.device;
  const el = $('src');
  el.textContent = dev ? dev.text || dev.label : 'No heart source';
  el.dataset.state = dev ? dev.state : 'off';
  const def = DEVICES.find((d) => d.id === app.deviceId);
  $('sensorName').textContent = def ? def.short : 'none';
  if (!$('sensorPanel').hidden) renderDevices();
}

function renderDevices() {
  const list = $('deviceList');
  list.innerHTML = DEVICES.map((d) => {
    const why = d.cls.support();
    const active = app.deviceId === d.id && app.device;
    const st = active ? `<div class="st" data-state="${app.device.state}">${esc(app.device.text || '')}</div>` : '';
    const extra = d.id === 'emwave' && active ? `<button class="solo" data-capture>Save raw recording (${app.device.packets.length} packets)</button>` : '';
    return `<div class="dev ${active ? 'active' : ''}">
      <div class="dev-head"><h4>${esc(d.title)}</h4><span class="tag ${d.good ? 'good' : ''}">${esc(d.tag)}</span></div>
      <p>${esc(d.desc)}</p>
      ${why ? `<p class="why">${esc(why)}</p>` : ''}
      ${st}
      <div class="btns">
        ${active ? `<button class="solo" data-disconnect="${d.id}">Disconnect</button>` : `<button class="solo primary" data-connect="${d.id}" ${why ? 'disabled' : ''}>Use this</button>`}
        ${extra}
      </div></div>`;
  }).join('');
}

$('deviceList').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-connect]');
  const d = e.target.closest('[data-disconnect]');
  if (c) connect(c.dataset.connect);
  if (d && app.device) {
    await app.device.disconnect();
    app.device = null; app.deviceId = null; app.score = null; app.zone = null;
    renderStatus(); renderDevices();
  }
  if (e.target.closest('[data-capture]') && app.device && app.device.capture) {
    store.download(`emwave-capture-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`, app.device.capture());
  }
});

let lastLvl = -1, lastCue = '', lastSec = -1;
function renderHud(br) {
  const word = br.label;
  if (word !== lastCue) { $('cue').textContent = word; lastCue = word; }
  const sec = Math.ceil(br.rem);
  if (sec !== lastSec) { $('cueSec').textContent = sec; lastSec = sec; }
  const o = Math.min(1, br.elapsed / 0.6, br.rem / 0.6) * 0.9;
  const cw = $('cueWrap');
  cw.style.opacity = o.toFixed(3);
  cw.style.transform = `translate(-50%,-50%) scale(${(0.92 + 0.12 * br.b).toFixed(3)})`;
  const lvl = app.zone == null ? 0 : app.zone + 1;
  if (lvl !== lastLvl) {
    $('meter').dataset.lvl = lvl;
    $('lvl').textContent = lvl ? ZONE_NAMES[lvl - 1] : 'warming up';
    $('lvl').style.color = lvl ? [COL.low, COL.mid, COL.high][lvl - 1] : '';
    lastLvl = lvl;
  }
}

function renderSecond() {
  $('score').textContent = app.score == null ? '—' : Math.round(app.score);
  if (app.score == null && app.device) {
    const have = app.engine.beats.length ? now() - app.engine.beats[0].t : 0;
    $('lvl').textContent = app.engine.beats.length ? `warming up ${Math.max(0, Math.ceil(MIN_SEC - have))}s` : 'waiting for beats';
  }
  const hr = app.engine.heartRate();
  $('hr').textContent = hr ? Math.round(hr) : '—';
  $('clock').textContent = app.session ? fmtClock(now() - app.session.t0) + (app.settings.sessionMin ? ` / ${app.settings.sessionMin}:00` : '') : 'not recording';
  const r = rankOf(app.level);
  $('rank').textContent = RANKS[r].name;
  $('rankD').textContent = activeD(app.level).toFixed(1);
  drawSpark();
  if (!$('sensorPanel').hidden) drawWave();
}

function drawSpark() {
  const c = $('spark'), x = c.getContext('2d'), w = c.width, h = c.height, pad = 6;
  x.clearRect(0, 0, w, h);
  const th = currentThresholds();
  x.strokeStyle = 'rgba(239,234,255,0.12)'; x.lineWidth = 1;
  [th.medium, th.high].forEach((v) => { const y = h - pad - (v / 100) * (h - 2 * pad); x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); });
  const H = app.hist;
  if (H.length < 2) return;
  const last = H[H.length - 1];
  const col = [COL.low, COL.mid, COL.high][zoneOf(last, th)];
  const pts = H.map((v, i) => [(i / 23) * (w - 8), h - pad - (v / 100) * (h - 2 * pad)]);
  const off = (w - 8) - pts[pts.length - 1][0];
  x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px + off, py) : x.moveTo(px + off, py)));
  x.lineTo(w - 8, h); x.lineTo(pts[0][0] + off, h); x.closePath();
  x.globalAlpha = 0.16; x.fillStyle = col; x.fill(); x.globalAlpha = 1;
  x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px + off, py) : x.moveTo(px + off, py)));
  x.strokeStyle = col; x.lineWidth = 2.5; x.stroke();
  x.fillStyle = col; x.beginPath(); x.arc(w - 8, pts[pts.length - 1][1], 4.5, 0, Math.PI * 2); x.fill();
}

function drawWave() {
  const c = $('wave'), x = c.getContext('2d'), w = c.width, h = c.height;
  x.clearRect(0, 0, w, h);
  const B = app.beats.filter((b) => b.ok);
  const t1 = now(), t0 = t1 - 60;
  $('beatInfo').textContent = B.length ? `${B.length} beats · ${app.beats.length - B.length} skipped as artifacts` : 'no beats yet';
  if (B.length < 2) return;
  const ibis = B.map((b) => b.ibi);
  let lo = Math.min(...ibis), hi = Math.max(...ibis);
  const mid = (lo + hi) / 2, span = Math.max(120, hi - lo) * 0.6;
  lo = mid - span; hi = mid + span;
  x.strokeStyle = css('--accent'); x.lineWidth = 2;
  x.beginPath();
  B.forEach((b, i) => {
    const px = ((b.t - t0) / 60) * w, py = h - ((b.ibi - lo) / (hi - lo)) * h;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  });
  x.stroke();
}

function renderJournal() {
  if ($('journalPanel').hidden) return;
  renderProgress(); renderBadges(); renderSessions(); renderSettings();
}

function renderProgress() {
  const ro = app.settings.rollover;
  const days = byDay(app.sessions, ro);
  const today = dayKey(Date.now(), ro);
  const tot = totals(app.sessions);
  const cur = currentStreak(days, today), best = bestStreak(days);
  // 26-week calendar, weeks as columns, Monday on top.
  const weeks = 26;
  const dow = (keyToDate(today).getDay() + 6) % 7;
  const start = addDays(today, -(weeks - 1) * 7 - dow);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const k = addDays(start, i);
    if (k > today) { cells.push('<i class="future"></i>'); continue; }
    const e = days.get(k);
    const m = e ? e.minutes : 0;
    const h = !e ? 0 : m < 5 ? 1 : m < 10 ? 2 : m < 20 ? 3 : 4;
    const label = e ? `${k}: ${e.sessions} session${e.sessions > 1 ? 's' : ''}, ${Math.round(m)} min` : `${k}: rest`;
    cells.push(`<i data-h="${h}" class="${e && e.sessions >= 2 ? 'twice' : ''}" title="${label}"></i>`);
  }
  const L = app.level;
  const d = activeD(L), r = rankOf(L);
  const th = thresholdsFor(d);
  const pos = (v) => `${(Math.min(4, Math.max(0, v)) / 4) * 100}%`;
  const greyLeft = Math.max(0, r - GREY);
  const holdMsg = !L.adaptive ? 'Adapting is off. Thresholds are fixed at this rank.'
    : L.greyRun > 0 ? `In the grey zone. Your rank holds for ${HOLD_SESSIONS - L.greyRun} more weak session${HOLD_SESSIONS - L.greyRun > 1 ? 's' : ''} in a row before it eases down.`
    : d >= 3.999 ? 'Top of the scale.'
    : `${Math.round((d - Math.floor(d)) * 100)}% of the way to ${RANKS[Math.min(3, Math.floor(d) + 1)].name}.`;
  $('tab-progress').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${cur}</b><span>day streak</span></div>
      <div class="stat"><b>${best}</b><span>best streak</span></div>
      <div class="stat"><b>${fmtMin(tot.minutes)}</b><span>${tot.sessions} sessions</span></div>
    </div>
    <div class="heat-wrap"><div class="heat" aria-label="Practice over the last 26 weeks">${cells.join('')}</div></div>
    <div class="legend"><span><i style="background:var(--faint)"></i>rest</span><span><i style="background:var(--heat1)"></i>under 5 min</span><span><i style="background:var(--heat3)"></i>10–20</span><span><i style="background:var(--heat4)"></i>20+</span><span><i style="box-shadow:inset 0 0 0 1.5px var(--high)"></i>twice that day</span></div>
    <div class="rankcard">
      <div class="row"><span class="big">${RANKS[r].name}</span><span class="u">difficulty ${d.toFixed(2)} of 4</span></div>
      <div class="rtrack">
        <div class="bar"></div><div class="fill" style="width:${pos(d)}"></div>
        ${L.adaptive && r > 0 ? `<div class="grey" style="left:${pos(greyLeft)};width:${(GREY / 4) * 100}%" title="Grey zone: your rank holds here"></div>` : ''}
        ${[1, 2, 3].map((i) => `<div class="tick" style="left:${pos(i)}"></div>`).join('')}
        <div class="dot" style="left:${pos(d)}"></div>
      </div>
      <div class="rlabels">${RANKS.map((x, i) => `<span class="${i <= L.peakRank ? 'on' : ''}">${x.name}</span>`).join('')}</div>
      <p class="note">Medium from ${Math.round(th.medium)}, high from ${Math.round(th.high)}. ${holdMsg}</p>
    </div>`;
}

function renderBadges() {
  const groups = {};
  for (const b of app.badges) (groups[b.group] = groups[b.group] || []).push(b);
  const earned = app.badges.filter((b) => b.count > 0).length;
  $('tab-badges').innerHTML = `<p class="note">${earned} of ${app.badges.length} earned. Repeatable badges count up: ×2, ×3 and on.</p>` +
    Object.entries(groups).map(([g, list]) => `<div class="bgroup"><h3>${esc(g)}</h3><div class="bgrid">${list.map(badgeCard).join('')}</div></div>`).join('');
}

function renderSessions() {
  const list = [...app.sessions].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 80);
  if (!list.length) {
    $('tab-sessions').innerHTML = '<div class="empty">No sessions yet. Press <b>Start session</b>, breathe for two minutes or more, and it appears here with its coherence and time in each zone.</div>';
    return;
  }
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('tab-sessions').innerHTML = `<div class="slist">${list.map((s) => {
    const t = s.timeIn || [0, 0, 0], sum = t[0] + t[1] + t[2] || 1;
    const kind = s.demo ? 'demo' : s.sensor ? s.deviceLabel : 'practice';
    return `<div class="srow"><div><div class="when">${fmt.format(new Date(s.start))}</div><div class="meta">${fmtClock(s.durationSec)} · ${esc(PATTERNS[s.pattern] ? PATTERNS[s.pattern].name : '')} · ${esc(kind)}</div></div>
      <div class="score">${s.avgScore == null ? '—' : Math.round(s.avgScore)}<div class="meta">avg</div></div>
      <div class="zonebar"><i style="width:${(100 * t[0]) / sum}%"></i><i style="width:${(100 * t[1]) / sum}%"></i><i style="width:${(100 * t[2]) / sum}%"></i></div></div>`;
  }).join('')}</div>`;
}

async function renderSettings() {
  $('adaptive').checked = app.level.adaptive;
  $('manualRank').disabled = app.level.adaptive;
  $('manualRank').value = String(app.level.manualRank);
  $('sessionMin').value = String(app.settings.sessionMin);
  $('rollover').value = String(app.settings.rollover);
  $('volume').value = String(Math.round(app.settings.volume * 100));
  $('backupBtn').hidden = !store.canBackupToFile();
  const persistent = await store.isPersistent();
  $('storageNote').textContent = persistent
    ? 'Sessions are saved in this browser on this device. Export a JSON file to keep a copy or move to another device.'
    : 'This browser is not letting Breathfield save, so sessions last only until you close the page. Export before you leave.';
  let note = '';
  try {
    const h = await store.get('backupHandle', null);
    const at = await store.get('backupAt', null);
    if (h) note = `Backing up to ${h.name} after every session${at ? `, last at ${new Date(at).toLocaleString()}` : ''}. If the browser asks again, press Back up to a file.`;
  } catch (e) { /* no backup */ }
  $('backupNote').textContent = note;
}

// ---------------------------------------------------------------- controls

function saveSettings() { store.set('settings', app.settings).catch(() => {}); }

function setPressed(groupSel, attr, val) {
  document.querySelectorAll(`${groupSel} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(val))));
}

function setScene(i) {
  app.settings.scene = i;
  setPressed('#scenes', 'scene', i);
  if (app.session) app.session.scenes.add(SCENES[i].id);
  scenes && scenes.clear();
  saveSettings();
}

function setPattern(i) {
  app.settings.pattern = i;
  app.pacer0 = now();
  $('pat').value = String(i);
  $('rate').textContent = perMinute(i).toFixed(1);
  saveSettings();
}

$('scenes').innerHTML = SCENES.map((s, i) => `<button data-scene="${i}" aria-pressed="false">${s.name}</button>`).join('');
$('pat').innerHTML = PATTERNS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
$('manualRank').innerHTML = RANKS.map((r, i) => `<option value="${i}">${r.name}</option>`).join('');

$('scenes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setScene(+b.dataset.scene); });
$('pat').addEventListener('change', (e) => setPattern(+e.target.value));
$('sensorBtn').addEventListener('click', () => openPanel('sensorPanel'));
$('journalBtn').addEventListener('click', () => openPanel('journalPanel'));
$('sessionBtn').addEventListener('click', () => (app.session ? endSession() : startSession()));
$('guide').addEventListener('click', () => {
  app.settings.guide = !app.settings.guide;
  $('guide').setAttribute('aria-pressed', String(app.settings.guide));
  $('ui').classList.toggle('noguide', !app.settings.guide);
  saveSettings();
});
const drone = new Drone();
$('sound').addEventListener('click', () => {
  const on = $('sound').getAttribute('aria-pressed') !== 'true';
  $('sound').setAttribute('aria-pressed', String(on));
  if (on) drone.start(); else drone.stop();
});
function toggleFull() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else { const r = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); r && r.catch && r.catch(() => {}); }
  } catch (e) { /* not allowed here */ }
}
$('full').addEventListener('click', toggleFull);

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  document.querySelectorAll('#tabs [data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${b.dataset.tab}`; });
});

$('adaptive').addEventListener('change', async (e) => {
  app.level = { ...app.level, adaptive: e.target.checked };
  await store.set('level', app.level); renderJournal();
});
$('manualRank').addEventListener('change', async (e) => {
  app.level = { ...app.level, manualRank: +e.target.value };
  await store.set('level', app.level); renderJournal();
});
$('sessionMin').addEventListener('change', (e) => { app.settings.sessionMin = +e.target.value; saveSettings(); });
$('rollover').addEventListener('change', (e) => { app.settings.rollover = +e.target.value; saveSettings(); app.badges = evaluateBadges(); renderJournal(); });
$('volume').addEventListener('input', (e) => { app.settings.volume = e.target.value / 100; drone.volume = app.settings.volume; saveSettings(); });
$('exportBtn').addEventListener('click', async () => {
  store.download(`breathfield-journal-${new Date().toISOString().slice(0, 10)}.json`, await store.exportAll());
});
$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const added = await store.importAll(JSON.parse(await f.text()));
    await loadAll();
    toast(`Imported ${added} new session${added === 1 ? '' : 's'}.`);
  } catch (err) { toast(err.message || 'That file could not be read.'); }
  e.target.value = '';
});
$('backupBtn').addEventListener('click', async () => {
  try {
    const h = await store.get('backupHandle', null);
    const r = h ? await store.writeBackup(true) : await store.chooseBackupFile();
    toast(r.state === 'ok' ? `Saved to ${r.name}. It updates after every session.` : 'Backup needs permission to write the file.');
  } catch (err) { if (err.name !== 'AbortError') toast('Could not save the backup file.'); }
  renderSettings();
});

function openPanel(id) {
  ['sensorPanel', 'journalPanel'].forEach((p) => { $(p).hidden = p !== id; });
  ui.classList.remove('idle');
  if (id === 'sensorPanel') { renderDevices(); drawWave(); }
  if (id === 'journalPanel') renderJournal();
  const first = $(id).querySelector('button');
  first && first.focus();
}
function closePanels() { ['sensorPanel', 'journalPanel'].forEach((p) => { $(p).hidden = true; }); }
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { $(b.dataset.close).hidden = true; }));

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

// Fade the controls while you breathe.
const ui = $('ui');
let idleTimer = 0;
const panelOpen = () => !$('sensorPanel').hidden || !$('journalPanel').hidden || !$('summary').hidden;
function poke() {
  ui.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!panelOpen() && !$('dock').matches(':hover') && !$('dock').querySelector(':focus-visible')) ui.classList.add('idle');
  }, 3500);
}
addEventListener('pointermove', poke);
addEventListener('pointerdown', () => { poke(); wake(); });

function setHold(v) { app.holding = v; app.lastInput = now(); }
function wake() { try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) { /* not allowed */ } }

addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  poke();
  if (e.code === 'Space') {
    if (typing || tag === 'BUTTON') return;
    e.preventDefault(); if (!e.repeat) setHold(true); wake(); return;
  }
  if (e.key === 'Escape') { closePanels(); $('summary').hidden = true; return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Enter' && tag !== 'BUTTON') { app.session ? endSession() : startSession(); return; }
  if (e.key >= '1' && e.key <= '4') setScene(+e.key - 1);
  else if (e.key === 'h' || e.key === 'H') ui.classList.toggle('bare');
  else if (e.key === 'g' || e.key === 'G') $('guide').click();
  else if (e.key === 'f' || e.key === 'F') toggleFull();
  else if (e.key === 'j' || e.key === 'J') ($('journalPanel').hidden ? openPanel('journalPanel') : closePanels());
});
addEventListener('keyup', (e) => { if (e.code === 'Space') { e.preventDefault(); setHold(false); } });

// ---------------------------------------------------------------- p5 loop

let scenes = null;
let T = 0, hue = Math.random(), travel = 0, secTimer = 0;

new p5((p) => {
  p.setup = () => {
    const c = p.createCanvas(window.innerWidth, window.innerHeight);
    c.parent('stage');
    p.pixelDensity(Math.min(2, p.displayDensity()));
    scenes = createScenes(p);
    scenes.resize();
    scenes.clear();
    if (!scenes.glOK) document.querySelectorAll('[data-scene="0"],[data-scene="1"]').forEach((b) => { b.disabled = true; });
    c.elt.addEventListener('pointerdown', (e) => { e.preventDefault(); setHold(true); });
    addEventListener('pointerup', () => { if (app.holding) setHold(false); });
    addEventListener('pointercancel', () => setHold(false));
  };
  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    scenes.resize(); scenes.clear();
  };
  p.draw = () => {
    const dt = Math.min(p.deltaTime / 1000, 0.1);
    const t = now();
    const sdt = dt * motion;
    T += sdt;
    const br = breathAt(t - app.pacer0, app.settings.pattern);
    app.breathB = br.b;
    const r = app.engine.update(t);
    if (r) onScore(r);
    const target = app.score == null ? 0.3 : visualLevel(app.score, currentThresholds());
    app.visual += (target - app.visual) * Math.min(1, dt * 0.6);
    hue += sdt * (0.006 + 0.02 * (1 - app.visual));
    travel += sdt * (0.2 + 0.55 * br.b);
    scenes.draw({ scene: app.settings.scene, b: br.b, coh: app.visual, T, dt: sdt, hue, travel });
    if (app.settings.guide) drawGuide(p, br, app.deviceId === 'practice' && app.holding);
    renderHud(br);
    drone.update(br.b, app.score == null ? null : app.visual);
    if (app.session && app.settings.sessionMin && t - app.session.t0 >= app.settings.sessionMin * 60) endSession(true);
    secTimer += dt;
    if (secTimer >= 1) { secTimer = 0; renderSecond(); }
  };
});

// ---------------------------------------------------------------- start

async function loadAll() {
  try {
    app.settings = { ...DEFAULT_SETTINGS, ...(await store.get('settings', {})) };
    app.level = { ...initialLevelState(), ...(await store.get('level', {})) };
    app.sessions = await store.allSessions();
  } catch (e) { /* first run or storage blocked */ }
  drone.volume = app.settings.volume;
  app.badges = evaluateBadges();
  renderJournal();
}

// Handy from the browser console, e.g. breathfield.app.level
window.breathfield = { app, startSession, endSession, connect };

(async function start() {
  await loadAll();
  setScene(app.settings.scene);
  setPattern(app.settings.pattern);
  $('guide').setAttribute('aria-pressed', String(app.settings.guide));
  $('ui').classList.toggle('noguide', !app.settings.guide);
  // Sensors that need a browser dialog cannot reconnect on their own, so we
  // start with practice (or the demo) and let you pick the sensor again.
  connect(['practice', 'demo'].includes(app.settings.device) ? app.settings.device : 'practice');
  poke();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
