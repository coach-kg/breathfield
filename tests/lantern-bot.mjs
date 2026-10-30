// Plays Lantern with a simple robot: walk right, jump at edges and walls.
// Usage: node tests/lantern-bot.mjs [seconds] [coherence 0..1]
import { createLantern } from '../src/games/lantern.js';

globalThis.document = globalThis.document || { hidden: false };
const noop = () => {};
const grad = { addColorStop: noop };
const ctx = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => grad : k === 'measureText' ? () => ({ width: 10 }) : noop), set: () => true });

export function playLantern({ seconds = 300, coh = 0.5, seed = 1 } = {}) {
  let s = seed; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = createLantern();
  const key = (k, down) => g.key({ key: k, repeat: false }, down);
  const f = { W: 1200, H: 800, dt: 1 / 60, paused: false, coh, b: 0.5, br: { label: 'in', rem: 3 }, hue: 0.3, glowRGB: [100, 200, 150], guide: 'off', overScene: false, touch: false, best: 0 };
  key('ArrowRight', true);
  let stuck = 0, lastX = 0, maxStuck = 0;
  for (let i = 0; i < seconds * 60; i++) {
    f.b = 0.5 + 0.5 * Math.sin(i / 60 * 0.6);
    g.frame(ctx, f);
    const { pl, plats } = g._debug();
    // where am I standing and what is ahead?
    const feet = pl.y + 1.0, mid = pl.x + 0.35;
    const under = plats.find((p) => (p.kind !== 'hidden' || p.lit > 0.25) && pl.x + 0.7 > p.x && pl.x < p.x + p.w && Math.abs(p.y - feet) < 0.05);
    const wall = plats.find((p) => p.kind === 'main' && p.x > pl.x + 0.7 && p.x < pl.x + 1.6 && p.y < feet - 0.05);
    const atEdge = under && under.x + under.w - (pl.x + 0.7) < 0.35;
    const groundBelow = under && under.kind === 'hidden' && plats.some((p) => p.kind === 'main' && p.y > feet && p.x < pl.x + 0.7 && p.x + p.w > pl.x + 2);
    if ((atEdge && !groundBelow) || wall) key('ArrowUp', true), key('ArrowUp', false);
    if (Math.abs(pl.x - lastX) < 0.001) stuck++; else { maxStuck = Math.max(maxStuck, stuck); stuck = 0; }
    lastX = pl.x;
  }
  return { ...g.stats(), maxStuckSec: +(maxStuck / 60).toFixed(1) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sec = +(process.argv[2] || 300), coh = +(process.argv[3] || 0.5);
  for (const seed of [1, 2, 3]) console.log('seed', seed, JSON.stringify(playLantern({ seconds: sec, coh, seed })));
}
