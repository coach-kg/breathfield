# Minigames: ideas

HeartMath's emWave Pro once sold extra games where your coherence was the throttle, among them
a dolphin race where a calm heart meant a faster swim. Lovely idea, steep price. These are our
own takes on the same promise: simple games people already know, where a settled heart quietly
helps you. No names, art, sounds or code from those games.

## Ground rules

- **Coherence only ever helps.** It slows time, lifts, brightens, reveals. A scattered heart
  makes the game ordinary, never harder than normal and never a "game over" cause.
- **Playable at 6 breaths a minute.** No twitch reflexes; the game leaves room to breathe slowly.
- **The pacer is in the world.** The breathing guide becomes part of the scene (a wave you
  glide along, a lantern that swells), not an overlay.
- **No flashing, no beat-triggered effects.** Same rule as the scenes.
- **Every game is a session.** Time played counts for streaks and badges, with the game's name
  in the journal. Works with every heart source, including practice mode.

## What a game gets from Breathfield

```js
// read-only, updated every frame
breathfield.state = {
  coh,      // 0..1 smoothed coherence (the visuals use the same value)
  zone,     // 0 low · 1 medium · 2 high
  b,        // breath depth from the pacer, 0 empty … 1 full
  phase,    // 'in' | 'out' | 'holdIn' | 'holdOut'
  hr, hrv,  // heart rate (bpm), beat-to-beat variability (RMSSD, ms)
}
```

Games would live in `src/games/`, one file each, drawn with the same p5 canvas, and open
from a new *Games* entry next to the scene picker.

---

## 1. Stillfall (Tetris-like)

```
 ┌──────────┐   NEXT ▢▢    calm  ███████░░  time ×0.45
 │    ▢▢    │        ▢▢
 │     ▢▢   │   when you're coherent the blocks drift down
 │          │   like snow; scattered, they fall at normal speed
 │▢ ▢▢▢ ▢▢▢▢│
 │▢▢▢▢▢▢▢▢▢▢│ ← clears dissolve into the scene's colours
 └──────────┘
```

- **Coherence slows time**: gravity × (1 − 0.6 · coh). High coherence feels like slow motion.
- **High zone adds help**: a ghost piece and a second "next" preview fade in.
- **Breath**: the well's glow swells with the pacer; nothing to press for breathing.
- Why it works: Tetris is calming when slow and stressful when fast, so the heart controls the
  very thing that makes it stressful.

## 2. Tailwind (glider over the breathing wave)

A nod to the dolphin race, but in the air and gentler.

```
        ✦ ring                    ✦
   ～～～～╱‾‾‾‾╲～～～～～～╱‾‾‾‾╲～～   ← the pacer wave is the flight path
  ➶  glider                              (rings sit on it)
 ▁▁▂▃▅▆▇ dawn hills ▇▆▅▃▂▁▁▂▃▅▆▇▅▃▂▁
```

- **Breath steers**: hold space / press the screen while breathing in to rise, let go to sink.
  Following the pacer means flying through the rings on the wave.
- **Coherence is the tailwind**: speed, a longer trail, the sky warming toward sunrise.
- **Rings** collected = points; missing one costs nothing.
- Endless; a run is a session (5–10 minutes).

## 3. Lantern (tiny platformer, Tux / Mario spirit)

```
   ·   ·  ░░  ·    the lantern's glow radius = coherence
  ▄▄   ☼ ▄▄▄       hidden platforms and stars only appear inside the light
 ▀▀▀▀  🯅  ▀▀▀  ?   coins are optional; there are no enemies, only gaps
```

- **Coherence is light**: a wider glow reveals hidden platforms, shortcuts and stars.
- **Power-ups are kinder when you're calm**: in high coherence, "?" blocks favour the good ones
  (double jump, feather fall, a glowing path).
- **Breath**: the lantern swells with the inhale, so the light gently pulses at 6/min.
- Short hand-made levels; falling just respawns at the last lantern post.

## 4. Cairn (stone stacking)

- Place flat stones one by one; the stack **wobbles less** the more coherent you are.
- Drop on the exhale for a steadier placement (a small bonus, never required).
- Score = height; a fallen stack simply slides into the river and you start a new one.

## 5. Garden (idle, across days)

- Each session waters a small generative garden; minutes in high coherence make it bloom.
- Plants grow over days, so the garden doubles as a streak you can look at.
- Missed days don't kill anything; plants just wait.

## 6. Slow Snake

- Classic snake on a dark grid. Coherence sets the speed (slower when calm) and lets the snake
  pass through its own tail once per minute in the high zone.

## 7. Bow (archery)

- Draw the bow while breathing in, release on the exhale. Aim sway = 1 − coherence: calm
  hands, steady arrow. Targets drift slowly across a valley.

---

## Order to build

1. **Stillfall**: smallest to build, easy to judge whether "coherence as slow motion" feels good.
2. **Tailwind**: shows off breath steering and the wave guide we already have.
3. **Garden**: turns the journal into something to look forward to.
4. Lantern, Cairn, Slow Snake, Bow as the mood takes us.
