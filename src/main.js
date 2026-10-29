import { PATTERNS, breathAt, perMinute, cycleSec, setCustom, CUSTOM } from './engine/breath.js';
import { CoherenceEngine, STEP_SEC, MIN_SEC } from './engine/coherence.js';
import { RANKS, thresholdsFor, zoneOf, visualLevel, initialLevelState, activeD, rankOf, adaptAfterSession, GREY, HOLD_SESSIONS } from './engine/levels.js';
import { evaluate, gained } from './engine/achievements.js';
import { byDay, runs, currentStreak, bestStreak, totals, dayKey, addDays, keyToDate, MIN_SESSION_SEC } from './engine/progress.js';
import * as store from './store.js';
import { Drone } from './audio.js';
import { SCENES, createScenes, drawGuide, drawWaveGuide } from './visuals/scenes.js';
const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
import { badgeGlyph } from './visuals/badges.js';
import { PracticeKeys, DemoSensor } from './devices/simulated.js';
import { BleHeartRate } from './devices/ble-hr.js';
import { EmWaveHid } from './devices/emwave-hid.js';
import { CameraPpg } from './devices/camera-ppg.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL = { low: css('--low'), mid: css('--mid'), high: css('--high') };
function refreshColours() { COL.low = css('--low'); COL.mid = css('--mid'); COL.high = css('--high'); }
const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
/** Palette colour for a 0..1 level: low at 0, medium at 0.5, high at 1. */
function levelColour(v) {
  const [a, b, u] = v < 0.5 ? [COL.low, COL.mid, v / 0.5] : [COL.mid, COL.high, (v - 0.5) / 0.5];
  const A = rgb(a), B = rgb(b);
  return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * u)).join(',')})`;
}
const ZONE_NAMES = ['low', 'medium', 'high'];
const fmtClock = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtMin = (m) => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);
const now = () => performance.now() / 1000;
const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.45 : 1;

const DEFAULT_SETTINGS = { scene: 0, pattern: 0, guideMode: 'full', guideStyle: 'ring', volume: 0.6, sessionMin: 10, rollover: 3, device: 'practice', colours: 'own',
  coherenceTint: 'soft', quality: 'auto', screenLight: false, palette: 'classic', custom: { inS: 5, holdIn: 0, outS: 5, holdOut: 0 } };

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
  flashes: [],
  emwave: null, // latest verdict from a connected emWave {zone, entrainment, level, achievement, t}
};

const followEmwave = () => app.settings.colours === 'emwave' && app.deviceId === 'emwave' && app.emwave && now() - app.emwave.t < 15;
const shownZone = () => (followEmwave() ? app.emwave.zone : app.zone);

// ---------------------------------------------------------------- devices

const DEVICES = [
  { id: 'practice', cls: PracticeKeys, make: () => new PracticeKeys({ holding: () => app.holding, lastInput: () => app.lastInput }),
    title: 'Practice without a sensor', short: 'Practice', tag: 'always works',
    desc: 'Hold space, or press and hold the screen, while you breathe in, and let go as you breathe out. Breathing evenly with the pacer builds coherence. Counts for streaks, not for rank.' },
  { id: 'ble', cls: BleHeartRate, title: 'Bluetooth heart-rate strap', short: 'Strap', tag: 'most accurate', good: true,
    desc: 'Polar H10, Garmin HRM, Wahoo TICKR or any strap that sends beat intervals. Chrome or Edge.' },
  { id: 'emwave', cls: EmWaveHid, title: 'emWave 2 (USB)', short: 'emWave', tag: 'read-only', good: true,
    desc: 'Quit emWave Pro, plug in the emWave 2 and start a session on it. Breathfield reads its heartbeats and its own low / medium / high verdict, and never writes to the device.' },
  { id: 'camera', cls: CameraPpg, make: () => new CameraPpg({ deviceId: app.settings.cameraId }), title: 'Fingertip on the camera', short: 'Camera', tag: 'phone',
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
  app.emwave = null; renderEmwave();
  dev.addEventListener('beat', (e) => onBeat(dev, e.detail));
  dev.addEventListener('pulse', (e) => {
    const s = app.session;
    if (app.device !== dev || !s) return;
    const t = e.detail.t - s.t0;
    if (!s.ppg.length || t - s.ppg[s.ppg.length - 1][0] >= 1 / 15) s.ppg.push([+t.toFixed(3), +e.detail.v.toFixed(2)]);
  });
  dev.addEventListener('status', () => { if (app.device === dev) renderStatus(); });
  dev.addEventListener('idle', () => {
    if (app.device !== dev) return;
    app.score = null; app.zone = null; app.emwave = null; renderEmwave();
    toast(app.session ? 'The emWave stopped its session. Breathfield keeps recording; press the emWave\'s button to continue.' : 'The emWave is connected but not running a session. Press its button to start one.');
  });
  dev.addEventListener('active', () => { if (app.device === dev) { app.engine.reset(); toast('The emWave started a session.'); } });
  dev.addEventListener('verdict', (e) => {
    // The emWave's own low/medium/high and E, kept with the session to compare and calibrate.
    const v = e.detail, s = app.session;
    if (app.device !== dev) return;
    app.emwave = v;
    renderEmwave();
    if (s) s.emwave.push([+(v.t - s.t0).toFixed(1), v.zone, v.entrainment, v.level, v.achievement]);
  });
  renderStatus();
  renderDevices();
  applyScreenLight();
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
  // The beat light: shown at the beat's own time, delayed by the source's batching lag
  // so the blinks keep your real rhythm instead of bunching up when a batch arrives.
  app.flashes.push({ at: t + (dev.lag || 0), ok });
  if (app.flashes.length > 20) app.flashes.shift();
}

// Screen light: a bright band at the top of the screen, next to the front camera,
// so a fingertip on the front lens is lit from the screen.
function applyScreenLight() {
  const on = app.settings.screenLight && app.deviceId === 'camera';
  $('screenLight').hidden = !on;
}

let beatGlow = 0, beatOk = true;
function renderBeatLight() {
  const tNow = now();
  while (app.flashes.length && app.flashes[0].at <= tNow) {
    const f = app.flashes.shift();
    if (tNow - f.at < 0.5) { beatGlow = 1; beatOk = f.ok; }
  }
  beatGlow *= 0.9;
  const el = $('beatDot');
  el.style.opacity = (0.15 + 0.85 * beatGlow).toFixed(3);
  el.style.transform = `scale(${(0.8 + 0.5 * beatGlow).toFixed(3)})`;
  el.dataset.ok = beatOk ? '1' : '0';
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
    ...(app.settings.pattern === CUSTOM ? { customSteps: PATTERNS[CUSTOM].steps.map((x) => [...x]) } : {}),
    scenes: new Set([SCENES[app.settings.scene].id]),
    d: +activeD(app.level).toFixed(3),
    thresholds: thresholdsFor(activeD(app.level)),
    lengthMin: app.settings.sessionMin, // a change mid-session applies from the next one
    timeIn: [0, 0, 0],
    scores: [],
    hrs: [],
    ibis: [],
    ppg: [],
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
    pattern: s.pattern, patternId: s.patternId, ...(s.customSteps ? { customSteps: s.customSteps } : {}), scenes: [...s.scenes],
    d: s.d, thresholds: s.thresholds,
    timeIn: s.timeIn, avgScore: avg(s.scores.map((x) => x[1])), avgHr: avg(s.hrs),
    scores: s.scores, ibis: s.ibis, ...(s.emwave.length ? { emwave: s.emwave } : {}), ...(s.ppg.length ? { ppg: s.ppg } : {}), endedBy: auto ? 'timer' : 'you',
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
  return evaluate(app.sessions, app.level, { rollover: app.settings.rollover, patternCount: PATTERNS.length, sceneCount: SCENES.length });
}

/** "The emWave said: high 80% · medium 15% · low 5%" for sessions recorded with it. */
function ewLine(rec) {
  const e = rec.emwave;
  if (!e || !e.length) return '';
  const c = [0, 0, 0];
  e.forEach((x) => { if (c[x[1]] != null) c[x[1]]++; });
  const pc = (n) => Math.round((100 * n) / e.length);
  const t = rec.timeIn, sum = t[0] + t[1] + t[2] || 1;
  return `<p class="msg">The emWave said high ${pc(c[2])}%, medium ${pc(c[1])}%, low ${pc(c[0])}% of the time. Breathfield said high ${Math.round((100 * t[2]) / sum)}%.</p>`;
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
    ${ewLine(rec)}
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

function renderEmwave() {
  const v = app.emwave;
  $('ewRow').hidden = !v;
  if (!v) return;
  $('ewDot').dataset.z = v.zone;
  $('ewZone').textContent = ZONE_NAMES[v.zone] || '—';
  $('ewE').textContent = v.entrainment != null ? `E ${v.entrainment}` : '';
}

function renderStatus() {
  const dev = app.device;
  const el = $('src');
  el.textContent = dev ? dev.text || dev.label : 'No heart source';
  el.dataset.state = dev ? dev.state : 'off';
  const def = DEVICES.find((d) => d.id === app.deviceId);
  $('sensorName').textContent = def ? def.short : 'No sensor';
  $('sensorDot').dataset.state = dev ? dev.state : 'off';
  if (!$('sensorPanel').hidden) renderDevices();
}

function renderDevices() {
  const list = $('deviceList');
  list.innerHTML = DEVICES.map((d) => {
    const why = d.cls.support();
    const active = app.deviceId === d.id && app.device;
    const st = active ? `<div class="st" data-state="${app.device.state}">${esc(app.device.text || '')}</div>` : '';
    let extra = d.id === 'emwave' && active ? `<button class="solo" data-capture>Save raw recording (${app.device.packets.length} packets)</button>` : '';
    if (d.id === 'camera' && active) {
      if (!app.device.front) extra += `<button class="solo" data-torch aria-pressed="${app.device.torch}">${app.device.torch ? 'Flashlight on' : app.device.torchSupported ? 'Flashlight off' : 'Try flashlight'}</button>`;
      extra += `<button class="solo" data-screenlight aria-pressed="${app.settings.screenLight}">Screen light ${app.settings.screenLight ? 'on' : 'off'}</button>`;
    }
    if (d.id === 'camera' && active && app.device.cameras && app.device.cameras.length > 1) {
      extra += `<label class="field camsel" for="cameraSel"><span>Camera${app.device.lens ? ` · now ${esc(app.device.lens)}` : ''}</span><select id="cameraSel">${app.device.cameras.map((c) => `<option value="${esc(c.id)}" ${c.id === app.device.current ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>`;
    }
    return `<div class="dev ${active ? 'active' : ''}">
      <div class="dev-head"><h4>${esc(d.title)}</h4><span class="tag ${d.good ? 'good' : ''}">${esc(d.tag)}</span></div>
      <p>${esc(d.desc)}</p>
      ${why ? `<p class="why">${esc(why)}</p>` : ''}
      ${st}
      <div class="btns">
        ${active ? `<button class="solo" data-disconnect="${d.id}">Disconnect</button>` : `<button class="solo primary" data-connect="${d.id}" ${why ? 'disabled' : ''}>Use this</button>`}
        ${extra}
      </div>${d.id === 'camera' && active ? `<div class="camrow"><div class="campreview-slot"></div><canvas id="ppgTrace" width="480" height="150" aria-label="Pulse signal from the camera, last 6 seconds"></canvas></div>
        ${app.device.torchNote ? `<p class="why">${esc(app.device.torchNote)}</p>` : ''}
        ${app.device.diag ? `<p class="diag">${esc(app.device.diag.lens)} · facing ${esc(app.device.diag.facing)} · light ${esc(app.device.diag.torch)} · fill ${esc(app.device.diag.fill)} · ${esc(String(app.device.diag.fps))} fps</p>` : ''}` : ''}</div>`;
  }).join('');
  const slot = list.querySelector('.campreview-slot');
  if (slot && app.device && app.device.video) slot.appendChild(app.device.video);
  const sel = $('cameraSel');
  if (sel) sel.addEventListener('change', (e) => { app.settings.cameraId = e.target.value; saveSettings(); connect('camera'); });
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
  if (e.target.closest('[data-torch]') && app.device && app.device.setTorch) {
    await app.device.setTorch(!app.device.torch); renderDevices();
  }
  if (e.target.closest('[data-screenlight]')) {
    app.settings.screenLight = !app.settings.screenLight; saveSettings(); applyScreenLight(); renderDevices();
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
  const z = shownZone();
  const lvl = z == null ? 0 : z + 1;
  if (lvl !== lastLvl) {
    $('meter').dataset.lvl = lvl;
    $('lvl').textContent = lvl ? ZONE_NAMES[lvl - 1] : 'warming up';
    $('lvl').style.color = lvl ? [COL.low, COL.mid, COL.high][lvl - 1] : '';
    lastLvl = lvl;
  }
}

// Coherence colour over the scene: a hue tint plus brightness (dim when scattered, glow when coherent).
let lastTint = '';
function renderTint(level) {
  const k = { off: 0, soft: 0.55, strong: 1 }[app.settings.coherenceTint] || 0;
  const known = app.score != null || followEmwave();
  const v = known ? level : 0.5;
  const c = levelColour(v);
  const key = `${k}|${c}|${v.toFixed(2)}`;
  if (key === lastTint) return;
  lastTint = key;
  const tc = $('tintColor'), tg = $('tintGlow'), cv = document.querySelector('#stage canvas');
  if (!k || !known) {
    tc.style.opacity = '0'; tg.style.opacity = '0';
    if (cv) cv.style.filter = '';
    return;
  }
  tc.style.backgroundColor = c;
  tc.style.opacity = (0.5 * k).toFixed(3);
  // The glow is the brightness cue for high coherence: kept close to the centre and gentle.
  tg.style.background = `radial-gradient(circle at 50% 50%, ${c} 0%, transparent 52%)`;
  tg.style.opacity = (Math.max(0, v - 0.55) * 0.55 * k).toFixed(3);
  if (cv) cv.style.filter = `brightness(${(1 - Math.max(0, 0.5 - v) * 1.1 * k).toFixed(3)})`;
}

/** Smoothed heart rate and RMSSD over the last 30 clean beats, for the scenes. */
function updateHeartState() {
  const hr = app.engine.heartRate();
  if (hr) app.hrSmooth = app.hrSmooth ? app.hrSmooth + (hr - app.hrSmooth) * 0.25 : hr;
  const b = app.beats.filter((x) => x.ok).slice(-31).map((x) => x.ibi);
  if (b.length > 5) {
    let s = 0;
    for (let i = 1; i < b.length; i++) s += (b[i] - b[i - 1]) ** 2;
    const rmssd = Math.sqrt(s / (b.length - 1));
    app.hrv = app.hrv ? app.hrv + (rmssd - app.hrv) * 0.25 : rmssd;
  }
}

function renderSecond() {
  updateHeartState();
  // A sensor that stops sending beats should not leave an old score on screen.
  const lastBeat = app.beats.length ? app.beats[app.beats.length - 1].t : null;
  if (app.score != null && app.device && (lastBeat == null || now() - lastBeat > 8)) { app.score = null; app.zone = null; }
  $('score').textContent = app.score == null ? '—' : Math.round(app.score);
  if (app.score == null && app.device) {
    const have = app.engine.beats.length ? now() - app.engine.beats[0].t : 0;
    $('lvl').textContent = app.engine.beats.length ? `warming up ${Math.max(0, Math.ceil(MIN_SEC - have))}s` : 'waiting for beats';
  }
  const hr = app.engine.heartRate();
  $('hr').textContent = hr ? Math.round(hr) : '—';
  $('clock').textContent = app.session ? fmtClock(now() - app.session.t0) + (app.session.lengthMin ? ` / ${app.session.lengthMin}:00` : '') : 'not recording';
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

/** Raw camera signal, last 6 s: a clear, regular wave means a good reading. */
function drawPpgTrace() {
  const c = $('ppgTrace');
  if (!c || !app.device || !app.device.trace) return;
  const x = c.getContext('2d'), w = c.width, h = c.height, tr = app.device.trace;
  x.clearRect(0, 0, w, h);
  if (tr.length < 5) return;
  const t1 = tr[tr.length - 1][0], t0 = t1 - 6;
  const vals = tr.filter((p) => p[2]).map((p) => p[1]);
  if (vals.length < 5) { x.fillStyle = css('--mute'); x.font = '22px ' + css('--f-mono'); x.fillText('no finger on the lens', 16, h / 2); return; }
  // Remove the slow drift so the heartbeat wiggle fills the box.
  let lo = Infinity, hi = -Infinity;
  const pts = [];
  for (let i = 0; i < tr.length; i++) {
    if (!tr[i][2]) continue;
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 15); j <= Math.min(tr.length - 1, i + 15); j++) { s += tr[j][1]; n++; }
    const v = tr[i][1] - s / n;
    pts.push([tr[i][0], v]); lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const span = Math.max(0.3, hi - lo);
  x.strokeStyle = css('--accent'); x.lineWidth = 3;
  x.beginPath();
  pts.forEach(([t, v], i) => { const px = ((t - t0) / 6) * w, py = h - 10 - ((v - lo) / span) * (h - 20); i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.stroke();
  // Mark detected beats.
  x.fillStyle = css('--ink');
  for (const b of app.beats) if (b.t >= t0) { const px = ((b.t - t0) / 6) * w; x.fillRect(px - 1, 0, 2, 12); }
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
  $('colours').value = app.settings.colours;
  $('quality').value = app.settings.quality;
  $('tint').value = app.settings.coherenceTint;
  $('palette').value = app.settings.palette;
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
  $('sceneSel').value = String(i);
  $('stage').classList.toggle('orbit', SCENES[i].id === 'lines');
  if (app.session) app.session.scenes.add(SCENES[i].id);
  scenes && scenes.clear();
  saveSettings();
}

function applyCustom() {
  const c = app.settings.custom;
  setCustom(c);
  const opt = $('pat').querySelector(`option[value="${CUSTOM}"]`);
  if (opt) opt.textContent = PATTERNS[CUSTOM].name;
  for (const k of ['inS', 'holdIn', 'outS', 'holdOut']) {
    $(k).value = String(c[k]);
    $(`${k}V`).textContent = String(c[k]);
  }
  $('paceRate').textContent = perMinute(CUSTOM).toFixed(1);
  if (app.settings.pattern === CUSTOM) $('rate').textContent = perMinute(CUSTOM).toFixed(1);
}

function setPattern(i) {
  app.settings.pattern = i;
  app.pacer0 = now();
  $('pat').value = String(i);
  $('rate').textContent = perMinute(i).toFixed(1);
  saveSettings();
}

$('sceneSel').innerHTML = SCENES.map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
$('pat').innerHTML = PATTERNS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
$('manualRank').innerHTML = RANKS.map((r, i) => `<option value="${i}">${r.name}</option>`).join('');

$('sceneSel').addEventListener('change', (e) => setScene(+e.target.value));
$('pat').addEventListener('change', (e) => setPattern(+e.target.value));
$('paceBtn').addEventListener('click', () => openPanel('pacePanel'));
function onPaceInput() {
  app.settings.custom = { inS: +$('inS').value, holdIn: +$('holdIn').value, outS: +$('outS').value, holdOut: +$('holdOut').value };
  applyCustom();
  if (app.settings.pattern !== CUSTOM) setPattern(CUSTOM); else saveSettings();
}
['inS', 'holdIn', 'outS', 'holdOut'].forEach((k) => $(k).addEventListener('input', onPaceInput));
$('pacePanel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  const [inS, holdIn, outS, holdOut] = b.dataset.preset.split(',').map(Number);
  Object.assign(app.settings.custom, { inS, holdIn, outS, holdOut });
  applyCustom();
  onPaceInput();
});
function setPalette(v) {
  app.settings.palette = v;
  document.documentElement.dataset.palette = v;
  refreshColours(); lastLvl = -1; lastTint = '';
  saveSettings();
}
$('palette').addEventListener('change', (e) => { setPalette(e.target.value); renderJournal(); });
$('tint').addEventListener('change', (e) => { app.settings.coherenceTint = e.target.value; lastTint = ''; saveSettings(); });
$('sensorBtn').addEventListener('click', () => openPanel('sensorPanel'));
$('journalBtn').addEventListener('click', () => openPanel('journalPanel', 'progress'));
$('settingsBtn').addEventListener('click', () => openPanel('journalPanel', 'settings'));
$('sessionBtn').addEventListener('click', () => (app.session ? endSession() : startSession()));
// The breathing guide: words and seconds → seconds only → shape only → off.
const GUIDE_MODES = ['full', 'numbers', 'none', 'off'];
const GUIDE_LABELS = { full: 'Guide', numbers: 'Guide: seconds', none: 'Guide: quiet', off: 'Guide: off' };
function applyGuide() {
  const { guideMode: m, guideStyle: s } = app.settings;
  const b = $('guide');
  b.title = `${GUIDE_LABELS[m]} (G)`;
  b.setAttribute('aria-label', GUIDE_LABELS[m]);
  b.dataset.mode = m;
  b.setAttribute('aria-pressed', String(m !== 'off'));
  const ui = $('ui');
  ui.classList.toggle('noguide', m === 'off' || m === 'none');
  ui.classList.toggle('guide-numbers', m === 'numbers');
  ui.classList.toggle('guide-wave', s === 'wave');
  if ($('guideMode')) { $('guideMode').value = m; $('guideStyle').value = s; }
}
$('guide').addEventListener('click', () => {
  const m = app.settings.guideMode;
  app.settings.guideMode = GUIDE_MODES[(GUIDE_MODES.indexOf(m) + 1) % GUIDE_MODES.length];
  applyGuide(); saveSettings();
});
$('guideMode').addEventListener('change', (e) => { app.settings.guideMode = e.target.value; applyGuide(); saveSettings(); });
$('guideStyle').addEventListener('change', (e) => { app.settings.guideStyle = e.target.value; applyGuide(); saveSettings(); });
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
$('quality').addEventListener('change', (e) => {
  app.settings.quality = e.target.value; saveSettings();
  applyQuality(e.target.value === 'auto' ? (isPhone ? 'light' : 'full') : e.target.value);
});
$('colours').addEventListener('change', (e) => { app.settings.colours = e.target.value; saveSettings(); });
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

function showTab(name) {
  document.querySelectorAll('#tabs [data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === name)));
  document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${name}`; });
}

function openPanel(id, tab) {
  ['sensorPanel', 'journalPanel', 'pacePanel'].forEach((p) => { $(p).hidden = p !== id; });
  if (tab) showTab(tab);
  ui.classList.remove('idle');
  if (id === 'sensorPanel') { renderDevices(); drawWave(); }
  if (id === 'journalPanel') renderJournal();
  const first = $(id).querySelector('button');
  first && first.focus();
}
function closePanels() { ['sensorPanel', 'journalPanel', 'pacePanel'].forEach((p) => { $(p).hidden = true; }); }
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
const panelOpen = () => !$('sensorPanel').hidden || !$('journalPanel').hidden || !$('pacePanel').hidden || !$('summary').hidden;
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
  if (e.key >= '1' && e.key <= String(SCENES.length)) setScene(+e.key - 1);
  else if (e.key === ',') openPanel('journalPanel', 'settings');
  else if (e.key === 'h' || e.key === 'H') ui.classList.toggle('bare');
  else if (e.key === 'g' || e.key === 'G') $('guide').click();
  else if (e.key === 'f' || e.key === 'F') toggleFull();
  else if (e.key === 'c' || e.key === 'C') {
    const order = ['off', 'soft', 'strong'];
    app.settings.coherenceTint = order[(order.indexOf(app.settings.coherenceTint) + 1) % 3];
    lastTint = ''; saveSettings();
    toast(`Coherence colour: ${app.settings.coherenceTint}`);
  }
  else if (e.key === 'j' || e.key === 'J') ($('journalPanel').hidden ? openPanel('journalPanel') : closePanels());
});
addEventListener('keyup', (e) => { if (e.code === 'Space') { e.preventDefault(); setHold(false); } });

// ---------------------------------------------------------------- p5 loop

let scenes = null, P = null, qualityNow = null;
const fpsWin = { n: 0, t0: 0, warned: false };

/** full or light: pixel density, frame rate and scene detail. */
function applyQuality(level, initial = false) {
  if (!P || !scenes || (level === qualityNow && !initial)) return;
  qualityNow = level;
  scenes.setQuality(level);
  P.pixelDensity(level === 'light' ? 1 : Math.min(2, P.displayDensity()));
  P.frameRate(level === 'light' ? 30 : 60);
  P.resizeCanvas(window.innerWidth, window.innerHeight);
  scenes.resize(); scenes.clear();
  fpsWin.n = 0; fpsWin.t0 = performance.now();
}

/** Auto mode: if it runs below 40 fps for 5 seconds, switch to light once. */
function watchFps() {
  if (app.settings.quality !== 'auto' || qualityNow !== 'full' || document.hidden) { fpsWin.n = 0; fpsWin.t0 = performance.now(); return; }
  fpsWin.n++;
  const el = performance.now() - fpsWin.t0;
  if (el > 5000) {
    const fps = (fpsWin.n * 1000) / el;
    fpsWin.n = 0; fpsWin.t0 = performance.now();
    if (fps < 40) { applyQuality('light'); toast(`Switched to light graphics to keep things smooth (was ${Math.round(fps)} fps).`); }
  }
}
let T = 0, hue = Math.random(), travel = 0, secTimer = 0;

new p5((p) => {
  p.setup = () => {
    const c = p.createCanvas(window.innerWidth, window.innerHeight);
    c.parent('stage');
    P = p;
    scenes = createScenes(p);
    applyQuality(app.settings.quality === 'auto' ? (isPhone ? 'light' : 'full') : app.settings.quality, true);
    if (!scenes.glOK) document.querySelectorAll('#sceneSel option[value="0"],#sceneSel option[value="1"]').forEach((o) => { o.disabled = true; });
    // Press and hold = breathing in (practice). In Lines, dragging turns the figure instead.
    const drag = { on: false, moved: false, x: 0, y: 0, t: 0, vx: 0, vy: 0 };
    const orbitable = () => SCENES[app.settings.scene].id === 'lines';
    c.elt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      Object.assign(drag, { on: true, moved: false, x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 });
      try { c.elt.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      setHold(true);
    });
    c.elt.addEventListener('pointermove', (e) => {
      if (!drag.on || !orbitable()) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      if (!drag.moved) { drag.moved = true; if (app.holding) setHold(false); $('stage').classList.add('grabbing'); }
      const now = performance.now(), dt = Math.max(1, now - drag.t);
      drag.vx = (dx / dt) * 1000; drag.vy = (dy / dt) * 1000;
      scenes.orbitBy(dx, dy);
      Object.assign(drag, { x: e.clientX, y: e.clientY, t: now });
    });
    const end = () => {
      if (drag.on && drag.moved) scenes.orbitRelease(performance.now() - drag.t < 80 ? drag.vx : 0, performance.now() - drag.t < 80 ? drag.vy : 0);
      drag.on = false; $('stage').classList.remove('grabbing');
      if (app.holding) setHold(false);
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    c.elt.addEventListener('wheel', (e) => { if (!orbitable()) return; e.preventDefault(); scenes.zoomBy(e.deltaY); }, { passive: false });
    c.elt.addEventListener('dblclick', () => { if (orbitable()) scenes.resetView(); });
  };
  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    scenes.resize(); scenes.clear();
  };
  p.draw = () => {
    watchFps();
    const dt = Math.min(p.deltaTime / 1000, 0.1);
    const t = now();
    const sdt = dt * motion;
    T += sdt;
    const br = breathAt(t - app.pacer0, app.settings.pattern);
    app.breathB = br.b;
    const r = app.engine.update(t);
    if (r) onScore(r);
    const target = followEmwave() ? [0.18, 0.5, 0.85][app.emwave.zone] ?? 0.3
      : app.score == null ? 0.3 : visualLevel(app.score, currentThresholds());
    app.visual += (target - app.visual) * Math.min(1, dt * 0.6);
    hue += sdt * (0.006 + 0.02 * (1 - app.visual));
    travel += sdt * (0.2 + 0.55 * br.b);
    scenes.draw({ scene: app.settings.scene, b: br.b, coh: app.visual, T, dt: sdt, hue, travel, hr: app.hrSmooth, hrv: app.hrv });
    if (app.settings.guideMode !== 'off') {
      const active = app.deviceId === 'practice' && app.holding;
      if (app.settings.guideStyle === 'wave') {
        const pat = app.settings.pattern;
        drawWaveGuide(p, (tt) => breathAt(tt, pat).b, t - app.pacer0, cycleSec(pat), active);
      } else drawGuide(p, br, active);
    }
    renderHud(br);
    renderBeatLight();
    if (app.deviceId === 'camera' && !$('sensorPanel').hidden) drawPpgTrace();
    renderTint(app.visual);
    drone.update(br.b, app.score == null ? null : app.visual);
    if (app.session && app.session.lengthMin && t - app.session.t0 >= app.session.lengthMin * 60) endSession(true);
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
  app.settings.custom = { ...DEFAULT_SETTINGS.custom, ...(app.settings.custom || {}) };
  setPalette(app.settings.palette);
  applyCustom();
  setScene(app.settings.scene);
  setPattern(app.settings.pattern);
  if (app.settings.guide === false && !('guideMode' in (await store.get('settings', {})))) app.settings.guideMode = 'off';
  delete app.settings.guide;
  applyGuide();
  if (P) applyQuality(app.settings.quality === 'auto' ? (isPhone ? 'light' : 'full') : app.settings.quality);
  // Sensors that need a browser dialog cannot reconnect on their own, so we
  // start with practice (or the demo) and let you pick the sensor again.
  connect(['practice', 'demo'].includes(app.settings.device) ? app.settings.device : 'practice');
  poke();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
