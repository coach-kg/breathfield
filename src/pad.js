// Pacer pad: the phone runs the same breathing pacer as Breathfield on the
// computer and vibrates with it, on its own clock: the link carries the
// pattern and the moment the pacer started (wall-clock milliseconds), and both
// devices keep internet time, so they stay in step to about a tenth of a
// second. A nudge corrects any leftover offset.
//
// Link: pad.html#p=i5,o5&e=1793364476635&r=topic   (i in, o out, h hold; seconds)
// With r (a relay topic), later pace changes and coherence taps arrive through
// the relay (src/relay.js), so there is no need to scan again.

import { PATTERNS, CUSTOM, breathAt, perMinute } from './engine/breath.js';
import { createHaptics, canVibrate } from './haptics.js';
import { subscribe } from './relay.js';

const $ = (id) => document.getElementById(id);
const KIND = { i: 'in', o: 'out', h: 'hold' };

/** Parse "i5,h2,o7" into breath steps. */
export function parseSteps(s) {
  const steps = (s || '').split(',').map((x) => [KIND[x[0]], parseFloat(x.slice(1))]).filter(([k, d]) => k && d > 0 && d < 60);
  return steps.some(([k]) => k === 'in') && steps.some(([k]) => k === 'out') ? steps : null;
}

const q = new URLSearchParams(location.hash.slice(1));
let steps = parseSteps(q.get('p'));
let epoch = Number(q.get('e'));
const topic = q.get('r');
const relay = q.get('relay') || 'https://ntfy.sh';
const store = (() => { try { return localStorage; } catch (e) { return null; } })();
const saved = (k, d) => { try { return (store && store.getItem(`pad:${k}`)) || d; } catch (e) { return d; } };
const save = (k, v) => { try { store && store.setItem(`pad:${k}`, v); } catch (e) { /* private mode */ } };

let offset = Number(saved('offset', 0)) || 0;
let on = false;
const haptics = createHaptics();
$('mode').value = saved('mode', 'in');
$('strength').value = saved('strength', 'medium');
haptics.setStrength($('strength').value);

if (!steps || !(epoch > 0)) {
  $('msg').textContent = 'This link has no pacer in it. On the computer, open Breathfield → Breathing pace → Feel it on your phone, and scan the code again.';
  $('msg').classList.add('warn');
  $('go').disabled = true;
} else {
  applyPace();
  if (!canVibrate()) {
    $('msg').textContent = 'This browser cannot vibrate. On Android use Chrome, Samsung Internet, Brave or Edge (Firefox and iPhones cannot). The circle still shows the pacer.';
    $('msg').classList.add('warn');
    $('go').disabled = true;
  }
}

function applyPace() {
  PATTERNS[CUSTOM].steps = steps;
  $('pace').textContent = `${steps.map(([k, d]) => `${d} ${k}`).join(' · ')} · ${perMinute(CUSTOM).toFixed(1)} / min`;
}

// Follow the computer: new paces and coherence taps arrive through the relay.
let lastAt = Number(q.get('t')) || 0; // ignore relayed paces older than the scanned code
$('taps').checked = saved('taps', '1') === '1';
$('taps').addEventListener('change', (e) => save('taps', e.target.checked ? '1' : '0'));
if (topic && steps) {
  $('link').textContent = 'Connecting to follow the computer…';
  subscribe(relay, topic, (m, sentAt) => {
    if (m.t === 'pace' && m.at > lastAt) {
      const s = parseSteps(m.p);
      if (s && m.e > 0) {
        lastAt = m.at; steps = s; epoch = m.e; applyPace();
        if (Date.now() - m.at < 60000) $('link').textContent = 'Following the computer: the pace just changed.';
      }
    } else if (m.t === 'tap' && on && $('taps').checked && Date.now() / 1000 - sentAt < 15) {
      haptics.reward(m.ev || {}, performance.now() / 1000);
    }
  }, (state) => {
    $('link').textContent = state === 'live' ? 'Following the computer: pace changes and taps arrive by themselves.' : 'Lost the link to the computer, retrying… The rhythm carries on.';
  });
} else if (steps) {
  $('link').textContent = 'Not following the computer: scan again if you change the pace there.';
  $('taps').closest('label').hidden = true;
}

const showOffset = () => { $('offset').textContent = `${offset >= 0 ? '+' : '−'}${Math.abs(offset).toFixed(1)} s`; };
showOffset();
$('earlier').addEventListener('click', () => { offset = Math.round((offset - 0.1) * 10) / 10; save('offset', offset); showOffset(); });
$('later').addEventListener('click', () => { offset = Math.round((offset + 0.1) * 10) / 10; save('offset', offset); showOffset(); });
$('mode').addEventListener('change', (e) => save('mode', e.target.value));
$('strength').addEventListener('change', (e) => { save('strength', e.target.value); haptics.setStrength(e.target.value); haptics.test(); });

let lock = null;
async function keepAwake() { try { lock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ } }
document.addEventListener('visibilitychange', () => { if (on && !document.hidden) keepAwake(); });

$('go').addEventListener('click', () => {
  on = !on;
  $('go').setAttribute('aria-pressed', String(on));
  $('go').textContent = on ? 'Stop vibrating' : 'Start vibrating';
  if (on) { haptics.test(); keepAwake(); } else { haptics.stop(); try { lock && lock.release(); } catch (e) { /* ignore */ } }
});

let lastWord = '', lastSec = -1;
function frame() {
  if (steps && epoch > 0) {
    const t = (Date.now() - epoch) / 1000 + offset;
    const br = breathAt(t, CUSTOM);
    $('fill').style.transform = `scale(${(0.2 + 0.8 * br.b).toFixed(3)})`;
    if (br.label !== lastWord) { $('word').textContent = br.label; lastWord = br.label; }
    const sec = Math.ceil(br.rem);
    if (sec !== lastSec) { $('sec').textContent = sec; lastSec = sec; }
    if (on) haptics.pacer($('mode').value, br, performance.now() / 1000);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
