// Cairn: stack river stones as high as you can.
// A stone swings above the stack; tap (or ↓) to drop it. The calmer your
// heart, the smaller and slower the swing, so it is easier to place. Dropping
// while you breathe out settles the stone a little toward the centre. If the
// stack leans too far it slides into the river and you start a fresh one.

import { FONT, TAU, helpOf, tone, backdrop, breathBar, stats, hint, clamp } from './common.js';

export function createCairn() {
  let L = null;
  let stack = [], hover = null, falling = null, tumble = [], ripples = [];
  let phase = 0, cam = 0, camTo = 0, age = 0, T = 0;
  let height = 0, best = 0, cairns = 0, placed = 0, lost = 0, settled = 0;
  let wantDrop = false;

  function layout(W, H) {
    const md = Math.min(W, H);
    L = { W, H, md, cx: W / 2, river: H * (W < 700 ? 0.76 : 0.8), sw: md * (W < 700 ? 0.2 : 0.15), g: md * 2.2 };
    reset();
  }

  function newStone(y) {
    const w = L.sw * (0.75 + Math.random() * 0.5);
    const h = L.md * (0.035 + Math.random() * 0.022);
    const shape = Array.from({ length: 10 }, () => 0.85 + Math.random() * 0.3);
    return { w, h, x: L.cx, y, shape, shade: Math.random(), rot: 0 };
  }

  function reset() {
    const base = newStone(0);
    base.w = L.sw * 1.6; base.h = L.md * 0.06;
    base.y = L.river - base.h / 2 + 4;
    base.base = true;
    stack = [base];
    height = 0; cam = camTo = 0;
    hover = newStone(0);
  }

  const top = () => stack[stack.length - 1];

  /** Does every stone carry the centre of mass of the stones above it? */
  function stable() {
    for (let i = 0; i < stack.length - 1; i++) {
      let m = 0, mx = 0;
      for (let j = i + 1; j < stack.length; j++) { const s = stack[j], k = s.w * s.h; m += k; mx += k * s.x; }
      if (Math.abs(mx / m - stack[i].x) > stack[i].w * 0.48) return false;
    }
    return true;
  }

  function collapse() {
    for (let i = 1; i < stack.length; i++) {
      const s = stack[i];
      tumble.push({ ...s, vx: (s.x - L.cx) * 0.8 + (Math.random() - 0.5) * L.md * 0.3, vy: -L.md * 0.1 * Math.random(), vr: (Math.random() - 0.5) * 3, life: 2.2 });
    }
    cairns++;
    reset();
  }

  function drop(f) {
    if (falling || !hover) return;
    const out = f.br.label === 'out';
    const s = hover;
    if (out) { s.x += (top().x - s.x) * 0.3; settled++; }
    s.vy = 0; s.calm = out;
    falling = s;
    hover = null;
  }

  function drawStone(ctx, s, f, help, alpha = 1) {
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.rot) ctx.rotate(s.rot);
    ctx.globalAlpha = alpha;
    const n = s.shape.length;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const k = s.shape[i % n];
      const x = Math.cos(a) * s.w * 0.5 * k, y = Math.sin(a) * s.h * 0.5 * (a > Math.PI ? k : 1);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -s.h / 2, 0, s.h / 2);
    g.addColorStop(0, tone(f.hue + 0.05 + s.shade * 0.12, help * 0.55, 46 + s.shade * 14));
    g.addColorStop(1, tone(f.hue + 0.05 + s.shade * 0.12, help * 0.55, 22 + s.shade * 8));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(239,234,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  return {
    id: 'cairn',
    hints: { keys: '↓ or X to drop the stone', touch: 'tap to drop the stone' },
    stats() { return { score: best, height, cairns, placed, lost, settled }; },

    key(e, down) {
      const k = e.key;
      if (k === 'ArrowDown' || k === 's' || k === 'S' || k === 'x' || k === 'X') { if (down && !e.repeat) wantDrop = true; return true; }
      return false;
    },
    pointer(type) { if (type === 'down') wantDrop = true; },

    frame(ctx, f) {
      const { W, H, dt, paused } = f;
      if (!L || L.W !== W || L.H !== H) layout(W, H);
      const { md, cx, river, g } = L;
      const help = helpOf(f.coh);
      const amp = md * (W < 700 ? 0.3 : 0.24) * (0.25 + 0.75 * (1 - help));
      const speed = 1.15 * (1 - 0.35 * help);
      const hoverY = top().y - md * 0.24;

      if (!paused) {
        age += dt; T += dt;
        phase += dt * speed;
        if (hover) { hover.x = cx + amp * Math.sin(phase); hover.y = hoverY; hover.rot = 0.05 * Math.sin(phase * 1.3) * (1 - help); }
        if (wantDrop) { wantDrop = false; drop(f); }
        if (falling) {
          const s = falling;
          s.vy += g * dt; s.y += s.vy * dt; s.rot *= 0.9;
          const t = top();
          const landY = t.y - t.h / 2 - s.h / 2 + 2;
          if (s.y >= landY) {
            if (Math.abs(s.x - t.x) < (t.w + s.w) * 0.42) {
              s.y = landY; s.rot = 0;
              stack.push(s);
              placed++;
              height = stack.length - 1;
              best = Math.max(best, height);
              falling = null;
              if (!stable()) collapse();
              else camTo = Math.max(0, L.H * 0.48 - top().y); // keep the top of the stack in view
            } else if (s.y > river) {
              ripples.push({ x: s.x, r: 4, life: 1 });
              lost++;
              falling = null;
            }
          }
          if (!falling) hover = newStone(0);
        }
        cam += (camTo - cam) * Math.min(1, dt * 2);
        for (const s of tumble) { s.vy += g * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.vr * dt; s.life -= dt; if (s.y > river + cam && !s.splashed) { s.splashed = true; ripples.push({ x: s.x, r: 4, life: 1 }); } }
        tumble = tumble.filter((s) => s.life > 0 && s.y < H + 200 - cam);
        for (const r of ripples) { r.r += dt * md * 0.15; r.life -= dt * 0.7; }
        ripples = ripples.filter((r) => r.life > 0);
      }

      backdrop(ctx, f, cx, H * 0.4);
      // far hills
      ctx.fillStyle = tone(f.hue + 0.6, help * 0.5, 10, f.overScene ? 0.85 : 1);
      ctx.beginPath(); ctx.moveTo(0, river);
      for (let x = 0; x <= W; x += 14) ctx.lineTo(x, river - md * (0.08 + 0.05 * Math.sin(x / (W * 0.13)) + 0.03 * Math.sin(x / (W * 0.05))) + cam * 0.3);
      ctx.lineTo(W, river); ctx.closePath(); ctx.fill();

      ctx.save();
      ctx.translate(0, cam);
      // the stack leans with its imbalance, less when you are calm
      let lean = 0;
      if (stack.length > 2) {
        let m = 0, mx = 0;
        for (let j = 1; j < stack.length; j++) { const s = stack[j], k = s.w * s.h; m += k; mx += k * s.x; }
        lean = ((mx / m - cx) / L.sw) * 0.05 * (1 - 0.7 * help);
      }
      const wob = lean * (1 + 0.4 * Math.sin(T * 1.7));
      const by = stack[0].y;
      for (let i = 0; i < stack.length; i++) {
        const s = stack[i];
        const k = i === 0 ? 0 : wob * ((by - s.y) / md);
        ctx.save();
        ctx.translate(cx, by); ctx.rotate(k); ctx.translate(-cx, -by);
        drawStone(ctx, s, f, help);
        ctx.restore();
      }
      if (falling) drawStone(ctx, falling, f, help);
      for (const s of tumble) drawStone(ctx, s, f, help, clamp(s.life));
      if (hover) {
        // a faint line shows where it would fall
        ctx.strokeStyle = `rgba(239,234,255,${(0.08 + 0.2 * help).toFixed(3)})`;
        ctx.setLineDash([3, 6]);
        ctx.beginPath(); ctx.moveTo(hover.x, hover.y + hover.h); ctx.lineTo(hover.x, top().y - top().h / 2); ctx.stroke();
        ctx.setLineDash([]);
        drawStone(ctx, hover, f, help);
      }
      ctx.restore();

      // river
      const rg = ctx.createLinearGradient(0, river + cam, 0, H);
      rg.addColorStop(0, tone(f.hue + 0.55, help * 0.7, 20, 0.95));
      rg.addColorStop(1, 'rgba(6,5,10,1)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, river + cam, W, H - river - cam + 1);
      ctx.strokeStyle = 'rgba(239,234,255,0.12)';
      for (let i = 0; i < 4; i++) {
        const y = river + cam + 8 + i * 12;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + 2 * Math.sin(x / 40 + T * (0.6 + i * 0.2)));
        ctx.stroke();
      }
      for (const r of ripples) {
        ctx.strokeStyle = `rgba(239,234,255,${(0.4 * r.life).toFixed(3)})`;
        ctx.beginPath(); ctx.ellipse(r.x, river + cam + 6, r.r, r.r * 0.25, 0, 0, TAU); ctx.stroke();
      }

      breathBar(ctx, f, W < 700 ? 18 : 40, H * 0.3, Math.max(5, md * 0.012), H * 0.3);
      stats(ctx, W - (W < 700 ? 16 : 40), W < 700 ? 110 : 90, [
        ['swing', `${Math.round(100 * (0.25 + 0.75 * (1 - help)))}%`, tone(f.hue, help, 72)],
        ['height', height],
        ['best', Math.max(best, f.best || 0)],
      ], 'right');
      hint(ctx, f, f.touch ? this.hints.touch : this.hints.keys, W / 2, W < 700 ? 82 : 62, age);
      if (age > 4 && age < 14) hint(ctx, f, 'drop as you breathe out and the stone settles toward the middle', W / 2, W < 700 ? 98 : 78, age - 4);
      if (!stack[1] && cairns && age > 1) {
        ctx.fillStyle = 'rgba(239,234,255,0.45)'; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText(`cairn ${cairns + 1}`, cx, stack[0].y + cam + md * 0.08);
      }
    },
  };
}
