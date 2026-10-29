#!/usr/bin/env python3
"""Compare two heart sources that recorded at the same time.

Typical use: run Breathfield on the Mac with the emWave and on the phone
with the camera, start both sessions within a few seconds of each other,
then export both journals (Journal -> Settings -> Export JSON) and run:

    python3 tools/compare_sessions.py mac-journal.json phone-journal.json

It finds the sessions that overlap in time, lines up their beats (first by
clock, then fine-tuned by matching the heart-rate wave), and reports how
closely the second source follows the first: matched beats, beat-interval
error, heart rate and coherence. No extra packages needed.
"""

import json
import math
import sys
from datetime import datetime


def load(path):
    with open(path) as f:
        data = json.load(f)
    if data.get("app") != "breathfield":
        sys.exit(f"{path} is not a Breathfield journal export.")
    return data["sessions"]


def t0(s):
    return datetime.fromisoformat(s["start"].replace("Z", "+00:00")).timestamp()


def series(beats, start, end, step=0.5):
    """Beat intervals resampled every `step` seconds between start and end."""
    out, k = [], 0
    t = start
    while t <= end:
        while k < len(beats) - 2 and beats[k + 1][0] < t:
            k += 1
        a, b = beats[k], beats[min(k + 1, len(beats) - 1)]
        u = 0 if b[0] == a[0] else max(0.0, min(1.0, (t - a[0]) / (b[0] - a[0])))
        out.append(a[1] + (b[1] - a[1]) * u)
        t += step
    return out


def corr(x, y):
    n = min(len(x), len(y))
    if n < 3:
        return float("nan")
    x, y = x[:n], y[:n]
    mx, my = sum(x) / n, sum(y) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    return sxy / math.sqrt(sxx * syy) if sxx and syy else float("nan")


def compare(ref, other):
    a = [(t0(ref) + t, ibi) for t, ibi in ref["ibis"]]
    b = [(t0(other) + t, ibi) for t, ibi in other["ibis"]]
    start, end = max(a[0][0], b[0][0]) + 5, min(a[-1][0], b[-1][0]) - 5
    if end - start < 60:
        return None
    # Fine alignment: try shifts of ±8 s, keep the one where the heart-rate waves match best.
    sa = series(a, start, end)
    best = (-2, 0.0)
    for k in range(-80, 81):
        sh = k * 0.1
        sb = series([(t - sh, v) for t, v in b], start, end)
        c = corr(sa, sb)
        if c == c and c > best[0]:
            best = (c, sh)
    shift = best[1]
    b2 = [(t - shift, v) for t, v in b]
    # Beat matching: each reference beat to the nearest other beat within 150 ms.
    matched, errs, j = 0, [], 0
    ref_in = [p for p in a if start <= p[0] <= end]
    oth_in = [p for p in b2 if start <= p[0] <= end]
    for t, ibi in ref_in:
        while j < len(oth_in) - 1 and oth_in[j + 1][0] < t:
            j += 1
        cand = [oth_in[i] for i in (j, j + 1) if i < len(oth_in)]
        near = min(cand, key=lambda p: abs(p[0] - t)) if cand else None
        if near and abs(near[0] - t) <= 0.15:
            matched += 1
            errs.append(abs(near[1] - ibi))
    hr = lambda ps: 60000 / (sum(v for _, v in ps) / len(ps)) if ps else float("nan")
    # Coherence scores, matched by time (within 3 s).
    sca = [(t0(ref) + t, v) for t, v in ref.get("scores", [])]
    scb = [(t0(other) + t - shift, v) for t, v in other.get("scores", [])]
    pairs = []
    for t, v in sca:
        near = min(scb, key=lambda p: abs(p[0] - t), default=None)
        if near and abs(near[0] - t) <= 3:
            pairs.append((v, near[1]))
    th = ref.get("thresholds") or {"medium": 17, "high": 35}
    zone = lambda v: 2 if v >= th["high"] else 1 if v >= th["medium"] else 0
    same_zone = sum(1 for x, y in pairs if zone(x) == zone(y))
    return {
        "overlap_s": end - start,
        "shift_s": shift,
        "wave_corr": best[0],
        "beats_ref": len(ref_in),
        "beats_other": len(oth_in),
        "matched": matched,
        "ibi_err_ms": sorted(errs)[len(errs) // 2] if errs else float("nan"),
        "ibi_err_mean": sum(errs) / len(errs) if errs else float("nan"),
        "hr_ref": hr(ref_in),
        "hr_other": hr(oth_in),
        "score_pairs": len(pairs),
        "score_corr": corr([p[0] for p in pairs], [p[1] for p in pairs]),
        "same_zone": same_zone,
    }


def label(s):
    return f"{s['start'][:19].replace('T', ' ')} · {s.get('deviceLabel', s.get('device'))} · {round(s['durationSec'] / 60, 1)} min"


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    A, B = load(sys.argv[1]), load(sys.argv[2])
    found = 0
    for ra in A:
        for rb in B:
            if ra["id"] == rb["id"] or not ra.get("ibis") or not rb.get("ibis"):
                continue
            ea, eb = t0(ra) + ra["durationSec"], t0(rb) + rb["durationSec"]
            if min(ea, eb) - max(t0(ra), t0(rb)) < 60:
                continue
            r = compare(ra, rb)
            if not r:
                continue
            found += 1
            print(f"\nReference: {label(ra)}\nCompared:  {label(rb)}")
            print(f"  overlap {r['overlap_s']:.0f} s, clocks differ by {r['shift_s']:+.1f} s after alignment")
            print(f"  heart-rate wave correlation   {r['wave_corr']:.2f}   (1.0 = identical rhythm)")
            print(f"  beats                         {r['beats_ref']} vs {r['beats_other']}, matched within 150 ms: {r['matched']} ({100 * r['matched'] / max(1, r['beats_ref']):.0f}%)")
            print(f"  beat-interval error           median {r['ibi_err_ms']:.0f} ms, mean {r['ibi_err_mean']:.0f} ms")
            print(f"  mean heart rate               {r['hr_ref']:.1f} vs {r['hr_other']:.1f} bpm")
            if r["score_pairs"]:
                print(f"  coherence score correlation   {r['score_corr']:.2f} over {r['score_pairs']} readings, same colour {100 * r['same_zone'] / r['score_pairs']:.0f}%")
    if not found:
        print("No sessions found that ran at the same time for at least a minute.")


if __name__ == "__main__":
    main()
