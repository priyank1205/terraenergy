#!/usr/bin/env python3
"""
Check a rebuilt public/data/ against the last commit before an unattended refresh publishes it.

    python3 pipeline/check_data.py                       # compare with HEAD; exit 1 on a suspicious drop
    python3 pipeline/check_data.py --restore-unchanged   # also undo files whose only change is a build timestamp

A failed or partial download shows up as missing data, not as an error: fewer flows, less volume in a commodity,
countries dropping out of a metric, or daily series going backwards. Real data rarely moves that much in a week,
so any of those stops the refresh and leaves the published site as it was.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = "public/data"
MAX_FLOW_DROP = 0.15    # flow count or volume per commodity
MAX_METRIC_DROP = 0.05  # countries with a value, per metric
# Fields that change on every build without any change in the data.
BUILD_STAMPS = {"meta.json": ("generated",), "trade_details.json": ("generated_at",)}


def load(name: str, text: str | None):
    if text is None:
        return None
    if name.endswith(".txt"):
        return text.split("\n", 1)[-1]  # the report's first line is the build date
    data = json.loads(text)
    for key in BUILD_STAMPS.get(name, ()):
        data.pop(key, None)
    return data


def committed(path: str) -> str | None:
    res = subprocess.run(["git", "show", f"HEAD:{path}"], cwd=ROOT, capture_output=True, text=True)
    return res.stdout if res.returncode == 0 else None


def summarize(files: dict) -> dict:
    """The quantities a broken download would shrink."""
    flows = defaultdict(lambda: [0, 0.0])
    for f in (files.get("flows.json") or {}).get("flows", []):
        flows[f["c"]][0] += 1
        flows[f["c"]][1] += f["v"]
    latest = files.get("latest.json") or {}
    cps = files.get("chokepoints.json") or {}
    return {
        "flows": {c: tuple(v) for c, v in flows.items()},
        "metrics": {m: sum(1 for row in rows.values() if row and row[0] is not None) for m, rows in latest.items()},
        "countries": len((files.get("countries.json") or {}).get("countries", [])),
        "chokepoints": len(cps.get("chokepoints", [])),
        "portwatch_end": {pid: s["end"] for pid, s in (cps.get("portwatch") or {}).items()},
    }


def problems(old: dict, new: dict) -> list[str]:
    """Reasons to hold back the new build (empty when it looks sound)."""
    out = []
    for c, (n0, v0) in old["flows"].items():
        n1, v1 = new["flows"].get(c, (0, 0.0))
        if n1 < n0 * (1 - MAX_FLOW_DROP):
            out.append(f"{c}: {n0} → {n1} flows")
        if v1 < v0 * (1 - MAX_FLOW_DROP):
            out.append(f"{c}: volume {v0:,.0f} → {v1:,.0f}")
    for m, n0 in old["metrics"].items():
        n1 = new["metrics"].get(m, 0)
        if n1 < n0 * (1 - MAX_METRIC_DROP):
            out.append(f"metric {m}: {n0} → {n1} countries with data")
    if new["countries"] < old["countries"]:
        out.append(f"countries: {old['countries']} → {new['countries']}")
    if new["chokepoints"] < old["chokepoints"]:
        out.append(f"chokepoints: {old['chokepoints']} → {new['chokepoints']}")
    for pid, end in old["portwatch_end"].items():
        if new["portwatch_end"].get(pid, "") < end:
            out.append(f"PortWatch {pid}: series now ends {new['portwatch_end'].get(pid)} (was {end})")
    return out


def report(old: dict, new: dict) -> str:
    """A short Markdown summary of what the refresh changed."""
    lines = ["| Commodity | Flows | Volume |", "|---|---|---|"]
    for c in sorted(set(old["flows"]) | set(new["flows"])):
        n0, v0 = old["flows"].get(c, (0, 0.0))
        n1, v1 = new["flows"].get(c, (0, 0.0))
        pct = f" ({100 * (v1 - v0) / v0:+.1f}%)" if v0 else ""
        lines.append(f"| {c} | {n0} → {n1} | {v0:,.0f} → {v1:,.0f}{pct} |")
    ends = sorted(set(new["portwatch_end"].values()))
    if ends:
        lines.append(f"\nPortWatch daily transits now end {ends[-1]}.")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--restore-unchanged", action="store_true", help="undo files whose only change is a build timestamp")
    args = ap.parse_args()
    names = sorted(p.name for p in (ROOT / DATA).iterdir() if p.suffix in (".json", ".txt"))
    old, new = {}, {}
    for name in names:
        path = f"{DATA}/{name}"
        before = committed(path)
        old[name] = load(name, before)
        new[name] = load(name, (ROOT / path).read_text())
        if args.restore_unchanged and before is not None and old[name] == new[name]:
            subprocess.run(["git", "checkout", "HEAD", "--", path], cwd=ROOT, check=True)
    changed = [n for n in names if old[n] != new[n]]
    s_old, s_new = summarize(old), summarize(new)
    print(f"Changed data files: {', '.join(changed) or 'none'}")
    summary = report(s_old, s_new)
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as fh:
            fh.write(f"### Data refresh\n\nChanged: {', '.join(changed) or 'nothing'}\n\n{summary}\n")
    issues = problems(s_old, s_new)
    if issues:
        print("\nHolding back this build — it looks like a broken or partial download:\n  " + "\n  ".join(issues))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
