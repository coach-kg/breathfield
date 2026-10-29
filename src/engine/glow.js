// Glow: a score that fills while you stay coherent, like the emWave's
// accumulated score. Every 5-second update adds points for the zone you are
// in. Depending on the rule, medium fills slowly or just holds, and low drains
// a little or just holds. It never goes below zero.
//
// The tracker also reports moments worth a gentle sound: moving up or down a
// zone, each full minute held in medium or high, and every 100 glow points.

export const GLOW_RULES = {
  classic: { name: 'High fills, medium fills slowly, low drains', gain: [-1, 1, 2] },
  steady: { name: 'High fills, medium holds, low drains', gain: [-1, 0, 2] },
  gentle: { name: 'High fills, medium fills slowly, low holds', gain: [0, 1, 2] },
};
export const MILESTONE = 100;
export const HOLD_SEC = 60;
export const CUE_GAP_SEC = 12; // wobbling across an edge sounds at most once in this time

export function createGlowTracker(rule = 'classic') {
  const st = { glow: 0, zone: null, since: 0, held: 0, lastCue: -1e9, cueZone: null, cueUp: null, rule };
  return {
    get glow() { return st.glow; },
    get zone() { return st.zone; },
    setRule(r) { if (GLOW_RULES[r]) st.rule = r; },
    reset() { st.glow = 0; },
    /** zone: 0 low, 1 medium, 2 high (null while warming up); t in seconds. Returns events. */
    update(zone, t) {
      const ev = [];
      if (zone == null) { st.zone = null; return ev; }
      const before = st.glow;
      st.glow = Math.max(0, st.glow + GLOW_RULES[st.rule].gain[zone]);
      if (Math.floor(st.glow / MILESTONE) > Math.floor(before / MILESTONE)) ev.push({ type: 'milestone', n: Math.floor(st.glow / MILESTONE) * MILESTONE });
      if (st.zone == null) { st.zone = zone; st.since = t; st.held = 0; return ev; }
      if (zone !== st.zone) {
        // Inside the gap only a step beyond the last cued zone sounds (low → medium → high
        // in a row both ring), so wobbling across one edge stays quiet.
        const up = zone > st.zone;
        const beyond = st.cueUp === up && (up ? zone > st.cueZone : zone < st.cueZone);
        if (t - st.lastCue >= CUE_GAP_SEC || beyond) { ev.push({ type: up ? 'up' : 'down', from: st.zone, to: zone }); st.lastCue = t; st.cueZone = zone; st.cueUp = up; }
        st.zone = zone; st.since = t; st.held = 0;
      } else if (zone >= 1) {
        const mins = Math.floor((t - st.since) / HOLD_SEC);
        if (mins > st.held) { st.held = mins; ev.push({ type: 'held', zone, minutes: mins }); }
      }
      return ev;
    },
  };
}
