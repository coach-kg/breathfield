// Slow Snake: the classic, slowed by a calm heart.
// Edges wrap around. Running into yourself does not end anything: the snake
// sheds the tail behind the bump. While you are coherent a charge fills
// (about a minute in the high zone); a full charge lets you glide through
// yourself once, untouched.

import { FONT, TAU, helpOf, tone, backdrop, breathBar, stats, hint, clamp, Gestures } from './common.js';

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
const GROW = 3, CHARGE_SEC = 60;

/** Steps per second: a little faster as you grow, slower when coherent (down to half). */
export const snakeSpeed = (len, coh) => Math.min(9, 4.5 + 0.06 * len) * (1 - 0.5 * helpOf(coh));

export function createSnake() {
  let L = null; // layout
  let body = [], dir = 'right', queue = [], grow = 0, acc = 0;
  let food = null, eaten = 0, best = 0, age = 0, charge = 0, sheds = 0, glides = 0;
  let parts = [];
  const gest = new Gestures();

  function layout(W, H) {
    const top = W < 700 ? 96 : 76, bottom = 100, side = W < 700 ? 34 : 70;
    const cs = Math.max(14, Math.floor(Math.min(W, H) / (W < 700 ? 18 : 26)));
    const cols = Math.max(10, Math.floor((W - side * 2) / cs));
    const rows = Math.max(8, Math.floor((H - top - bottom) / cs));
    L = { cs, cols, rows, x0: Math.round((W - cols * cs) / 2), y0: Math.round(top + (H - top - bottom - rows * cs) / 2), W, H };
    const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
    body = [[cx, cy], [cx - 1, cy], [cx - 2, cy]];
    dir = 'right'; queue = []; grow = 0;
    placeFood();
  }

  function placeFood() {
    const taken = new Set(body.map(([x, y]) => `${x},${y}`));
    for (let i = 0; i < 400; i++) {
      const x = Math.floor(Math.random() * L.cols), y = Math.floor(Math.random() * L.rows);
      if (!taken.has(`${x},${y}`)) { food = [x, y]; return; }
    }
  }

  function turn(d) {
    const last = queue.length ? queue[queue.length - 1] : dir;
    const [a, b] = DIRS[d], [c, e] = DIRS[last];
    if (a === -c && b === -e) return; // no reversing into yourself
    if (d === last) return;
    if (queue.length < 2) queue.push(d);
  }

  function step(help) {
    if (queue.length) dir = queue.shift();
    const [dx, dy] = DIRS[dir];
    const [hx, hy] = body[0];
    const nx = (hx + dx + L.cols) % L.cols, ny = (hy + dy + L.rows) % L.rows;
    const hit = body.findIndex(([x, y], i) => i < body.length - (grow ? 0 : 1) && x === nx && y === ny);
    body.unshift([nx, ny]);
    if (grow) grow--; else body.pop();
    if (hit >= 0) {
      if (charge >= 1) { charge = 0; glides++; }
      else {
        const shed = body.splice(hit + 1);
        sheds++;
        for (const [x, y] of shed) parts.push({ x, y, life: 1 });
      }
    }
    if (food && nx === food[0] && ny === food[1]) {
      eaten++; grow += GROW;
      best = Math.max(best, body.length + grow);
      placeFood();
    }
    best = Math.max(best, body.length);
  }

  return {
    id: 'snake',
    hints: { keys: 'arrows or WASD to turn · P pause', touch: 'swipe to turn' },
    stats() { return { score: best, length: body.length, seeds: eaten, sheds, glides }; },

    key(e, down) {
      const d = KEYMAP[e.key];
      if (!d) return false;
      if (down) turn(d);
      return true;
    },

    pointer(type, e) {
      if (type === 'down') return gest.start(e);
      if (type === 'move') {
        // turn as soon as a swipe is clear, without waiting for release
        const g = gest.down;
        if (!g) return;
        const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
        if (Math.hypot(dx, dy) > 26) {
          turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
          g.x0 = e.clientX; g.y0 = e.clientY; g.moved = true;
        }
        return;
      }
      gest.end(e);
    },

    frame(ctx, f) {
      const { W, H, dt, paused } = f;
      if (!L || L.W !== W || L.H !== H) layout(W, H);
      const { cs, cols, rows, x0, y0 } = L;
      const help = helpOf(f.coh);
      const sps = snakeSpeed(body.length, f.coh);

      if (!paused) {
        age += dt;
        acc += dt * sps;
        let n = 0;
        while (acc >= 1 && n++ < 3) { acc -= 1; step(help); }
        if (help > 0.55) charge = Math.min(1, charge + dt / CHARGE_SEC);
        for (const q of parts) q.life -= dt * 0.9;
        parts = parts.filter((q) => q.life > 0);
      }

      backdrop(ctx, f, x0 + (cols * cs) / 2, y0 + (rows * cs) / 2);
      ctx.fillStyle = 'rgba(6,5,10,0.55)';
      ctx.fillRect(x0, y0, cols * cs, rows * cs);
      // field of faint dots
      ctx.fillStyle = 'rgba(239,234,255,0.07)';
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) ctx.fillRect(x0 + (x + 0.5) * cs - 0.75, y0 + (y + 0.5) * cs - 0.75, 1.5, 1.5);

      const C = (x, y) => [x0 + (x + 0.5) * cs, y0 + (y + 0.5) * cs];

      // shed tail fading away
      for (const q of parts) {
        const [px, py] = C(q.x, q.y);
        ctx.fillStyle = `rgba(239,234,255,${(0.35 * q.life).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(px, py, cs * 0.3 * q.life, 0, TAU); ctx.fill();
      }

      // the seed pulses with the breath
      if (food) {
        const [fx, fy] = C(food[0], food[1]);
        const r = cs * (0.18 + 0.16 * f.b);
        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 3);
        g.addColorStop(0, tone(f.hue + 0.5, help, 75, 0.9));
        g.addColorStop(1, tone(f.hue + 0.5, help, 60, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(fx, fy, r * 3, 0, TAU); ctx.fill();
        ctx.fillStyle = '#efeaff';
        ctx.beginPath(); ctx.arc(fx, fy, r * 0.6, 0, TAU); ctx.fill();
      }

      // the snake: a soft ribbon, wider on the in-breath; gaps where it wraps
      const u = clamp(acc);
      const [ddx, ddy] = DIRS[dir];
      const w = cs * (0.52 + 0.22 * f.b);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = body.length - 1; i > 0; i--) {
        const [ax, ay] = body[i], [bx, by] = body[i - 1];
        if (Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1) continue;
        const [p1x, p1y] = C(ax, ay), [p2x, p2y] = C(bx, by);
        ctx.strokeStyle = tone(f.hue + i / Math.max(12, body.length) * 0.35, help, 58 + 10 * (1 - i / body.length));
        ctx.lineWidth = w * (0.7 + 0.3 * (1 - i / body.length));
        ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
      }
      // head glides toward the next cell
      const [hx, hy] = C(body[0][0], body[0][1]);
      const nx = hx + ddx * cs * u, ny = hy + ddy * cs * u;
      const wrapsNext = (body[0][0] + ddx < 0 || body[0][0] + ddx >= cols || body[0][1] + ddy < 0 || body[0][1] + ddy >= rows);
      const hx2 = wrapsNext ? hx : nx, hy2 = wrapsNext ? hy : ny;
      ctx.strokeStyle = tone(f.hue, help, 70);
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx2, hy2); ctx.stroke();
      ctx.fillStyle = '#efeaff';
      ctx.beginPath(); ctx.arc(hx2, hy2, w * 0.5, 0, TAU); ctx.fill();
      // charge ring around the head
      if (charge > 0.02) {
        ctx.strokeStyle = charge >= 1 ? tone(f.hue + 0.5, 1, 75, 0.9) : 'rgba(239,234,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(hx2, hy2, w * 0.95, -Math.PI / 2, -Math.PI / 2 + TAU * charge); ctx.stroke();
      }
      ctx.restore();

      breathBar(ctx, f, x0 - Math.max(14, cs * 0.9), y0 + rows * cs * 0.3, Math.max(5, cs * 0.3), rows * cs * 0.4);
      const sx = W < 700 ? x0 + 4 : x0 + cols * cs + 18;
      if (W >= 700) {
        stats(ctx, sx, y0 + 10, [
          ['time', `×${(1 - 0.5 * help).toFixed(2)}`, tone(f.hue, help, 72)],
          ['length', body.length],
          ['longest', Math.max(best, f.best || 0)],
          ['glide', charge >= 1 ? 'ready' : `${Math.round(charge * 100)}%`],
        ]);
      } else {
        ctx.fillStyle = 'rgba(239,234,255,0.7)';
        ctx.font = `10px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(`time ×${(1 - 0.5 * help).toFixed(2)} · length ${body.length} · glide ${charge >= 1 ? 'ready' : `${Math.round(charge * 100)}%`}`, sx, y0 + rows * cs + 16);
      }
      hint(ctx, f, f.touch ? this.hints.touch : this.hints.keys, W / 2, y0 - 14, age);
    },
  };
}
