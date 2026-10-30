import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playLantern } from './lantern-bot.mjs';

test('lantern: a simple robot can always keep going (no impossible jumps)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const r = playLantern({ seconds: 150, coh: seed % 2 ? 0.1 : 0.7, seed });
    assert.ok(r.distance > 600, `seed ${seed}: only ${r.distance} m (${r.falls} falls)`);
    assert.ok(r.falls <= 3, `seed ${seed}: ${r.falls} falls`);
  }
});
