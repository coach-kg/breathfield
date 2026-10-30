// Haptics through the browser's vibration API (Android: Chrome, Samsung
// Internet, Firefox). Desktop browsers and iPhone have no vibration, so
// everything here quietly does nothing there.
//
// The motor is only on or off, so a smooth swell is made from pulse density:
// soft ticks that come closer together through the inhale (and, if wanted,
// thin out again through the exhale), with one gentle double tap at each turn.
// Single short buzzes are easy to miss or startling, so there are none.
// Coherence taps are rare, positive and longer: never for low.

export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

const TICK_MS = 14;
const SLOW = 0.75, FAST = 0.2; // seconds between ticks at the start and end of a swell

export function createHaptics() {
  const st = { next: 0, kind: null, quietUntil: 0, lastTap: -1e9 };
  const buzz = (p) => { try { navigator.vibrate(p); } catch (e) { /* not allowed yet */ } };

  return {
    /**
     * Call every frame. mode: off | in | inout. br: breathAt() result. now: seconds.
     * heart: optional { beat: true } on frames where a heartbeat tap is wanted.
     */
    pacer(mode, br, now) {
      if (mode === 'off' || !canVibrate() || document.hidden) { st.kind = null; return; }
      const kind = br.kind;
      if (kind !== st.kind) {
        const turn = st.kind != null && (kind === 'in' || kind === 'out');
        st.kind = kind;
        if (turn && now >= st.quietUntil) {
          if (kind === 'in' || mode === 'inout') buzz([22, 90, 22]);
          st.next = now + 0.45;
          return;
        }
      }
      if (now < st.next || now < st.quietUntil) return;
      let gap = null;
      if (kind === 'in') gap = SLOW + (FAST - SLOW) * br.p;             // denser toward full
      else if (kind === 'out' && mode === 'inout') gap = FAST + (SLOW - FAST) * br.p * 1.3; // thinning out
      if (gap == null || (kind === 'out' && br.p > 0.85)) return;       // quiet at the bottom and in holds
      buzz(TICK_MS);
      st.next = now + gap;
    },

    /** A rare, positive tap for coherence events from the glow tracker. */
    reward(e, now) {
      if (!canVibrate() || document.hidden) return;
      if (now - st.lastTap < 8) return;
      let p = null;
      if (e.type === 'up' && e.to === 2) p = [70, 110, 140];
      else if (e.type === 'up') p = [120];
      else if (e.type === 'held' && e.zone === 2) p = [160];
      else if (e.type === 'milestone') p = [60, 90, 60, 90, 60];
      if (!p) return; // nothing for going down or for low
      st.lastTap = now;
      st.quietUntil = now + 0.9;
      buzz(p);
    },

    /** A soft tap on a heartbeat, for feeling your own pulse. */
    heartbeat(now) {
      if (!canVibrate() || document.hidden || now < st.quietUntil) return;
      buzz(18);
    },

    stop() { st.kind = null; if (canVibrate()) buzz(0); },
  };
}
