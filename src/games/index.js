// The game shelf. Each playable game is a factory returning
// { id, hints, frame(ctx, f), key(e, down) → handled, pointer(type, e), stats() }.
// Ideas and ground rules: docs/GAMES.md.

import { createStillfall } from './stillfall.js';
import { createSnake } from './snake.js';
import { createBow } from './bow.js';
import { createCairn } from './cairn.js';
import { createLantern } from './lantern.js';

export const GAMES = [
  { id: 'stillfall', name: 'Stillfall', glyph: '▤', create: createStillfall,
    blurb: 'Falling blocks. A calm heart slows time down to half speed, and in the high zone a ghost piece and a second preview appear.' },
  { id: 'snake', name: 'Slow Snake', glyph: '∿', create: createSnake,
    blurb: 'The classic, slowed by coherence. Bumping into yourself only sheds your tail, and a minute of high coherence lets you glide through once.' },
  { id: 'lantern', name: 'Lantern', glyph: '☼', create: createLantern,
    blurb: 'A tiny night platformer. Your light is your coherence: it reveals hidden ledges and stars, and "?" blocks give kinder gifts when you are calm.' },
  { id: 'cairn', name: 'Cairn', glyph: '◒', create: createCairn,
    blurb: 'Stack river stones. The calmer your heart, the less the next stone swings; drop it on the out-breath and it settles toward the middle.' },
  { id: 'bow', name: 'Bow', glyph: '➳', create: createBow,
    blurb: 'Archery across a valley. Calm steadies your aim and shows the arrow\'s path; let go on the out-breath for double points.' },
  { id: 'tailwind', name: 'Tailwind', glyph: '➶', soon: true,
    blurb: 'Glide along the breathing wave through rings. Coherence is your tailwind.' },
  { id: 'garden', name: 'Garden', glyph: '❀', soon: true,
    blurb: 'A garden that grows over days from the time you spend coherent.' },
];

export const gameById = (id) => GAMES.find((g) => g.id === id && !g.soon);
