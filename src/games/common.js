// Shared bits for the minigames: how coherence turns into help, colours that
// go grey when scattered and saturated when coherent, and the breath bar.

export const TAU = Math.PI * 2;
export const FONT = '"Martian Mono", ui-monospace, monospace';
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The smoothed visual level (about 0.18 low … 0.85 high) as 0 … 1 "how much help". */
export const helpOf = (coh) => clamp((coh - 0.2) / 0.62);

/** A colour on the colour wheel; saturation follows coherence, like the scenes. */
export function tone(hue, help, light = 60, alpha = 1) {
  const h = ((hue % 1) + 1) % 1 * 360;
  return `hsla(${h.toFixed(1)},${(14 + 66 * help).toFixed(1)}%,${light}%,${alpha})`;
}

/** Dark background with a soft glow that swells with the breath. */
export function backdrop(ctx, f, cx, cy) {
  const { W, H } = f;
  if (!f.overScene) { ctx.fillStyle = 'rgb(6,5,10)'; ctx.fillRect(0, 0, W, H); }
  const r = Math.max(W, H) * (0.45 + 0.15 * f.b);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  const [R, G, B] = f.glowRGB;
  g.addColorStop(0, `rgba(${R},${G},${B},${(0.05 + 0.1 * f.b).toFixed(3)})`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/**
 * The pacer as a slim column that fills while you breathe in and empties while
 * you breathe out, with the word or seconds under it (following the guide setting).
 */
export function breathBar(ctx, f, x, y, w, h) {
  if (f.guide === 'off') return;
  ctx.save();
  ctx.fillStyle = 'rgba(239,234,255,0.08)';
  roundRect(ctx, x, y, w, h, w / 2); ctx.fill();
  const fh = Math.max(w, h * f.b);
  const g = ctx.createLinearGradient(0, y + h - fh, 0, y + h);
  g.addColorStop(0, 'rgba(239,234,255,0.75)');
  g.addColorStop(1, 'rgba(239,234,255,0.25)');
  ctx.fillStyle = g;
  roundRect(ctx, x, y + h - fh, w, fh, w / 2); ctx.fill();
  if (f.guide === 'full' || f.guide === 'numbers') {
    ctx.fillStyle = 'rgba(239,234,255,0.7)';
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'center';
    const sec = Math.ceil(f.br.rem);
    ctx.fillText(f.guide === 'full' ? f.br.label : String(sec), x + w / 2, y + h + 16);
    if (f.guide === 'full') { ctx.fillStyle = 'rgba(239,234,255,0.4)'; ctx.fillText(String(sec), x + w / 2, y + h + 30); }
  }
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Small label + value pairs, e.g. score and lines, stacked from (x, y). */
export function stats(ctx, x, y, rows, align = 'left') {
  ctx.save();
  ctx.textAlign = align;
  let yy = y;
  for (const [k, v, col] of rows) {
    ctx.fillStyle = 'rgba(239,234,255,0.45)';
    ctx.font = `9px ${FONT}`;
    ctx.fillText(k.toUpperCase(), x, yy);
    ctx.fillStyle = col || 'rgba(239,234,255,0.92)';
    ctx.font = `15px ${FONT}`;
    ctx.fillText(String(v), x, yy + 19);
    yy += 44;
  }
  ctx.restore();
  return yy;
}

/** A line of help text that fades out after a few seconds of play. */
export function hint(ctx, f, text, x, y, age) {
  const a = clamp(1 - (age - 7) / 2) * clamp(age / 0.6);
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a * 0.75;
  ctx.fillStyle = '#efeaff';
  ctx.font = `10.5px ${FONT}`;
  ctx.textAlign = 'center';
  // wrap to the screen width
  const max = f.W - 40, lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > max && line) { lines.push(line); line = word; } else line = t;
  }
  lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + (i - (lines.length - 1)) * 14));
  ctx.restore();
}

/** Centered message, e.g. "paused". */
export function banner(ctx, f, text, sub) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,5,10,0.55)';
  ctx.fillRect(0, 0, f.W, f.H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#efeaff';
  ctx.font = `200 ${Math.round(Math.min(f.W, f.H) * 0.06)}px Unbounded, ${FONT}`;
  ctx.fillText(text, f.W / 2, f.H / 2);
  if (sub) { ctx.font = `11px ${FONT}`; ctx.fillStyle = 'rgba(239,234,255,0.6)'; ctx.fillText(sub, f.W / 2, f.H / 2 + 30); }
  ctx.restore();
}

/** Turns a pointer drag into moves of one cell, swipes and taps. */
export class Gestures {
  constructor() { this.down = null; }
  start(e) { this.down = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), moved: false }; }
  /** Returns how many whole cells the finger moved in x and y since the last call. */
  move(e, cell) {
    const d = this.down;
    if (!d) return { cx: 0, cy: 0 };
    const cx = Math.trunc((e.clientX - d.x) / cell), cy = Math.trunc((e.clientY - d.y) / cell);
    if (cx) { d.x += cx * cell; d.moved = true; }
    if (cy) { d.y += cy * cell; d.moved = true; }
    return { cx, cy };
  }
  /** On release: 'tap', or a swipe direction, or null. */
  end(e) {
    const d = this.down; this.down = null;
    if (!d) return null;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0, dt = performance.now() - d.t;
    if (!d.moved && Math.hypot(dx, dy) < 12 && dt < 350) return 'tap';
    if (Math.hypot(dx, dy) < 24) return null;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }
}
