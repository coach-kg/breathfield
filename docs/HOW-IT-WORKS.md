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

**Heart-rate-only sources** (watches such as the Polar Unite) send a smoothed bpm once a second
instead of beat intervals. In a recorded session the breathing swing shrank from about 25–30 bpm
(emWave, same person) to about 7 bpm, and the strongest peak sat at half the breathing rate, from
slow drifts. Scored the normal way, that session looked high half the time for the wrong reason.
So for these sources the peak is only searched within ±0.02 Hz of the pacer: the score then
measures how much your heart rate follows your breathing. Expect lower numbers than with a strap
or the emWave; the session is marked `approx` in the journal.

## Find my pace

`src/engine/resonance.js`, after the clinical resonance-frequency protocol (Lehrer and colleagues;
reviewed by Shaffer & Meehan 2020). The pacer runs 6.5, 6, 5.5, 5 and 4.5 breaths a minute, even
in and out, 2 minutes each. For each rate the first 30 seconds are skipped and the rest is
analysed against the pacer (there is no breathing belt, so the pacer stands in for the breath):

- the heart-rate wave at the breathing rate, fitted by least squares: its peak-to-trough size and
  how much of the variation it explains;
- the average max − min heart rate within each breath;
- the phase: when heart rate peaks relative to the end of the in-breath (about 0° at resonance;
  it peaks later at faster rates and earlier at slower ones).

Score = 0.4 · size + 0.25 · max−min + 0.2 · fit + 0.15 · phase closeness, each relative to the best
rate. A best result at 6.5 or 4.5 is flagged (the true pace may lie beyond), and so is a near tie.
Results are kept (Breathing pace panel, and in the export) so you can see whether your pace drifts:
in one small study it changed between tests a week apart for 14 of 21 people.

## Glow score

`src/engine/glow.js`. Like the emWave's accumulated score: every 5-second update adds points for
your zone. Default: high +2, medium +1, low −1 (never below zero). Settings offer "medium holds"
or "low holds" instead. It resets with each session and is saved with it.

## Low, medium, high and ranks

`src/engine/levels.js`. A difficulty `d` from 0 to 4 sets the thresholds:

```
medium ≥ 17 + 10·d       high ≥ 35 + 12·d
```

Gentle (d = 0) is calibrated against the emWave 2 at its lowest challenge level: over a
16-minute session these cutoffs gave the same colour as the emWave for 76% of its verdicts.

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

`src/audio.js`. A low drone breathes with the pacer. As coherence rises, a fifth fades
in beneath it, then a soft major chord shimmers on top. Layers fade in over a few seconds and out
even more slowly.

Zone sounds (Settings → Sessions, off / soft / clearer, independent of the drone) are soft bells
in the drone's key: a rising pair or rise of three when you move up a zone, a quiet falling pair
when you move down, a warm chord after each minute held in high (one note in medium), and a high
shimmer every 100 glow points. Wobbling across one edge sounds at most once every 12 seconds;
climbing low → medium → high rings both steps. Low never gets a sound of its own.

## Haptics

`src/haptics.js`, through the browser's vibration API (Android only; Macs, iPhones and desktop
browsers cannot vibrate from a web page). The motor is on or off, so a swell is made from density:
ticks every 0.75 s at the start of the in-breath closing to every 0.2 s at the top, a gentle double
tap at each turn, and optionally thinning ticks through the out-breath. In studies, smooth swells
beat single pulses, which people found easy to miss or startling. Other modes: a soft tap on every
heartbeat, and rare positive taps (climbing a zone, a minute in high, every 100 glow). Vibration
is always off while the phone camera reads your pulse.

## Motion artifacts

The phone camera sees blood volume in the fingertip, and any movement of the finger changes the
picture far more than a heartbeat does. While the camera is the heart source, the phone's motion
sensor is watched: a beat whose interval overlaps movement is marked and left out of the score
(the beat light shows it orange). All sources also reject impossible intervals (outside 30–200 bpm)
and sudden jumps of more than 30% from the recent median.

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
