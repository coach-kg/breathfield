# Heart sources

Every source is an adapter in `src/devices/` that emits the same events:

- `beat` `{t, ibi}`: time of the beat in seconds (performance clock) and the interval since the previous beat in milliseconds
- `pulse` `{t, v}`: optional raw pulse-wave sample
- `status` `{text, state}`

The coherence engine only needs beats, so adding a device means turning its data into beats.

## emWave 2 / emWave Pro (USB)

What we know so far, from your Mac:

```
Vendor ID: 0x0e30 (HeartMath LLC)
Version: 0.81, full speed (12 Mb/s), draws 500 mA
```

Still needed: the product ID and whether macOS treats it as a HID device.

### Step 1: identify

Quit emWave Pro, plug in the sensor, then in Terminal:

```bash
hidutil list | grep -i -E "e30|heartmath"
system_profiler SPUSBDataType | grep -i -B 4 -A 4 "0x0e30"
```

If `hidutil` lists it, it is a HID device and Chrome can talk to it directly (WebHID).

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

### Step 3: decode

Fill in `decodeReport()` in `src/devices/emwave-hid.js`. It returns either raw pulse samples
(which go through the beat detector in `ppg.js`) or ready-made beat intervals.

### If the sensor stays silent

Some devices only start streaming after the host sends a command. Then we need to see what
emWave Pro sends. Capturing USB traffic on recent macOS is awkward, so the usual route is a
Windows machine or virtual machine running emWave Pro with USBPcap and Wireshark. We would only
ever replay the start-streaming command, never anything that touches stored data.

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
