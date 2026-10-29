#!/usr/bin/env python3
"""Turn an emWave recording (.jsonl from emwave_probe.py, or the app's
"Save recording" .json) into plain files:

  <name>-beats.txt     one beat interval in ms per line (opens in Kubios and most HRV tools)
  <name>-status.csv    the emWave's own verdict every 5 s: seconds, level, zone, achievement, E

    python3 tools/emwave_decode.py on-slow.jsonl
"""

import json
import re
import sys
from pathlib import Path


def packets(path):
    text = Path(path).read_text()
    if text.lstrip().startswith("{\"app\""):
        return [p["hex"] for p in json.loads(text)["packets"]]
    out = []
    for line in text.splitlines():
        p = json.loads(line)
        if "hex" in p:
            out.append(p["hex"])
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    for path in sys.argv[1:]:
        buf, beats, status = "", [], []
        for h in packets(path):
            b = bytes.fromhex(h.replace(" ", ""))
            if b[0] != 0x66:
                continue
            buf += b[4:4 + b[3]].decode("ascii", "replace")
            while ">" in buf:
                msg, buf = buf.split(">", 1)
                if "<" not in msg:
                    continue
                msg = msg[msg.rindex("<") + 1:].strip()
                m = re.fullmatch(r"I\s+(\d+)", msg)
                if m:
                    beats.append(int(m.group(1)))
                elif msg.startswith("1 "):
                    kv = dict(x.split("=", 1) for x in msg.split()[1:] if "=" in x)
                    status.append([kv.get(k, "") for k in ("T", "L", "S", "A", "E")])
        stem = Path(path).with_suffix("")
        Path(f"{stem}-beats.txt").write_text("\n".join(map(str, beats)) + "\n")
        Path(f"{stem}-status.csv").write_text("seconds,level,zone,achievement,E\n" + "\n".join(",".join(r) for r in status) + "\n")
        hr = 60000 / (sum(beats) / len(beats)) if beats else 0
        print(f"{path}: {len(beats)} beats (mean {hr:.0f} bpm), {len(status)} status lines → {stem}-beats.txt, {stem}-status.csv")


if __name__ == "__main__":
    main()
