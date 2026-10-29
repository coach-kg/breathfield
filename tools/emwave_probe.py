#!/usr/bin/env python3
"""Read-only probe for the HeartMath emWave USB sensor (vendor ID 0x0E30).

Lists the HeartMath devices macOS exposes as HID devices and records every
packet the sensor sends for a while, so we can work out the data format.

It only ever READS. Nothing is written to the device, so it cannot change
settings or erase sessions stored on an emWave 2.

    pip3 install hidapi
    python3 tools/emwave_probe.py --list
    python3 tools/emwave_probe.py --seconds 90 --out capture-ear-on.jsonl

Quit emWave Pro first: only one program can hold the sensor at a time.

Good recordings to make, each in its own file, with a note of what you did:
  1. sensor unplugged from your ear, 30 s     (what "no pulse" looks like)
  2. sensor on, sitting still, 90 s           (normal pulse)
  3. sensor on, breathing slowly 5 in / 5 out (the rhythm we want to see)
"""

import argparse
import json
import sys
import time

VENDOR_ID = 0x0E30


def load_hid():
    try:
        import hid  # from the "hidapi" package
        return hid
    except ImportError:
        print("Missing the hidapi package. Install it with:\n\n    pip3 install hidapi\n")
        sys.exit(1)


def describe(d):
    return (
        f"product 0x{d['product_id']:04x}  '{d.get('product_string') or ''}'  "
        f"usage page 0x{d.get('usage_page', 0):04x} usage 0x{d.get('usage', 0):04x}  "
        f"interface {d.get('interface_number')}"
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="only list HeartMath HID devices")
    ap.add_argument("--seconds", type=float, default=60, help="how long to record (default 60)")
    ap.add_argument("--out", default="emwave-capture.jsonl", help="output file, one JSON packet per line")
    ap.add_argument("--index", type=int, default=0, help="which listed device to open (default 0)")
    args = ap.parse_args()

    hid = load_hid()
    devs = [d for d in hid.enumerate() if d["vendor_id"] == VENDOR_ID]
    if not devs:
        print("No HeartMath device shows up as a HID device.")
        print("Either it is unplugged, or it uses a different USB class. Please send the output of:\n")
        print("    ioreg -p IOUSB -l -w0 | grep -i -A 30 heartmath")
        print("    hidutil list | grep -i -E 'e30|heartmath'")
        sys.exit(2)

    for i, d in enumerate(devs):
        print(f"[{i}] {describe(d)}")
    if args.list:
        return

    d = devs[args.index]
    h = hid.device()
    try:
        h.open_path(d["path"])
    except OSError as e:
        print(f"Could not open the device: {e}")
        print("Quit emWave Pro and try again. If it still fails, allow Terminal under")
        print("System Settings > Privacy & Security > Input Monitoring.")
        sys.exit(3)

    print(f"\nRecording {args.seconds:.0f} s from {describe(d)}")
    print(f"Writing to {args.out}. Reading only; nothing is sent to the device.\n")
    t0 = time.monotonic()
    count = 0
    shown = 0
    last_report = t0
    with open(args.out, "w") as f:
        f.write(json.dumps({"kind": "header", "vendor_id": d["vendor_id"], "product_id": d["product_id"],
                            "product": d.get("product_string"), "usage_page": d.get("usage_page"),
                            "usage": d.get("usage"), "started": time.strftime("%Y-%m-%dT%H:%M:%S")}) + "\n")
        while time.monotonic() - t0 < args.seconds:
            data = h.read(64, 250)
            now = time.monotonic()
            if data:
                count += 1
                hexs = " ".join(f"{b:02x}" for b in data)
                f.write(json.dumps({"t": round(now - t0, 4), "hex": hexs}) + "\n")
                if shown < 8:
                    print(f"  {now - t0:7.3f}s  {hexs}")
                    shown += 1
            if now - last_report >= 5:
                rate = count / (now - t0)
                print(f"  … {count} packets so far ({rate:.1f} per second)")
                last_report = now
    h.close()
    if count == 0:
        print("\nThe sensor was silent. It may wait for a start command from emWave Pro.")
        print("Next step is capturing what emWave Pro sends (see docs/DEVICES.md).")
    else:
        print(f"\nDone: {count} packets in {args.out}.")


if __name__ == "__main__":
    main()
