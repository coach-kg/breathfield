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
