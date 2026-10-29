// Breathing patterns and the pacer clock.

export const PATTERNS = [
  { id: 'six', name: '5 in · 5 out', note: '6 breaths a minute', steps: [['in', 5], ['out', 5]] },
  { id: 'resonance', name: '5.5 in · 5.5 out', note: '5.5 a minute, a common resonance pace', steps: [['in', 5.5], ['out', 5.5]] },
  { id: 'longout', name: '4 in · 6 out', note: 'longer exhale, calming', steps: [['in', 4], ['out', 6]] },
  { id: 'box', name: '4 · 4 · 4 · 4', note: 'box breathing', steps: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]] },
  { id: '478', name: '4 in · 7 hold · 8 out', note: 'for winding down', steps: [['in', 4], ['hold', 7], ['out', 8]] },
  { id: 'custom', name: 'Custom', note: 'your own timing', steps: [['in', 5], ['out', 5]] },
];

export const CUSTOM = PATTERNS.length - 1;
const fmt = (x) => String(+x.toFixed(1));

/** Set the custom pattern. Seconds: in, hold after in, out, hold after out. Zero holds are skipped. */
export function setCustom({ inS = 5, holdIn = 0, outS = 5, holdOut = 0 } = {}) {
  const steps = [['in', inS]];
  if (holdIn > 0) steps.push(['hold', holdIn]);
  steps.push(['out', outS]);
  if (holdOut > 0) steps.push(['hold', holdOut]);
  const p = PATTERNS[CUSTOM];
  p.steps = steps;
  p.name = `Custom · ${steps.map(([k, d]) => (k === 'hold' ? `${fmt(d)} hold` : `${fmt(d)} ${k}`)).join(' · ')}`;
  return p;
}

export const cycleSec = (i) => PATTERNS[i].steps.reduce((s, x) => s + x[1], 0);
export const perMinute = (i) => 60 / cycleSec(i);

/**
 * Where in the breath we are at time t (seconds since the pacer started).
 * b: 0 empty … 1 full, eased. kind: in | out | holdIn | holdOut.
 */
export function breathAt(t, i) {
  const seq = PATTERNS[i].steps;
  const total = cycleSec(i);
  let u = ((t % total) + total) % total;
  const cyc = u / total;
  let prev = 'out';
  for (const [k, d] of seq) {
    if (u < d) {
      const p = u / d;
      const e = 0.5 - 0.5 * Math.cos(Math.PI * p);
      let b, kind = k;
      if (k === 'in') b = e;
      else if (k === 'out') b = 1 - e;
      else { kind = prev === 'in' ? 'holdIn' : 'holdOut'; b = prev === 'in' ? 1 : 0; }
      return { kind, label: k, p, b, rem: d - u, elapsed: u, total, cyc };
    }
    u -= d;
    if (k !== 'hold') prev = k;
  }
  return { kind: 'out', label: 'out', p: 0, b: 0, rem: 0, elapsed: 0, total, cyc: 0 };
}
