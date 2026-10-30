// Haptics through the browser's vibration API: Chromium browsers on Android
// (Chrome, Samsung Internet, Brave, Edge). Firefox switched it off, and
// desktop browsers and iPhones have none, so everything here quietly does
// nothing there. There is no permission prompt: the page only needs one tap
// first. Many phone motors barely move in under ~25 ms, hence the strengths.
//
// The motor is only on or off, so a smooth swell is made from pulse density:
// soft ticks that come closer together through the inhale (and, if wanted,
// thin out again through the exhale), with one gentle double tap at each turn.
// Single short buzzes are easy to miss or startling, so there are none.
// Coherence taps are rare, positive and longer: never for low.

export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export const STRENGTH = { gentle: 25, medium: 40, strong: 60 }; // tick length in ms
const SLOW = 0.75, FAST = 0.2; // seconds between ticks at the start and end of a swell

export function createHaptics() {
  const st = { next: 0, kind: null, quietUntil: 0, lastTap: -1e9, tick: STRENGTH.medium };
  const buzz = (p) => { try { navigator.vibrate(p); } catch (e) { /* not allowed yet */ } };

  return {
    setStrength(name) { st.tick = STRENGTH[name] || STRENGTH.medium; },

    /** A short sample on a button press. Returns what the browser said. */
    test() {
      if (!canVibrate()) return 'none';
      let ok = false;
      try { ok = navigator.vibrate([st.tick, 140, st.tick, 140, st.tick * 4]); } catch (e) { ok = false; }
      return ok ? 'sent' : 'refused';
    },

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
          if (kind === 'in' || mode === 'inout') buzz([st.tick + 8, 90, st.tick + 8]);
          st.next = now + 0.45;
          return;
        }
      }
      if (now < st.next || now < st.quietUntil) return;
      let gap = null;
      if (kind === 'in') gap = SLOW + (FAST - SLOW) * br.p;             // denser toward full
      else if (kind === 'out' && mode === 'inout') gap = FAST + (SLOW - FAST) * br.p * 1.3; // thinning out
      if (gap == null || (kind === 'out' && br.p > 0.85)) return;       // quiet at the bottom and in holds
      buzz(st.tick);
      st.next = now + gap;
    },

    /** A rare, positive tap for coherence events from the glow tracker. */
    reward(e, now) {
      if (!canVibrate() || document.hidden) return;
      if (now - st.lastTap < 8) return;
      let p = null;
      const k = st.tick / STRENGTH.medium;
      if (e.type === 'up' && e.to === 2) p = [80 * k, 110, 160 * k];
      else if (e.type === 'up') p = [130 * k];
      else if (e.type === 'held' && e.zone === 2) p = [180 * k];
      else if (e.type === 'milestone') p = [70 * k, 90, 70 * k, 90, 70 * k];
      if (p) p = p.map(Math.round);
      if (!p) return; // nothing for going down or for low
      st.lastTap = now;
      st.quietUntil = now + 0.9;
      buzz(p);
    },

    /** A soft tap on a heartbeat, for feeling your own pulse. */
    heartbeat(now) {
      if (!canVibrate() || document.hidden || now < st.quietUntil) return;
      buzz(st.tick);
    },

    stop() { st.kind = null; if (canVibrate()) buzz(0); },
  };
}
