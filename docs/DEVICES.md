# Heart sources

Every source is an adapter in `src/devices/` that emits the same events:

- `beat` `{t, ibi}`: time of the beat in seconds (performance clock) and the interval since the previous beat in milliseconds
- `pulse` `{t, v}`: optional raw pulse-wave sample
- `status` `{text, state}`

The coherence engine only needs beats, so adding a device means turning its data into beats.

## emWave 2 / emWave Pro (USB)

Confirmed on a Mac:

```
HeartMath emWave 2
Vendor ID   0x0E30 (HeartMath LLC), manufacturer string "Quantum Intech Inc."
Product ID  0x0008
Version     0.81, full speed (12 Mb/s), draws 500 mA
HID         yes: AppleUserHIDDevice, usage page 0xFF00 (vendor-defined), usage 0xFF
```

Because it is a vendor-defined HID device, macOS needs no driver and Chrome or Edge can open it
through WebHID. The data layout inside the reports is HeartMath's own, which is what Step 2 is for.

To check another unit:

```bash
hidutil list | grep -i -E "e30|heartmath"
system_profiler SPUSBDataType | grep -i -B 4 -A 4 "0x0e30"
```

### Step 2: record

Either in the app (*Sensor → emWave → Use this*, then *Save recording*), or with the read-only
Python probe:

```bash
pip3 install hidapi
python3 tools/emwave_probe.py --list
python3 tools/emwave_probe.py --seconds 30 --out off-ear.jsonl
python3 tools/emwave_probe.py --seconds 90 --out on-ear-still.jsonl
python3 tools/emwave_probe.py --seconds 90 --out on-ear-slow-breathing.jsonl
```

Three recordings with a known difference between them make the format much easier to read:
the pulse wave should rise and fall about once a second, and the beat interval should swing
slowly in the slow-breathing file.

### Step 3: the protocol (decoded)

Decoded from three recordings (nothing on the sensor, sitting still, slow breathing). The
emWave 2 streams on its own while a session runs on the handheld; no start command is needed.
With no session running it only sends keep-alives.

Every HID report starts with a type byte:

```
0x75 lo hi 00 …            keep-alive, 16-bit counter, about every 1.3 s
0x66 lo hi len text…       `len` bytes of ASCII, 16-bit counter; text continues across reports
```

The text is a stream of messages in angle brackets, separated by carriage returns:

| Message | Meaning |
| --- | --- |
| `<I 736 >` | One heartbeat: interval since the previous beat in ms. Resolution is about 7 ms. |
| `<2 I=760 R=F H=79 >` | The intervals resampled at 2 Hz (two per second whatever your heart rate). `R=T` marks an artifact, `H` is 60000 / I. |
| `<1 L=1 T=295 S=2 A=43 E=222 >` | Every 5 s. `L` challenge level, `T` session seconds, `S` zone (0 low, 1 medium, 2 high), `A` accumulated achievement score (−1, +1 or +2 per 5 s), `E` see below. |

`E` rises steeply with coherence (9–90 while sitting still, up to 3347 while breathing slowly).
It tracks HeartMath's "entrainment parameter" from their patent, (peak power ÷ power below the
peak) × (peak power ÷ power above it), times 100: computed on the emWave's own 2 Hz series it
went 1078 → 4408 while `E` went 1156 → 3347. Longer recordings will pin this down.

At challenge level 1 the emWave's zone follows `E` almost exactly. In a 7-minute session
(77 verdicts) every `E` below 60 was low, 60 to 136 was medium and 156 or more was high, with a
single exception (195 shown as medium, probably smoothing). So at level 1: **low < 60 ≤ medium
< ~150 ≤ high**.

A 16-minute capture (198 verdicts) confirmed it: `E` with cutoffs 60 and 150 predicts the
emWave's zone 197 times out of 198.

Breathfield's coherence ratio, computed on the emWave's own 2 Hz series over 64 s with a Hann
window, tracks `E` with a log correlation of 0.82. Breathfield's first thresholds (30 / 50)
were too strict for level 1; refitting them to 17 / 35 makes Breathfield's colour match the
emWave's 76% of the time. The setting *Colours and visuals follow → the emWave's own verdict*
remains the exact choice whenever the emWave is connected.

With no session running on the handheld the emWave sends only keep-alives. Breathfield notices
after 5 seconds and asks you to start one.

`tools/emwave_decode.py` turns a recording into a beats file for Kubios and a CSV of the
emWave's verdicts. In the app, the emWave adapter emits the real beats into Breathfield's
coherence engine and keeps the emWave's own `S` and `E` with each session, so the two can be
compared and calibrated over time.

### Sessions stored on the emWave 2 handheld

Breathfield does not read the handheld's internal storage. Keep syncing the handheld with the
official emWave software as usual, then read the synced sessions from its data folder:

```bash
python3 tools/emwave_library.py
```

This copies the HeartMath folders to a snapshot on your Desktop, never touching the originals,
and prints the database tables and columns. With that report, an importer can turn your past
sessions into Breathfield journal entries.

## Bluetooth chest straps

Standard Heart Rate Service (0x180D) with RR intervals. Tested format parsing in
`tests/engine.test.mjs`. Chest straps measure the electrical heartbeat, so their intervals are
the most precise of all sources. Many optical watches and armbands send heart rate but no
intervals; Breathfield says so when that happens.

HeartMath's Inner Balance Bluetooth sensor may or may not use the standard service. If it shows
up in the Bluetooth picker, it works.

## Fingertip camera

`camera-ppg.js` averages the red channel of each frame and finds beats with sub-frame timing.
A 2023 study of camera pulse during slow-paced breathing found HRV values very close to ECG
(van Dijk et al., *Psychosomatic Medicine* 85(7)). Chest straps remain more precise.

- Android Chrome: back camera with the flashlight on.
- iPhone Safari: no flashlight control in web pages; hold the finger over the lens facing a bright lamp or window.
- Laptop webcams: unreliable.
