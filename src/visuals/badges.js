// Every badge gets its own small generative mandala, seeded by its id.
// Earned badges glow in colour; locked ones are a faint outline.

const GROUP_HUE = { Start: 268, Streaks: 200, Time: 32, Coherence: 150, Ranks: 300, Explore: 50 };

function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
}

export function badgeGlyph(badge, size = 48) {
  const r = seed(badge.id);
  const earned = badge.count > 0;
  const hue = (GROUP_HUE[badge.group] ?? 260) + Math.floor(r() * 40) - 20;
  const petals = 5 + Math.floor(r() * 8);
  const rings = 2 + Math.floor(r() * 2);
  const c = size / 2;
  const parts = [];
  for (let k = 0; k < rings; k++) {
    const R = c * (0.92 - k * 0.26);
    const w = R * (0.28 + r() * 0.25);
    const h = (hue + k * 28) % 360;
    const stroke = earned ? `hsl(${h} 85% ${68 - k * 6}%)` : 'rgba(239,234,255,0.22)';
    const fill = earned ? `hsla(${h}, 80%, 60%, ${0.16 + k * 0.08})` : 'none';
    const n = petals + k * (r() < 0.5 ? 0 : petals);
    const rot = r() * 360;
    for (let i = 0; i < n; i++) {
      const a = rot + (360 / n) * i;
      parts.push(`<ellipse cx="${c}" cy="${(c - R / 2).toFixed(2)}" rx="${(w / 2).toFixed(2)}" ry="${(R / 2).toFixed(2)}" transform="rotate(${a.toFixed(1)} ${c} ${c})" fill="${fill}" stroke="${stroke}" stroke-width="0.8"/>`);
    }
  }
  const core = earned ? `hsl(${hue} 90% 82%)` : 'rgba(239,234,255,0.3)';
  parts.push(`<circle cx="${c}" cy="${c}" r="${(c * 0.12).toFixed(2)}" fill="${core}"/>`);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${parts.join('')}</svg>`;
}
