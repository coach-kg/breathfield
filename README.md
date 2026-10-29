# Breathfield

Generative breathing visuals with a pacer. Your heart's coherence steers four trippy scenes:
when your rhythm is scattered the picture is restless and grey, and when it settles it turns
symmetric, saturated and calm. Sessions go into a journal with streaks, adaptive ranks and
repeatable badges (×2, ×10 …).

A personal project. Not affiliated with HeartMath, and not a medical device.

## Run it

**Online (easiest).** Turn on GitHub Pages for this repo (Settings → Pages → Deploy from
branch → `main`, folder `/`). Then open `https://coach-kg.github.io/breathfield/` in Chrome or
Edge. On a phone or a Mac, use the browser's *Install* or *Add to Home Screen* option to get an
app icon. It also works offline after the first visit.

**On your Mac, from a download.** Double-click `start.command`. It runs a small local web
server and opens Breathfield in Chrome. The first time, macOS may ask you to allow it in
System Settings → Privacy & Security.

No build step and no dependencies: it is plain HTML and JavaScript, plus p5.js from a CDN.

## Heart sources

| Source | Works in | Quality | Status |
| --- | --- | --- | --- |
| Practice without a sensor (hold space while breathing in) | every browser | trains the habit, no real heart data | ready |
| Bluetooth chest strap with beat intervals (Polar H10, Garmin HRM, Wahoo TICKR …) | Chrome or Edge on Mac, Windows, Android, ChromeOS | best | ready |
| Fingertip on the phone camera | phones; light control on Android only | good when you sit still | ready, experimental |
| emWave 2 USB (start a session on the handheld) | Chrome or Edge on a computer | as good as emWave | live beats plus the emWave's own low/medium/high |
| Demo signal | everywhere | pretend | for trying things out |

Safari does not support Bluetooth or USB devices in web pages, so use Chrome or Edge for those.
How the emWave's USB data is decoded: [docs/DEVICES.md](docs/DEVICES.md).

## Keys

`Space` hold while breathing in · `Enter` start or end a session · `1`–`4` scenes ·
`J` journal · `G` pacer ring · `H` hide everything · `F` fullscreen · `Esc` close panels

## Your data

Sessions are stored in the browser on your device (IndexedDB). From *Journal → Settings* you
can export everything as one JSON file, import it on another device, or (in Chrome) pick a file
that Breathfield keeps updated after every session. Nothing is uploaded anywhere.

How coherence, the adaptive ranks and the badges work: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Photosensitivity

The scenes do not strobe. Brightness swells with the breath, about once every 10 seconds,
which is far below the "three flashes per second" limit in accessibility guidelines. They have
**not** been tested for photosensitive epilepsy, though, and two of them use high-contrast
repeating rings and stripes (Moiré most of all, then Tunnel) of the kind that can affect people
with pattern sensitivity. If you or someone using it has epilepsy, stick with Swarm until a
gentle mode exists, and stop if anything feels uncomfortable.

## Project layout

```
index.html, css/app.css     page and styles
src/main.js                 app wiring: sessions, journal, controls
src/engine/                 coherence, breath pacer, adaptive levels, streaks, badges (pure JS, tested)
src/devices/                one adapter per heart source, all emitting the same 'beat' events
src/visuals/                the four scenes and the badge glyphs
src/audio.js                the drone that follows breath and coherence
tools/                      Mac helpers for the emWave (read-only)
tests/                      npm test (Node 20+)
```

## Legal notes

emWave, HeartMath and Inner Balance are trademarks of HeartMath. Breathfield contains no
HeartMath code, assets or firmware. The coherence score is reimplemented from HeartMath's
public descriptions, so its numbers are close to emWave's but not identical. Reading your own
device's USB data for interoperability is what the emWave adapter does. This is not legal advice.
