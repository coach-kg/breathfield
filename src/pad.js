// Pacer pad: the phone runs the same breathing pacer as Breathfield on the
// computer and vibrates with it. No server and no connection between the two:
// the link carries the pattern and the moment the pacer started (wall-clock
// milliseconds), and both devices keep internet time, so they stay in step to
// about a tenth of a second. A nudge corrects any leftover offset.
//
// Link: pad.html#p=i5,o5&e=1793364476635   (i in, o out, h hold; seconds)

import { PATTERNS, CUSTOM, breathAt, perMinute } from './engine/breath.js';
import { createHaptics, canVibrate } from './haptics.js';

const $ = (id) => document.getElementById(id);
const KIND = { i: 'in', o: 'out', h: 'hold' };

/** Parse "i5,h2,o7" into breath steps. */
export function parseSteps(s) {
  const steps = (s || '').split(',').map((x) => [KIND[x[0]], parseFloat(x.slice(1))]).filter(([k, d]) => k && d > 0 && d < 60);
  return steps.some(([k]) => k === 'in') && steps.some(([k]) => k === 'out') ? steps : null;
}

const q = new URLSearchParams(location.hash.slice(1));
const steps = parseSteps(q.get('p'));
const epoch = Number(q.get('e'));
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
  PATTERNS[CUSTOM].steps = steps;
  $('pace').textContent = `${steps.map(([k, d]) => `${d} ${k}`).join(' · ')} · ${perMinute(CUSTOM).toFixed(1)} / min`;
  if (!canVibrate()) {
    $('msg').textContent = 'This browser cannot vibrate. On Android use Chrome, Samsung Internet, Brave or Edge (Firefox and iPhones cannot). The circle still shows the pacer.';
    $('msg').classList.add('warn');
    $('go').disabled = true;
  }
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
