// Bow: archery across a quiet valley.
// Drag back from anywhere and let go to shoot (or ↑ ↓ to aim, hold → to draw).
// Your aim sways less the more coherent you are, and in the high zone the
// first part of the arrow's path is shown. Letting go while you breathe out
// steadies the shot a little more and doubles its points.

import { FONT, TAU, helpOf, tone, backdrop, breathBar, stats, hint, clamp } from './common.js';

const RINGS = [10, 8, 6, 4, 2];

export function createBow() {
  let L = null;
  let aim = -0.5, draw = 0, drawing = false, keyAim = 0;
  let drag = null;
  let arrows = [], targets = [], pops = [];
  let score = 0, shots = 0, hits = 0, bulls = 0, onBreath = 0, age = 0, T = 0;

  function layout(W, H) {
    const md = Math.min(W, H);
    const g = md * 1.25;
    L = { W, H, md, g, ax: W * (W < 700 ? 0.16 : 0.14), ay: H * (W < 700 ? 0.7 : 0.66), vmax: Math.sqrt(1.15 * Math.max(W, H * 0.8) * g) };
    targets = [];
    while (targets.length < 2) targets.push(newTarget());
  }

  function newTarget() {
    const { W, H, md } = L;
    return {
      x: W * (0.52 + Math.random() * 0.36), y: H * (0.22 + Math.random() * 0.42),
      r: md * (0.045 + Math.random() * 0.02), ph: Math.random() * TAU,
      sx: W * 0.03 * Math.random(), sy: H * 0.05 * (0.4 + Math.random()), w: 0.12 + Math.random() * 0.12,
      stuck: [], born: T, leave: 0,
    };
  }
  const tpos = (t) => [t.x + t.sx * Math.sin(T * t.w + t.ph), t.y + t.sy * Math.sin(T * t.w * 0.8 + t.ph * 1.7)];

  function sway(help) {
    const k = (1 - help) * (0.35 + 0.65 * draw);
    return k * (0.07 * Math.sin(T * 1.3) + 0.035 * Math.sin(T * 3.1 + 1) + 0.02 * Math.sin(T * 5.3));
  }

  function release(f) {
    if (draw < 0.15) { draw = 0; return; }
    const help = helpOf(f.coh);
    const breathOk = f.br.label === 'out' && f.br.elapsed < 2.5;
    const a = aim + sway(help) * (breathOk ? 0.5 : 1);
    const v = L.vmax * (0.35 + 0.65 * draw);
    arrows.push({ x: L.ax, y: L.ay, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 6, stuck: null, bonus: breathOk });
    shots++;
    draw = 0;
  }

  return {
    id: 'bow',
    hints: { keys: '↑ ↓ aim · hold → to draw, let go to shoot', touch: 'drag back from anywhere, let go to shoot' },
    stats() { return { score, shots, hits, bulls, onBreath }; },

    key(e, down) {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') { keyAim = down ? -1 : (keyAim === -1 ? 0 : keyAim); return true; }
      if (k === 'ArrowDown' || k === 's' || k === 'S') { keyAim = down ? 1 : (keyAim === 1 ? 0 : keyAim); return true; }
      if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'x' || k === 'X') {
        if (down) drawing = true; else if (drawing) { drawing = false; this._release = true; }
        return true;
      }
      return false;
    },

    pointer(type, e) {
      if (type === 'down') { drag = { x: e.clientX, y: e.clientY }; return; }
      if (!drag || !L) return;
      const dx = drag.x - e.clientX, dy = drag.y - e.clientY;
      const len = Math.hypot(dx, dy);
      if (type === 'move') {
        if (len > 8) {
          aim = clamp(Math.atan2(dy, dx), -1.45, 0.6);
          draw = clamp(len / (L.md * 0.3));
        }
        return;
      }
      drag = null;
      this._release = true;
    },

    frame(ctx, f) {
      const { W, H, dt, paused } = f;
      if (!L || L.W !== W || L.H !== H) layout(W, H);
      const { md, ax, ay, g } = L;
      const help = helpOf(f.coh);

      if (!paused) {
        age += dt; T += dt;
        aim = clamp(aim + keyAim * dt * 0.9, -1.45, 0.6);
        if (drawing) draw = Math.min(1, draw + dt * 0.8);
        if (this._release) { this._release = false; release(f); }
        for (const a of arrows) {
          if (a.stuck) { a.life -= dt * 0.25; continue; }
          a.life -= dt;
          for (let sub = 0; sub < 4 && !a.stuck; sub++) {
          a.vy += g * dt / 4;
          a.x += a.vx * dt / 4; a.y += a.vy * dt / 4;
          for (const t of targets) {
            if (t.leave) continue;
            const [tx, ty] = tpos(t);
            const d = Math.hypot(a.x - tx, a.y - ty);
            if (d < t.r) {
              const ring = Math.min(4, Math.floor((d / t.r) * 5));
              let pts = RINGS[ring] * (a.bonus ? 2 : 1);
              score += pts; hits++;
              if (ring === 0) bulls++;
              if (a.bonus) onBreath++;
              a.stuck = { t, dx: a.x - tx, dy: a.y - ty, ang: Math.atan2(a.vy, a.vx) };
              t.stuck.push(a);
              pops.push({ x: tx, y: ty - t.r - 10, text: `+${pts}${a.bonus ? ' on the breath' : ''}`, life: 1.6 });
              if (t.stuck.length >= 3 || ring === 0) t.leave = T;
              break;
            }
          }
          }
          if (a.y > H + 40 || a.x > W + 40) a.life = 0;
        }
        arrows = arrows.filter((a) => a.life > 0 && (!a.stuck || !a.stuck.t.gone));
        for (const t of targets) if (t.leave && T - t.leave > 1.2) t.gone = true;
        targets = targets.filter((t) => !t.gone);
        while (targets.length < 2) targets.push(newTarget());
        for (const p of pops) { p.life -= dt; p.y -= dt * 18; }
        pops = pops.filter((p) => p.life > 0);
      }

      // ---- valley
      backdrop(ctx, f, W * 0.7, H * 0.35);
      for (let layer = 0; layer < 3; layer++) {
        const base = H * (0.72 + layer * 0.09);
        ctx.fillStyle = tone(f.hue + 0.6 + layer * 0.04, help * 0.6, 10 + layer * 4, f.overScene ? 0.85 : 1);
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 12) {
          const y = base - md * (0.06 + layer * 0.02) * (Math.sin(x / (W * 0.18) + layer * 2) * 0.6 + Math.sin(x / (W * 0.07) + layer) * 0.25 + 0.6);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      }

      // ---- targets
      for (const t of targets) {
        const [tx, ty] = tpos(t);
        const fade = t.leave ? clamp(1 - (T - t.leave) / 1.2) : clamp((T - t.born) / 0.8);
        ctx.save();
        ctx.globalAlpha = fade;
        for (let i = 4; i >= 0; i--) {
          ctx.fillStyle = i === 0 ? tone(f.hue + 0.08, help, 70) : i % 2 ? 'rgba(239,234,255,0.82)' : tone(f.hue + 0.55, help, 40);
          ctx.beginPath(); ctx.arc(tx, ty, (t.r * (i + 1)) / 5, 0, TAU); ctx.fill();
        }
        ctx.restore();
      }

      // ---- arrows
      ctx.save();
      ctx.lineCap = 'round';
      for (const a of arrows) {
        let x = a.x, y = a.y, ang = Math.atan2(a.vy, a.vx);
        if (a.stuck) { const [tx, ty] = tpos(a.stuck.t); x = tx + a.stuck.dx; y = ty + a.stuck.dy; ang = a.stuck.ang; }
        ctx.globalAlpha = a.stuck ? clamp(a.life) * (a.stuck.t.leave ? clamp(1 - (T - a.stuck.t.leave) / 1.2) : 1) : 1;
        drawArrow(ctx, x, y, ang, md, a.bonus ? tone(f.hue, 1, 75) : '#efeaff');
      }
      ctx.restore();

      // ---- the archer's bow, swaying
      const a = aim + sway(help);
      const bowR = md * 0.085;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a);
      ctx.strokeStyle = tone(f.hue + 0.1, help, 66);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(-bowR * 0.25, 0, bowR, -1.15, 1.15); ctx.stroke();
      const tipX = -bowR * 0.25 + Math.cos(1.15) * bowR, tipY = Math.sin(1.15) * bowR;
      const pull = -bowR * 0.25 - draw * bowR * 0.9 + Math.cos(1.15) * bowR * 0.2;
      ctx.strokeStyle = 'rgba(239,234,255,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tipX, -tipY); ctx.lineTo(pull, 0); ctx.lineTo(tipX, tipY); ctx.stroke();
      if (draw > 0.02) drawArrow(ctx, pull + md * 0.09, 0, 0, md, '#efeaff');
      ctx.restore();

      // aiming help: the first part of the flight, longer in the high zone
      if (draw > 0.05 && help > 0.35) {
        const v = L.vmax * (0.35 + 0.65 * draw);
        let x = ax, y = ay, vx = Math.cos(a) * v, vy = Math.sin(a) * v;
        const steps = Math.round(4 + 14 * clamp((help - 0.35) / 0.5));
        ctx.fillStyle = 'rgba(239,234,255,0.5)';
        for (let i = 0; i < steps; i++) {
          for (let k = 0; k < 4; k++) { vy += g * 0.012; x += vx * 0.012; y += vy * 0.012; }
          ctx.globalAlpha = 0.6 * (1 - i / steps);
          ctx.beginPath(); ctx.arc(x, y, 1.8, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      for (const p of pops) {
        ctx.fillStyle = `rgba(239,234,255,${clamp(p.life).toFixed(3)})`;
        ctx.font = `10.5px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
      }

      breathBar(ctx, f, ax - md * 0.1, ay - md * 0.14, Math.max(5, md * 0.012), md * 0.2);
      stats(ctx, W - (W < 700 ? 16 : 40), W < 700 ? 110 : 90, [
        ['steadiness', `${Math.round(100 * (0.35 + 0.65 * help))}%`, tone(f.hue, help, 72)],
        ['score', score],
        ['hits', `${hits} / ${shots}`],
        ...(f.best ? [['best', Math.max(f.best, score)]] : []),
      ], 'right');
      hint(ctx, f, f.touch ? this.hints.touch : this.hints.keys, W / 2, W < 700 ? 82 : 62, age);
      if (age > 4 && age < 14) hint(ctx, f, 'let go as you breathe out for double points', W / 2, W < 700 ? 98 : 78, age - 4);
    },
  };
}

function drawArrow(ctx, x, y, ang, md, col) {
  const len = md * 0.09;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(0, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-7, -3.2); ctx.lineTo(-7, 3.2); ctx.closePath(); ctx.fill();
  ctx.globalAlpha *= 0.6;
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(-len - 6, -4); ctx.moveTo(-len + 5, 0); ctx.lineTo(-len - 1, -4);
  ctx.moveTo(-len, 0); ctx.lineTo(-len - 6, 4); ctx.moveTo(-len + 5, 0); ctx.lineTo(-len - 1, 4); ctx.stroke();
  ctx.restore();
}
