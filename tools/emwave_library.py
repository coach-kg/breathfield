#!/usr/bin/env python3
"""Look inside your HeartMath / emWave data without touching it.

1. Copies the HeartMath folders to a snapshot folder on your Desktop
   (the originals are only read, never changed).
2. Lists what is in the copy and, for every database it finds, prints the
   tables, their columns and how many rows each has. No personal values are
   printed unless you ask for a table with --dump.

    python3 tools/emwave_library.py
    python3 tools/emwave_library.py --dump SessionTable --limit 5

This is also how sessions recorded on the emWave 2 handheld get in: let the
official emWave software sync the handheld as usual, then read the synced
sessions from this snapshot. Breathfield never talks to the handheld's
storage directly, so nothing on it can be wiped.
"""

import argparse
import json
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path

HOME = Path.home()
CANDIDATES = [
    HOME / "Library/Application Support/HeartMath",
    HOME / "Library/Application Support/emWave",
    HOME / "Documents/emWave",
    HOME / "Documents/HeartMath",
]
SKIP_EXT = {".mp3", ".m4a", ".wav", ".aif", ".aiff", ".mp4", ".mov", ".m4v", ".app"}


def sniff(path):
    try:
        with open(path, "rb") as f:
            head = f.read(16)
    except OSError:
        return "unreadable"
    if head.startswith(b"SQLite format 3"):
        return "sqlite"
    if head.startswith(b"PK"):
        return "zip"
    if head.lstrip().startswith(b"<?xml") or head.lstrip().startswith(b"<"):
        return "xml"
    if head.startswith(b"bplist"):
        return "plist"
    try:
        head.decode("utf-8")
        return "text"
    except UnicodeDecodeError:
        return "binary"


def snapshot(sources, dest):
    for src in sources:
        target = dest / src.name
        print(f"Copying {src} → {target}")
        shutil.copytree(
            src, target, dirs_exist_ok=True,
            ignore=lambda d, names: [n for n in names if Path(n).suffix.lower() in SKIP_EXT],
        )


def describe_db(path, out):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        tables = [r[0] for r in con.execute("select name from sqlite_master where type='table' order by name")]
        out(f"    {len(tables)} tables")
        for t in tables:
            cols = [f"{c[1]} {c[2]}".strip() for c in con.execute(f'pragma table_info("{t}")')]
            n = con.execute(f'select count(*) from "{t}"').fetchone()[0]
            out(f"    · {t} ({n} rows): {', '.join(cols)}")
    finally:
        con.close()


def dump_table(dbs, table, limit):
    for db in dbs:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        try:
            names = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
            if table not in names:
                continue
            rows = con.execute(f'select * from "{table}" limit ?', (limit,)).fetchall()
            data = [{k: (v if not isinstance(v, bytes) else f"<{len(v)} bytes>") for k, v in dict(r).items()} for r in rows]
            print(json.dumps({"database": str(db), "table": table, "rows": data}, indent=1, default=str))
            return
        finally:
            con.close()
    print(f"No table called {table} was found.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--path", action="append", default=[], help="extra folder to include")
    ap.add_argument("--dump", metavar="TABLE", help="print rows of this table as JSON")
    ap.add_argument("--limit", type=int, default=10, help="rows to print with --dump (default 10)")
    args = ap.parse_args()

    sources = [p for p in CANDIDATES + [Path(x).expanduser() for x in args.path] if p.exists()]
    if not sources:
        print("No HeartMath or emWave folders found. Pass one with --path.")
        sys.exit(1)

    dest = HOME / "Desktop" / f"breathfield-emwave-snapshot-{time.strftime('%Y%m%d-%H%M%S')}"
    dest.mkdir(parents=True)
    snapshot(sources, dest)

    lines = []
    out = lambda s: (print(s), lines.append(s))
    dbs = []
    out(f"\nSnapshot: {dest}\n")
    for root, _, files in os.walk(dest):
        for name in sorted(files):
            p = Path(root) / name
            kind = sniff(p)
            out(f"{p.relative_to(dest)}  ({p.stat().st_size:,} bytes, {kind})")
            if kind == "sqlite":
                dbs.append(p)
                try:
                    describe_db(p, out)
                except sqlite3.Error as e:
                    out(f"    could not read: {e}")
    (dest / "report.txt").write_text("\n".join(lines))
    print(f"\nReport saved to {dest / 'report.txt'}. Paste it into the chat to build the importer.")

    if args.dump:
        dump_table(dbs, args.dump, args.limit)


if __name__ == "__main__":
    main()
