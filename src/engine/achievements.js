// Badges. Each badge returns how many times it has been earned, so repeat
// achievements show as ×2, ×10 … Everything is derived from the session log
// and the level state, so importing old data re-earns badges correctly.

import { byDay, runs, counted, totals, dayKey, addDays } from './progress.js';

const hourOf = (iso) => new Date(iso).getHours();
const sumRuns = (rs, n) => rs.reduce((a, r) => a + Math.floor(r.len / n), 0);

export const BADGES = [
  { id: 'first', group: 'Start', name: 'First breath', desc: 'Finish your first session.',
    count: (c) => (c.sessions.length ? 1 : 0) },

  { id: 'streak3', group: 'Streaks', name: 'Three days', desc: 'Practise three days in a row. Counts again every 3 days of a streak.',
    count: (c) => sumRuns(c.runs1, 3) },
  { id: 'streak7', group: 'Streaks', name: 'A week', desc: 'Seven days in a row.',
    count: (c) => sumRuns(c.runs1, 7) },
  { id: 'streak30', group: 'Streaks', name: 'A month', desc: 'Thirty days in a row.',
    count: (c) => sumRuns(c.runs1, 30) },
  { id: 'streak100', group: 'Streaks', name: 'Hundred days', desc: 'One hundred days in a row.',
    count: (c) => sumRuns(c.runs1, 100) },
  { id: 'streak365', group: 'Streaks', name: 'A year', desc: 'Every day for a year.',
    count: (c) => sumRuns(c.runs1, 365) },
  { id: 'twice7', group: 'Streaks', name: 'Twice daily, one week', desc: 'Two sessions a day, seven days in a row.',
    count: (c) => sumRuns(c.runs2, 7) },
  { id: 'twice30', group: 'Streaks', name: 'Twice daily, one month', desc: 'Two sessions a day, thirty days in a row.',
    count: (c) => sumRuns(c.runs2, 30) },
  { id: 'comeback', group: 'Streaks', name: 'Welcome back', desc: 'Return after a week or more away.',
    count: (c) => c.comebacks },

  { id: 'hour', group: 'Time', name: 'An hour', desc: 'Every hour of total practice.',
    count: (c) => Math.floor(c.totals.minutes / 60) },
  { id: 'tenHours', group: 'Time', name: 'Ten hours', desc: 'Every ten hours of total practice.',
    count: (c) => Math.floor(c.totals.minutes / 600) },
  { id: 'long', group: 'Time', name: 'Long sit', desc: 'A single session of 20 minutes or more.',
    count: (c) => c.sessions.filter((s) => s.durationSec >= 1200).length },
  { id: 'sunrise', group: 'Time', name: 'Sunrise', desc: 'A session started between 5 and 9 in the morning.',
    count: (c) => c.sessions.filter((s) => { const h = hourOf(s.start); return h >= 5 && h < 9; }).length },
  { id: 'moon', group: 'Time', name: 'Moonlight', desc: 'A session started after 9 in the evening.',
    count: (c) => c.sessions.filter((s) => hourOf(s.start) >= 21).length },

  { id: 'tenHigh', group: 'Coherence', name: 'Ten minutes high', desc: 'Ten minutes in high coherence within one session.',
    count: (c) => c.sensed.filter((s) => s.timeIn[2] >= 600).length },
  { id: 'glass', group: 'Coherence', name: 'Still water', desc: 'Five minutes or more with at least 80% of the time in high.',
    count: (c) => c.sensed.filter((s) => s.durationSec >= 300 && s.timeIn[2] / Math.max(1, s.timeIn[0] + s.timeIn[1] + s.timeIn[2]) >= 0.8).length },
  { id: 'highHour', group: 'Coherence', name: 'High hour', desc: 'Every hour spent in high coherence, across all sessions.',
    count: (c) => Math.floor(c.totals.highMinutes / 60) },

  { id: 'rankSteady', group: 'Ranks', name: 'Steady', desc: 'Reach the Steady rank.',
    count: (c) => (c.level.peakRank >= 1 ? 1 : 0) },
  { id: 'rankDeep', group: 'Ranks', name: 'Deep', desc: 'Reach the Deep rank.',
    count: (c) => (c.level.peakRank >= 2 ? 1 : 0) },
  { id: 'rankMaster', group: 'Ranks', name: 'Master', desc: 'Reach the Master rank.',
    count: (c) => (c.level.peakRank >= 3 ? 1 : 0) },

  { id: 'scenes', group: 'Explore', name: 'Every room', desc: 'Breathe in every scene.',
    count: (c) => (c.scenes.size >= c.sceneCount ? 1 : 0) },
  { id: 'patterns', group: 'Explore', name: 'Every rhythm', desc: 'Finish a session with every breathing pattern.',
    count: (c) => (c.patterns.size >= c.patternCount ? 1 : 0) },
];

export function context(sessions, level, { rollover = 3, patternCount = 5, sceneCount = 6 } = {}) {
  const c = counted(sessions).sort((a, b) => a.start.localeCompare(b.start));
  const days = byDay(c, rollover);
  let comebacks = 0;
  const dayList = [...days.keys()].sort();
  for (let i = 1; i < dayList.length; i++) {
    if (dayList[i] > addDays(dayList[i - 1], 7)) comebacks++;
  }
  const scenes = new Set(), patterns = new Set();
  for (const s of c) {
    (s.scenes || []).forEach((x) => scenes.add(x));
    if (s.pattern != null) patterns.add(s.pattern);
  }
  return {
    sessions: c,
    sensed: c.filter((s) => s.sensor && s.timeIn),
    days,
    runs1: runs(days, 1),
    runs2: runs(days, 2),
    comebacks,
    totals: totals(c),
    level,
    scenes,
    patterns,
    patternCount,
    sceneCount,
    today: dayKey(Date.now(), rollover),
  };
}

/** [{...badge, count}] for every badge. */
export function evaluate(sessions, level, opts) {
  const c = context(sessions, level, opts);
  return BADGES.map((b) => ({ id: b.id, group: b.group, name: b.name, desc: b.desc, count: b.count(c) }));
}

/** Badges whose count went up between two evaluations. */
export function gained(before, after) {
  const prev = new Map(before.map((b) => [b.id, b.count]));
  return after.filter((b) => b.count > (prev.get(b.id) || 0));
}
