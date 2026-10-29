# How it works

## Coherence

`src/engine/coherence.js`, following HeartMath's public description:

1. Keep the beat intervals of the last 64 seconds. Reject impossible ones (outside 30–200 bpm)
   and sudden jumps of more than 30% from the recent median (missed or extra beats).
2. Every 5 seconds, resample them to an even 2 Hz series (128 points), remove the trend and
   apply a Hann window.
3. Compute the power spectrum. Find the highest peak between 0.04 and 0.26 Hz.
4. Peak power is the power within ±0.015 Hz of that peak; total power covers 0.0033–0.4 Hz.

```
ratio = peak / (total − peak)        HeartMath-style coherence ratio
score = 100 × peak / total           0–100, shown in the app
```

A score appears after 30 seconds of clean beats. Typical values in testing: a random rhythm
scores 20–30, a faint breathing rhythm 50–65, and calm 6-per-minute breathing 85–98.

## Low, medium, high and ranks

`src/engine/levels.js`. A difficulty `d` from 0 to 4 sets the thresholds:

```
medium ≥ 30 + 10·d       high ≥ 50 + 10·d
```

The whole part of `d` is your rank: Gentle (0), Steady (1), Deep (2), Master (3). The fraction is
your progress inside the rank.

When adapting is on, `d` changes after each sensor session of 3 minutes or more:

- more than 60% of the time in high: `d` rises, by up to 0.3 per session
- between 25% and 60%: no change, this is the comfortable zone
- under 25%: `d` eases down, by at most 0.15 per session

Dropping a rank feels bad, so it is cushioned:

- `d` never sinks more than 0.5 below the start of the rank you hold (the grey zone)
- the rank name only drops after 7 sessions in a row spent in the grey zone
- every rank you have reached stays as a badge

Switch adapting off in *Journal → Settings* to pin the thresholds to one rank. Practice
sessions without a sensor never change your rank.

## Streaks and badges

`src/engine/progress.js` and `src/engine/achievements.js`. Sessions of 2 minutes or more count.
A day starts at 3:00 by default (adjustable), so a session at 1 a.m. still belongs to the
evening before.

Badges are recalculated from the whole journal each time, so importing old data earns them too.
Repeatable badges count how often you have done the thing: two separate week-long streaks give
*A week ×2*, a 30-day streak gives *Three days ×10*, every hour of practice adds to *An hour*.

## Sound

`src/audio.js`. No chimes. A low drone breathes with the pacer. As coherence rises, a fifth fades
in beneath it, then a soft major chord shimmers on top. Layers fade in over a few seconds and out
even more slowly.

## Journal file

*Export JSON* writes:

```json
{
  "app": "breathfield",
  "format": 1,
  "exportedAt": "2026-10-29T18:00:00.000Z",
  "settings": { "scene": 0, "pattern": 0, "sessionMin": 10, "rollover": 3, "volume": 0.6 },
  "level": { "d": 1.42, "rank": 1, "peakRank": 1, "greyRun": 0, "adaptive": true, "manualRank": 0, "log": [] },
  "sessions": [
    {
      "id": "…", "start": "…", "end": "…", "durationSec": 612,
      "device": "ble", "deviceLabel": "Polar H10", "sensor": true, "demo": false,
      "pattern": 0, "patternId": "six", "scenes": ["mandala"],
      "d": 1.3, "thresholds": { "medium": 43, "high": 63 },
      "timeIn": [60, 140, 380], "avgScore": 71.4, "avgHr": 63.2,
      "scores": [[30.0, 52.1], [35.0, 58.7]],
      "ibis": [[0.912, 912], [1.83, 918]]
    }
  ]
}
```

`timeIn` is seconds in low, medium and high. `scores` are `[seconds since start, score]` every
5 s. `ibis` are `[seconds since start, interval in ms]` for every clean beat, so the raw data
can go into other HRV tools such as Kubios.
