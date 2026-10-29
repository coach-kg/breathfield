// Stillfall: falling blocks where a coherent heart slows time.
// Coherence only helps: at full coherence pieces fall at 40% speed, and in the
// high zone a ghost piece and a second preview fade in. When the well fills up
// it simply empties and you carry on; your score stays.

import { FONT, helpOf, tone, backdrop, breathBar, roundRect, stats, hint, smooth, clamp, Gestures } from './common.js';

const COLS = 10, ROWS = 20, HIDDEN = 2;
// Cells in an n×n box; rotation turns the box.
const SHAPES = [
  { n: 4, c: [[0, 1], [1, 1], [2, 1], [3, 1]] }, // I
  { n: 2, c: [[0, 0], [1, 0], [0, 1], [1, 1]] }, // O
  { n: 3, c: [[1, 0], [0, 1], [1, 1], [2, 1]] }, // T
  { n: 3, c: [[1, 0], [2, 0], [0, 1], [1, 1]] }, // S
  { n: 3, c: [[0, 0], [1, 0], [1, 1], [2, 1]] }, // Z
  { n: 3, c: [[0, 0], [0, 1], [1, 1], [2, 1]] }, // J
  { n: 3, c: [[2, 0], [0, 1], [1, 1], [2, 1]] }, // L
];
const KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];
const LINE_SCORE = [0, 100, 300, 500, 800];
const LOCK_SEC = 0.5, CLEAR_SEC = 0.45, REST_SEC = 1.4;

const rotate = (cells, n, dir) => cells.map(([x, y]) => (dir > 0 ? [n - 1 - y, x] : [y, n - 1 - x]));

/** Fall interval in seconds at a level, before coherence slows it. */
export const fallInterval = (level) => Math.max(0.08, 0.6 * Math.pow(0.85, level - 1));
/** Time scale from coherence: 1 when scattered … 0.5 when fully coherent. */
export const timeScale = (coh) => 1 - 0.5 * helpOf(coh);

export function createStillfall() {
  const grid = Array.from({ length: ROWS + HIDDEN }, () => new Array(COLS).fill(0));
  let bag = [], queue = [], cur = null;
  let fallAcc = 0, lockAcc = 0, lockMoves = 0, soft = false;
  let score = 0, lines = 0, rests = 0, pieces = 0, age = 0;
  let clearing = null; // { rows, t }
  let resting = 0; // seconds left of the "well empties" fade
  let parts = [];
  let layout = null;
  const gest = new Gestures();

  const nextKind = () => {
    if (!bag.length) { bag = [0, 1, 2, 3, 4, 5, 6]; for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } }
    return bag.pop();
  };
  const level = () => 1 + Math.floor(lines / 10);
  const fits = (cells, x, y) => cells.every(([cx, cy]) => {
    const gx = x + cx, gy = y + cy;
    return gx >= 0 && gx < COLS && gy < ROWS + HIDDEN && (gy < 0 || !grid[gy][gx]);
  });

  function spawn() {
    while (queue.length < 3) queue.push(nextKind());
    const k = queue.shift();
    const s = SHAPES[k];
    cur = { k, n: s.n, cells: s.c.map((c) => [...c]), x: Math.floor((COLS - s.n) / 2), y: k === 0 ? 0 : 1 };
    fallAcc = 0; lockAcc = 0; lockMoves = 0;
    pieces++;
    if (!fits(cur.cells, cur.x, cur.y)) { cur = null; resting = REST_SEC; rests++; }
  }

  function tryMove(dx, dy) {
    if (!cur || clearing || resting) return false;
    if (!fits(cur.cells, cur.x + dx, cur.y + dy)) return false;
    cur.x += dx; cur.y += dy;
    if (dx && lockMoves < 15 && !fits(cur.cells, cur.x, cur.y + 1)) { lockAcc = 0; lockMoves++; }
    return true;
  }

  function tryRotate(dir) {
    if (!cur || clearing || resting || cur.k === 1) return;
    const r = rotate(cur.cells, cur.n, dir);
    for (const [kx, ky] of KICKS) {
      if (fits(r, cur.x + kx, cur.y + ky)) {
        cur.cells = r; cur.x += kx; cur.y += ky;
        if (lockMoves < 15) { lockAcc = 0; lockMoves++; }
        return;
      }
    }
  }

  function hardDrop() {
    if (!cur || clearing || resting) return;
    let n = 0;
    while (fits(cur.cells, cur.x, cur.y + 1)) { cur.y++; n++; }
    score += 2 * n;
    lock();
  }

  function lock() {
    for (const [cx, cy] of cur.cells) {
      const gy = cur.y + cy;
      if (gy >= 0) grid[gy][cur.x + cx] = cur.k + 1;
    }
    cur = null;
    const full = [];
    for (let y = 0; y < ROWS + HIDDEN; y++) if (grid[y].every((v) => v)) full.push(y);
    if (full.length) {
      clearing = { rows: full, t: 0 };
      score += LINE_SCORE[full.length] * level();
    } else spawn();
  }

  function finishClear() {
    for (const y of clearing.rows) {
      grid.splice(y, 1);
      grid.unshift(new Array(COLS).fill(0));
    }
    lines += clearing.rows.length;
    clearing = null;
    spawn();
  }

  function burst(y, hue, help) {
    if (!layout) return;
    const { x0, y0, cs } = layout;
    for (let x = 0; x < COLS; x++) {
      for (let i = 0; i < 3; i++) {
        parts.push({
          x: x0 + (x + 0.5) * cs, y: y0 + (y - HIDDEN + 0.5) * cs,
          vx: (Math.random() - 0.5) * cs * 3, vy: -Math.random() * cs * 2.5,
          life: 1, col: tone(hue + x / COLS, help, 68),
        });
      }
    }
  }

  function computeLayout(W, H) {
    const top = W < 700 ? 96 : 76, bottom = 96;
    const cs = Math.max(10, Math.floor(Math.min((H - top - bottom) / ROWS, (W - 32) / (COLS + 6.4))));
    const ww = cs * COLS, wh = cs * ROWS;
    const total = ww + cs * 6.4;
    const x0 = Math.round((W - total) / 2 + cs * 1.8);
    const y0 = Math.round(top + (H - top - bottom - wh) / 2);
    layout = { cs, ww, wh, x0, y0, W, H };
  }

  function drawCell(ctx, x, y, cs, fill, alpha = 1) {
    const pad = Math.max(1, cs * 0.06);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    roundRect(ctx, x + pad, y + pad, cs - 2 * pad, cs - 2 * pad, cs * 0.22);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, x + pad * 2, y + pad * 2, cs * 0.5, cs * 0.18, cs * 0.09);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPiece(ctx, k, px, py, cs, f, help, alpha = 1) {
    const s = SHAPES[k];
    for (const [cx, cy] of s.c) drawCell(ctx, px + cx * cs, py + cy * cs, cs, tone(f.hue + k / 7, help, 60), alpha);
  }

  return {
    id: 'stillfall',
    hints: { keys: '← → move · ↑ turn · ↓ faster · Shift drop · P pause', touch: 'tap turn · drag move · flick down to drop' },

    stats() { return { score, lines, level: level(), rests, pieces }; },

    key(e, down) {
      const k = e.key;
      if (k === 'ArrowDown' || k === 's' || k === 'S') { soft = down; return true; }
      if (!down) return ['Shift', 'q', 'Q', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'a', 'A', 'd', 'D', 'w', 'W', 'z', 'Z', 'x', 'X'].includes(k);
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { tryMove(-1, 0); return true; }
      if (k === 'ArrowRight' || k === 'd' || k === 'D') { tryMove(1, 0); return true; }
      if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'x' || k === 'X') { if (!e.repeat) tryRotate(1); return true; }
      if (k === 'z' || k === 'Z') { if (!e.repeat) tryRotate(-1); return true; }
      if (k === 'Shift' || k === 'q' || k === 'Q') { if (!e.repeat) hardDrop(); return true; }
      return false;
    },

    pointer(type, e) {
      const cs = layout ? layout.cs : 24;
      if (type === 'down') { gest.start(e); return; }
      if (type === 'move') {
        const { cx, cy } = gest.move(e, cs);
        for (let i = 0; i < Math.abs(cx); i++) tryMove(Math.sign(cx), 0);
        if (cy > 0) soft = true;
        if (cy < 0) soft = false;
        return;
      }
      const fast = gest.down && performance.now() - gest.down.t < 250 && e.clientY - gest.down.y0 > cs * 3;
      const g = gest.end(e);
      soft = false;
      if (g === 'tap') tryRotate(1);
      else if (fast) hardDrop();
    },

    frame(ctx, f) {
      const { W, H, dt, paused } = f;
      if (!layout || layout.W !== W || layout.H !== H) computeLayout(W, H);
      const { cs, ww, wh, x0, y0 } = layout;
      const help = helpOf(f.coh);
      const ts = timeScale(f.coh);
      const ghostA = smooth(0.62, 0.8, help);

      // ---- logic
      if (!paused) {
        age += dt;
        if (!cur && !clearing && !resting) spawn();
        if (clearing) {
          if (clearing.t === 0) clearing.rows.forEach((y) => burst(y, f.hue, help));
          clearing.t += dt;
          if (clearing.t >= CLEAR_SEC) finishClear();
        } else if (resting) {
          resting -= dt;
          if (resting <= 0) {
            resting = 0;
            for (const row of grid) row.fill(0);
            spawn();
          }
        } else if (cur) {
          const grounded = !fits(cur.cells, cur.x, cur.y + 1);
          if (grounded) {
            lockAcc += dt * ts;
            if (lockAcc >= LOCK_SEC) lock();
          } else {
            fallAcc += soft ? dt * 14 : dt * ts;
            const iv = fallInterval(level());
            while (cur && fallAcc >= iv) {
              fallAcc -= iv;
              if (!tryMove(0, 1)) break;
              if (soft) score += 1;
            }
          }
        }
        for (const q of parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += cs * 5 * dt; q.life -= dt * 1.1; }
        parts = parts.filter((q) => q.life > 0);
      }

      // ---- draw
      backdrop(ctx, f, x0 + ww / 2, y0 + wh / 2);
      const [R, G, B] = f.glowRGB;
      // the well
      ctx.save();
      ctx.fillStyle = 'rgba(6,5,10,0.72)';
      ctx.fillRect(x0, y0, ww, wh);
      ctx.shadowColor = `rgba(${R},${G},${B},${(0.25 + 0.5 * f.b).toFixed(3)})`;
      ctx.shadowBlur = cs * (0.6 + 1.2 * f.b);
      ctx.strokeStyle = `rgba(${R},${G},${B},${(0.35 + 0.4 * f.b).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 - 1, y0 - 1, ww + 2, wh + 2);
      ctx.restore();
      ctx.fillStyle = 'rgba(239,234,255,0.035)';
      for (let x = 1; x < COLS; x++) ctx.fillRect(x0 + x * cs, y0, 1, wh);

      // settled cells, fading while the well empties
      const restFade = resting ? clamp(resting / REST_SEC) : 1;
      for (let y = HIDDEN; y < ROWS + HIDDEN; y++) {
        const isClearing = clearing && clearing.rows.includes(y);
        for (let x = 0; x < COLS; x++) {
          const v = grid[y][x];
          if (!v) continue;
          let a = restFade;
          if (isClearing) a = 1 - clearing.t / CLEAR_SEC;
          drawCell(ctx, x0 + x * cs, y0 + (y - HIDDEN) * cs, cs, isClearing ? '#efeaff' : tone(f.hue + (v - 1) / 7, help, 52), a);
        }
      }

      if (cur) {
        // ghost piece in the high zone
        if (ghostA > 0.01) {
          let gy = cur.y;
          while (fits(cur.cells, cur.x, gy + 1)) gy++;
          ctx.save();
          ctx.strokeStyle = `rgba(239,234,255,${(0.4 * ghostA).toFixed(3)})`;
          ctx.lineWidth = 1;
          for (const [cx, cy] of cur.cells) {
            const yy = gy + cy - HIDDEN;
            if (yy >= 0) { roundRect(ctx, x0 + (cur.x + cx) * cs + 3, y0 + yy * cs + 3, cs - 6, cs - 6, cs * 0.2); ctx.stroke(); }
          }
          ctx.restore();
        }
        // falling piece glides between rows
        const iv = fallInterval(level());
        const slide = fits(cur.cells, cur.x, cur.y + 1) ? clamp(fallAcc / iv) : 0;
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, y0, ww, wh); ctx.clip();
        for (const [cx, cy] of cur.cells) {
          drawCell(ctx, x0 + (cur.x + cx) * cs, y0 + (cur.y + cy - HIDDEN + slide) * cs, cs, tone(f.hue + cur.k / 7, help, 64));
        }
        ctx.restore();
      }

      for (const q of parts) {
        ctx.globalAlpha = clamp(q.life);
        ctx.fillStyle = q.col;
        ctx.beginPath(); ctx.arc(q.x, q.y, cs * 0.12 * (0.5 + q.life), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (resting) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(239,234,255,${(0.85 * Math.sin(Math.PI * (1 - resting / REST_SEC))).toFixed(3)})`;
        ctx.font = `11px ${FONT}`;
        ctx.fillText('the well empties · carry on', x0 + ww / 2, y0 + wh / 2);
        ctx.restore();
      }

      // breath column on the left
      breathBar(ctx, f, x0 - cs * 1.3, y0 + wh * 0.25, Math.max(6, cs * 0.34), wh * 0.5);

      // right side: next pieces and numbers
      const rx = x0 + ww + cs * 0.9;
      const ps = Math.max(8, Math.round(cs * 0.62));
      ctx.fillStyle = 'rgba(239,234,255,0.45)';
      ctx.font = `9px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText('NEXT', rx, y0 + 10);
      if (queue[0] != null) drawPiece(ctx, queue[0], rx, y0 + 20, ps, f, help);
      if (queue[1] != null && ghostA > 0.01) drawPiece(ctx, queue[1], rx, y0 + 20 + ps * 3, ps * 0.8, f, help, ghostA * 0.8);
      const sy = y0 + 20 + ps * 6;
      stats(ctx, rx, sy, [
        ['time', `×${ts.toFixed(2)}`, tone(f.hue, help, 72)],
        ['score', score],
        ['lines', lines],
        ['level', level()],
        ...(f.best ? [['best', Math.max(f.best, score)]] : []),
      ]);

      hint(ctx, f, f.touch ? this.hints.touch : this.hints.keys, W / 2, y0 - 14, age);
    },
  };
}
