// Days, streaks and totals from the session log.

export const MIN_SESSION_SEC = 120; // shorter sessions are kept but do not count

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar day of a moment, with the day starting at `rollover` o'clock. */
export function dayKey(when, rollover = 3) {
  const d = new Date(when);
  d.setHours(d.getHours() - rollover);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Sessions that count toward streaks and badges (demo-signal sessions never do). */
export function counted(sessions) {
  return sessions.filter((s) => s.durationSec >= MIN_SESSION_SEC && !s.demo);
}

/** Map day → {sessions, minutes, highMinutes}. */
export function byDay(sessions, rollover = 3) {
  const m = new Map();
  for (const s of counted(sessions)) {
    const k = dayKey(s.start, rollover);
    const e = m.get(k) || { sessions: 0, minutes: 0, highMinutes: 0 };
    e.sessions += 1;
    e.minutes += s.durationSec / 60;
    e.highMinutes += ((s.timeIn && s.timeIn[2]) || 0) / 60;
    m.set(k, e);
  }
  return m;
}

/** Runs of consecutive days where the day has at least `min` sessions. */
export function runs(days, min = 1) {
  const keys = [...days.keys()].filter((k) => days.get(k).sessions >= min).sort();
  const out = [];
  let cur = null;
  for (const k of keys) {
    if (cur && addDays(cur.end, 1) === k) { cur.end = k; cur.len++; }
    else { cur = { start: k, end: k, len: 1 }; out.push(cur); }
  }
  return out;
}

/** Current streak: a run that ends today, or yesterday if today is still open. */
export function currentStreak(days, today) {
  const r = runs(days);
  const last = r[r.length - 1];
  if (!last) return 0;
  if (last.end === today || last.end === addDays(today, -1)) return last.len;
  return 0;
}

export function bestStreak(days) {
  return runs(days).reduce((m, r) => Math.max(m, r.len), 0);
}

export function totals(sessions) {
  const c = counted(sessions);
  const sec = c.reduce((a, s) => a + s.durationSec, 0);
  const high = c.reduce((a, s) => a + ((s.timeIn && s.timeIn[2]) || 0), 0);
  return { sessions: c.length, minutes: sec / 60, highMinutes: high / 60 };
}
