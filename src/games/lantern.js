// Lantern: a tiny endless platformer at night.
// The main path is always faintly visible, so you can always carry on. Your
// lantern's light is your coherence: the wider it shines, the more you see
// of the hidden ledges and stars above the path, and ledges only hold you
// while they are lit. "?" blocks give kinder gifts (double jump, feather
// fall, a wider light) the more coherent you are. Falling just takes you back
// to the last lantern post.

import { FONT, TAU, helpOf, tone, backdrop, breathBar, stats, hint, clamp, roundRect } from './common.js';

const G = 42, JUMP = 15.5, RUN = 5.6, COYOTE = 0.1, BUFFER = 0.13;
const PW = 0.7, PH = 1.0, POWER_SEC = 15;
const rnd = (a, b) => a + Math.random() * (b - a);

export function createLantern() {
  let L = null;
  let plats = [], stars = [], posts = [], pops = [];
  let genX = 0, genY = 0, sincePost = 0;
  const pl = { x: 0, y: -PH, vx: 0, vy: 0, ground: false, coyote: 0, buf: 0, air: 0, face: 1 };
  let spawn = { x: 0, y: -PH }, startX = 0, farX = 0;
  let nStars = 0, falls = 0, gifts = 0, age = 0, T = 0, fade = 0;
  const power = { double: 0, feather: 0, glow: 0 };
  const input = { l: false, r: false, jump: false };
  const touches = new Map();

  function layout(W, H) {
    const md = Math.min(W, H);
    L = { W, H, md, u: md / (W < 700 ? 13 : 17), camX: 0, camY: 0 };
    if (!plats.length) {
      plats.push({ x: -6, y: 0, w: 14, h: 6, kind: 'main' });
      genX = 8; genY = 0;
      posts.push({ x: 1, y: 0, on: true });
      spawn = { x: 1, y: -PH };
      Object.assign(pl, { x: 1, y: -PH });
      startX = farX = 1;
    }
    L.camX = pl.x * L.u - W * 0.35; L.camY = pl.y * L.u - H * 0.55;
  }

  function generate(until) {
    while (genX < until) {
      const gap = rnd(1.3, 3.0);
      const w = rnd(3, 8);
      const y = clamp(genY + rnd(-1.6, 1.8), -8, 8);
      const x = genX + gap;
      // stars along the jump over the gap, only visible in the light
      if (Math.random() < 0.5) stars.push({ x: genX + gap / 2, y: Math.min(genY, y) - 2.1, got: false });
      plats.push({ x, y, w, h: 6, kind: 'main' });
      const r = Math.random();
      if (r < 0.45 && w > 3.5) {
        const hx = x + rnd(0, w - 2.5), hy = y - rnd(2.3, 2.7), hw = rnd(2.2, 3.6);
        plats.push({ x: hx, y: hy, w: hw, h: 0.45, kind: 'hidden', lit: 0 });
        for (let i = 0; i < 2 + (Math.random() < 0.5); i++) stars.push({ x: hx + 0.5 + i * 0.9, y: hy - 0.8, got: false });
        if (Math.random() < 0.35) {
          const h2x = hx + rnd(-0.5, 1.5), h2y = hy - rnd(2.3, 2.6);
          plats.push({ x: h2x, y: h2y, w: rnd(1.8, 2.8), h: 0.45, kind: 'hidden', lit: 0 });
          stars.push({ x: h2x + 0.9, y: h2y - 0.8, got: false }, { x: h2x + 1.8, y: h2y - 0.8, got: false });
        }
      } else if (r < 0.72) {
        plats.push({ x: x + w / 2 - 0.5, y: y - 3.2, w: 1, h: 1, kind: 'block', used: false });
      }
      sincePost += gap + w;
      if (sincePost > 26) { posts.push({ x: x + w / 2, y, on: false }); sincePost = 0; }
      genX = x + w; genY = y;
    }
    // forget what is far behind
    const cut = pl.x - 40;
    plats = plats.filter((p) => p.x + p.w > cut);
    stars = stars.filter((s) => s.x > cut);
    posts = posts.filter((p) => p.x > cut || p === lastPost());
  }
  const lastPost = () => { let best = null; for (const p of posts) if (p.on && (!best || p.x > best.x)) best = p; return best; };

  const solid = (p) => p.kind !== 'hidden' || p.lit > 0.25;
  const overlap = (p) => pl.x < p.x + p.w && pl.x + PW > p.x && pl.y < p.y + p.h && pl.y + PH > p.y;

  function gift(p, help) {
    gifts++;
    const good = Math.random() < 0.3 + 0.55 * help;
    let text;
    if (good) {
      const k = ['double', 'feather', 'glow'][Math.floor(Math.random() * 3)];
      power[k] = POWER_SEC;
      text = { double: 'double jump', feather: 'feather fall', glow: 'wider light' }[k];
    } else { nStars += 1; text = '+1 star'; }
    pops.push({ x: p.x + 0.5, y: p.y - 0.4, text, life: 1.8 });
  }

  function physics(dt, help) {
    // horizontal
    const dir = (input.r ? 1 : 0) - (input.l ? 1 : 0);
    if (dir) pl.face = dir;
    const target = dir * RUN;
    pl.vx += (target - pl.vx) * Math.min(1, dt * (pl.ground ? 14 : 6));
    pl.x += pl.vx * dt;
    for (const p of plats) {
      if (!solid(p) || p.kind === 'hidden' || !overlap(p)) continue;
      if (pl.vx > 0) pl.x = p.x - PW; else if (pl.vx < 0) pl.x = p.x + p.w;
      pl.vx = 0;
    }
    // jump
    pl.coyote = pl.ground ? COYOTE : pl.coyote - dt;
    pl.buf -= dt;
    if (input.jump) { pl.buf = BUFFER; input.jump = false; }
    if (pl.buf > 0) {
      if (pl.coyote > 0) { pl.vy = -JUMP; pl.buf = 0; pl.coyote = 0; pl.ground = false; }
      else if (power.double > 0 && pl.air < 1) { pl.vy = -JUMP * 0.9; pl.buf = 0; pl.air++; }
    }
    // vertical
    const falling = pl.vy > 0;
    pl.vy += G * dt * (falling && power.feather > 0 ? 0.4 : 1);
    if (falling && power.feather > 0) pl.vy = Math.min(pl.vy, 6);
    pl.vy = Math.min(pl.vy, 30);
    const oldBottom = pl.y + PH;
    pl.y += pl.vy * dt;
    pl.ground = false;
    for (const p of plats) {
      if (!solid(p) || !overlap(p)) continue;
      if (pl.vy > 0 && oldBottom <= p.y + 0.05) { pl.y = p.y - PH; pl.vy = 0; pl.ground = true; pl.air = 0; }
      else if (p.kind !== 'hidden' && pl.vy < 0) {
        pl.y = p.y + p.h; pl.vy = 0;
        if (p.kind === 'block' && !p.used) { p.used = true; gift(p, help); }
      }
    }
  }

  return {
    id: 'lantern',
    hints: { keys: '← → walk · ↑ or X jump', touch: 'hold a side to walk · swipe up or tap to jump' },
    stats() { return { score: nStars * 10 + Math.floor(farX - startX), stars: nStars, distance: Math.floor(farX - startX), falls, gifts }; },

    key(e, down) {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { input.l = down; return true; }
      if (k === 'ArrowRight' || k === 'd' || k === 'D') { input.r = down; return true; }
      if (['ArrowUp', 'w', 'W', 'x', 'X', 'z', 'Z', 'k', 'K'].includes(k)) { if (down && !e.repeat) input.jump = true; return true; }
      return false;
    },

    pointer(type, e) {
      const id = e.pointerId;
      if (type === 'down') {
        if (touches.size) input.jump = true; // a second finger jumps
        touches.set(id, { side: e.clientX < (L ? L.W / 2 : innerWidth / 2) ? -1 : 1, y0: e.clientY, t: performance.now(), jumped: false });
      } else if (type === 'move') {
        const t = touches.get(id);
        if (t && !t.jumped && t.y0 - e.clientY > 30) { input.jump = true; t.jumped = true; }
      } else {
        const t = touches.get(id);
        if (t && !t.jumped && performance.now() - t.t < 180 && touches.size === 1) input.jump = true;
        touches.delete(id);
      }
      // walk toward the side of the most recent finger still down
      let side = 0;
      for (const t of touches.values()) side = t.side;
      input.l = side < 0; input.r = side > 0;
    },

    frame(ctx, f) {
      const { W, H, dt, paused } = f;
      if (!L || L.W !== W || L.H !== H) layout(W, H);
      const { md, u } = L;
      const help = helpOf(f.coh);
      const R = md * (0.13 + 0.27 * help) * (0.92 + 0.16 * f.b) + (power.glow > 0 ? md * 0.12 : 0);
      const Ru = R / u;

      if (!paused) {
        age += dt; T += dt;
        generate(pl.x + 60);
        if (fade > 0) fade -= dt;
        else {
          const steps = Math.ceil(dt / (1 / 120));
          for (let i = 0; i < steps; i++) physics(dt / steps, help);
        }
        for (const k in power) power[k] = Math.max(0, power[k] - dt);
        farX = Math.max(farX, pl.x);
        const cx = pl.x + PW / 2, cy = pl.y + PH / 2;
        for (const p of plats) {
          if (p.kind !== 'hidden') continue;
          const dx = Math.max(p.x - cx, 0, cx - (p.x + p.w)), dy = Math.max(p.y - cy, 0, cy - (p.y + p.h));
          const inside = Math.hypot(dx, dy) < Ru * 0.85;
          p.lit = inside ? Math.min(1, p.lit + dt * 3) : Math.max(0, p.lit - dt * 0.25);
        }
        for (const s of stars) {
          if (s.got) continue;
          const d = Math.hypot(s.x - cx, s.y - cy);
          if (d < 0.75 && d < Ru) { s.got = true; nStars++; pops.push({ x: s.x, y: s.y - 0.3, text: '+star', life: 1 }); }
        }
        for (const p of posts) if (!p.on && pl.x > p.x - 0.5) { p.on = true; spawn = { x: p.x - PW / 2, y: p.y - PH }; }
        // fell: back to the last lantern post
        let below = -Infinity;
        for (const p of plats) if (p.kind === 'main' && Math.abs(p.x + p.w / 2 - pl.x) < 20) below = Math.max(below, p.y);
        if (pl.y > below + 10) {
          falls++;
          Object.assign(pl, { x: spawn.x, y: spawn.y, vx: 0, vy: 0, air: 0 });
          fade = 0.6;
        }
        for (const p of pops) { p.life -= dt; p.y -= dt * 0.8; }
        pops = pops.filter((p) => p.life > 0);
        L.camX += (pl.x * u - W * 0.35 - L.camX) * Math.min(1, dt * 5);
        L.camY += (pl.y * u - H * 0.55 - L.camY) * Math.min(1, dt * 2.5);
      }

      const sx = (x) => x * u - L.camX, sy = (y) => y * u - L.camY;
      const px = sx(pl.x + PW / 2), py = sy(pl.y + PH * 0.35);

      backdrop(ctx, f, px, py);
      // night hills, slow parallax
      for (let layer = 0; layer < 2; layer++) {
        const par = 0.15 + layer * 0.2;
        ctx.fillStyle = tone(f.hue + 0.62 + layer * 0.03, help * 0.5, 8 + layer * 4, f.overScene ? 0.8 : 1);
        ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 14) {
          const wx = (x + L.camX * par) / (W * (0.25 - layer * 0.08));
          ctx.lineTo(x, H * (0.62 + layer * 0.1) - md * 0.08 * (Math.sin(wx) * 0.6 + Math.sin(wx * 2.7 + layer) * 0.3 + 0.5) - L.camY * par * 0.2);
        }
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      }

      // the world, fully drawn; the darkness comes on top
      for (const p of plats) {
        const x = sx(p.x), y = sy(p.y);
        if (x > W + 50 || x + p.w * u < -50) continue;
        if (p.kind === 'main') {
          ctx.fillStyle = tone(f.hue + 0.58, help * 0.6, 16);
          ctx.fillRect(x, y, p.w * u, p.h * u);
          ctx.fillStyle = tone(f.hue + 0.3, help, 46);
          ctx.fillRect(x, y, p.w * u, Math.max(2, u * 0.12));
        } else if (p.kind === 'hidden') {
          if (p.lit < 0.02) continue;
          ctx.globalAlpha = p.lit;
          ctx.fillStyle = tone(f.hue + 0.12, help, 62);
          roundRect(ctx, x, y, p.w * u, p.h * u, u * 0.2); ctx.fill();
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = p.used ? 'rgba(239,234,255,0.18)' : tone(f.hue + 0.1, help, 58);
          roundRect(ctx, x + 1, y + 1, u - 2, u - 2, u * 0.18); ctx.fill();
          if (!p.used) {
            ctx.fillStyle = 'rgba(6,5,10,0.8)'; ctx.font = `${Math.round(u * 0.6)}px ${FONT}`; ctx.textAlign = 'center';
            ctx.fillText('?', x + u / 2, y + u * 0.72);
          }
        }
      }
      for (const s of stars) {
        if (s.got) continue;
        const x = sx(s.x), y = sy(s.y);
        if (x < -20 || x > W + 20) continue;
        const r = u * 0.22 * (1 + 0.15 * Math.sin(T * 3 + s.x));
        ctx.fillStyle = tone(f.hue + 0.15, 1, 80);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + T * 0.5, rr = i % 2 ? r * 0.35 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill();
      }

      // darkness with a hole for the lantern
      const dark = ctx.createRadialGradient(px, py, R * 0.15, px, py, R);
      dark.addColorStop(0, 'rgba(6,5,10,0)');
      dark.addColorStop(0.7, 'rgba(6,5,10,0.45)');
      dark.addColorStop(1, 'rgba(6,5,10,0.93)');
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, W, H);

      // the main path stays faintly visible in the dark
      ctx.fillStyle = 'rgba(239,234,255,0.22)';
      for (const p of plats) if (p.kind === 'main' || p.kind === 'block') ctx.fillRect(sx(p.x), sy(p.y), p.w * u, 1.5);
      // lantern posts
      for (const p of posts) {
        const x = sx(p.x), y = sy(p.y);
        if (x < -40 || x > W + 40) continue;
        ctx.strokeStyle = 'rgba(239,234,255,0.35)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - u * 2); ctx.stroke();
        const gl = ctx.createRadialGradient(x, y - u * 2.1, 0, x, y - u * 2.1, u * (p.on ? 1.4 : 0.5));
        gl.addColorStop(0, p.on ? tone(f.hue + 0.1, 0.8, 75, 0.9) : 'rgba(239,234,255,0.4)');
        gl.addColorStop(1, 'rgba(239,234,255,0)');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(x, y - u * 2.1, u * (p.on ? 1.4 : 0.5), 0, TAU); ctx.fill();
      }

      // the wanderer and the lantern
      const bx = sx(pl.x), by = sy(pl.y);
      ctx.globalAlpha = fade > 0 ? 1 - fade / 0.6 : 1;
      ctx.fillStyle = 'rgba(239,234,255,0.9)';
      roundRect(ctx, bx + u * 0.1, by + u * 0.25, PW * u - u * 0.2, PH * u - u * 0.25, u * 0.2); ctx.fill();
      ctx.beginPath(); ctx.arc(bx + PW * u / 2, by + u * 0.2, u * 0.2, 0, TAU); ctx.fill();
      const lx = bx + PW * u / 2 + pl.face * u * 0.45, ly = by + u * 0.55;
      const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, u * 0.9);
      lg.addColorStop(0, tone(f.hue + 0.1, 0.4 + 0.6 * help, 80, 0.95));
      lg.addColorStop(1, tone(f.hue + 0.1, 0.4 + 0.6 * help, 60, 0));
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(lx, ly, u * 0.9, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;

      for (const p of pops) {
        ctx.fillStyle = `rgba(239,234,255,${clamp(p.life).toFixed(3)})`;
        ctx.font = `10.5px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText(p.text, sx(p.x), sy(p.y));
      }

      breathBar(ctx, f, W < 700 ? 18 : 40, H * 0.3, Math.max(5, md * 0.012), H * 0.3);
      const pw = Object.entries(power).filter(([, v]) => v > 0).map(([k, v]) => [{ double: 'double jump', feather: 'feather', glow: 'wide light' }[k], `${Math.ceil(v)}s`]);
      stats(ctx, W - (W < 700 ? 16 : 40), W < 700 ? 110 : 90, [
        ['light', `${Math.round(100 * (0.13 + 0.27 * help) / 0.4)}%`, tone(f.hue, help, 72)],
        ['stars', nStars],
        ['distance', `${Math.floor(farX - startX)} m`],
        ...pw,
      ], 'right');
      hint(ctx, f, f.touch ? this.hints.touch : this.hints.keys, W / 2, W < 700 ? 82 : 62, age);
      if (age > 4 && age < 14) hint(ctx, f, 'a wider light shows hidden ledges and stars above the path', W / 2, W < 700 ? 98 : 78, age - 4);
    },
  };
}
