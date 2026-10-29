// Adaptive coherence thresholds.
//
// A continuous difficulty `d` (0..4) sets the two thresholds that split a
// coherence score into low / medium / high:
//
//   medium >= 17 + 10·d      high >= 35 + 12·d
//
// Gentle (d = 0) is calibrated against the emWave 2 at its challenge level 1:
// over a 16-minute session these cutoffs gave the same low / medium / high as
// the emWave for 76% of its 5-second verdicts (see docs/DEVICES.md).
//
// The whole part of d is the rank (Gentle, Steady, Deep, Master); the
// fraction is your progress inside that rank. After each qualifying session
// d moves toward a difficulty where you spend roughly half the time in high.
//
// Nobody likes being knocked down a rank on a bad day, so:
//   * ranks you have reached once stay as badges forever (peakRank)
//   * d may sink into a grey zone of up to GREY below the rank's start while
//     the rank name holds
//   * the rank name only drops after HOLD_SESSIONS qualifying sessions in a
//     row spent in that grey zone
//   * the thresholds themselves always follow d, so off days stay doable

export const RANKS = [
  { id: 'gentle', name: 'Gentle' },
  { id: 'steady', name: 'Steady' },
  { id: 'deep', name: 'Deep' },
  { id: 'master', name: 'Master' },
];
export const D_MAX = 4;
export const GREY = 0.5;
export const HOLD_SESSIONS = 7;
export const MIN_ADAPT_SEC = 180;

export function thresholdsFor(d) {
  const x = Math.min(D_MAX, Math.max(0, d));
  return { medium: 17 + 10 * x, high: 35 + 12 * x };
}

export function zoneOf(score, th) {
  if (score >= th.high) return 2;
  if (score >= th.medium) return 1;
  return 0;
}

/** Map a score to 0..1 for visuals, with zone boundaries at 1/3 and 2/3. */
export function visualLevel(score, th) {
  if (score == null) return null;
  if (score < th.medium) return (score / th.medium) / 3;
  if (score < th.high) return 1 / 3 + ((score - th.medium) / (th.high - th.medium)) / 3;
  return 2 / 3 + Math.min(1, (score - th.high) / Math.max(1, 100 - th.high)) / 3;
}

export function initialLevelState() {
  return { d: 0, rank: 0, peakRank: 0, greyRun: 0, adaptive: true, manualRank: 0, log: [] };
}

/** Difficulty actually in use, respecting the adaptive switch. */
export function activeD(state) {
  return state.adaptive ? state.d : state.manualRank;
}

export function rankOf(state) {
  return state.adaptive ? state.rank : state.manualRank;
}

/**
 * Update the level state after a session. Pure: returns a new state and a
 * list of events ({type: 'rankUp'|'rankHeld'|'rankDown', rank}).
 * session needs: durationSec, sensor (bool), timeIn: [low, med, high] seconds.
 */
export function adaptAfterSession(state, session) {
  const s = { ...state, log: [...(state.log || [])] };
  const events = [];
  const scored = (session.timeIn || [0, 0, 0]).reduce((a, b) => a + b, 0);
  if (!s.adaptive || !session.sensor || session.durationSec < MIN_ADAPT_SEC || scored < 60) {
    return { state: s, events };
  }
  const high = session.timeIn[2] / scored;
  const before = s.d;
  if (high > 0.6) s.d += Math.min(0.3, (high - 0.6) * 0.9);
  else if (high < 0.25) s.d -= Math.min(0.15, (0.25 - high) * 0.5);
  // Never sink more than GREY below the rank currently shown.
  s.d = Math.min(D_MAX - 1e-6, Math.max(0, s.rank - GREY, s.d));

  const reached = Math.floor(s.d);
  if (reached > s.rank) {
    s.rank = reached;
    s.greyRun = 0;
    events.push({ type: 'rankUp', rank: s.rank });
  } else if (s.d < s.rank) {
    s.greyRun += 1;
    if (s.greyRun >= HOLD_SESSIONS) {
      s.rank -= 1;
      s.greyRun = 0;
      events.push({ type: 'rankDown', rank: s.rank });
    } else {
      events.push({ type: 'rankHeld', rank: s.rank, left: HOLD_SESSIONS - s.greyRun });
    }
  } else {
    s.greyRun = 0;
  }
  s.peakRank = Math.max(s.peakRank, s.rank);
  s.log.push({ at: session.start, from: +before.toFixed(3), to: +s.d.toFixed(3), high: +high.toFixed(3) });
  if (s.log.length > 400) s.log = s.log.slice(-400);
  return { state: s, events };
}
