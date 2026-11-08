"""Heat-island change for 2000-2025 in three sensor-aligned periods, from the published passes.

Runs scripts/analyze_change.py, unchanged, on the clear passes of dry seasons 2000-2025 only, with
the periods 2000-2012 (Landsat 7), 2013-2019 (Landsat 8) and 2020-2025 (Landsat 8 and 9). Writes
docs/data/change_summary_2000_2025.json. Pixel-level outputs (period maps, share of land above a
threshold) are not part of it: they need a new Earth Engine export. See research/temporal-framework.md.

    python scripts/analyze_change_2000_2025.py
"""
from __future__ import annotations

import csv
import importlib.util
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data"
OUT = DATA / "change_summary_2000_2025.json"
FIRST, LAST = 2000, 2025
PERIODS = [("2000-2012", 2000, 2012, 2005, "Landsat 7"),
           ("2013-2019", 2013, 2019, 2015, "Landsat 8"),
           ("2020-2025", 2020, 2025, 2020, "Landsat 8 and 9")]


def load_analysis():
    spec = importlib.util.spec_from_file_location("analyze_change", ROOT / "scripts" / "analyze_change.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def copy_seasons(src: Path, dst: Path):
    """Copy a CSV keeping only rows whose dry season falls in FIRST..LAST."""
    with open(src, newline="") as fi, open(dst, "w", newline="") as fo:
        r = csv.DictReader(fi)
        w = csv.DictWriter(fo, fieldnames=r.fieldnames)
        w.writeheader()
        for row in r:
            if FIRST <= int(row["season"]) <= LAST:
                w.writerow(row)


def run(data: Path = DATA, out: Path = OUT) -> dict:
    meta = json.loads((data / "change_meta.json").read_text())
    meta["periods"] = [{"label": lab, "seasons": list(range(a, b + 1)), "ghsl_year": g, "sensors": s}
                       for lab, a, b, g, s in PERIODS]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        copy_seasons(data / "lagos_change_lga.csv", tmp / "lagos_change_lga.csv")
        copy_seasons(data / "lagos_change_scenes.csv", tmp / "lagos_change_scenes.csv")
        (tmp / "lagos_ghsl.csv").write_bytes((data / "lagos_ghsl.csv").read_bytes())
        (tmp / "change_meta.json").write_text(json.dumps(meta))
        summary = load_analysis().run(tmp, tmp / "out.json")
    summary["script"] = "scripts/analyze_change_2000_2025.py (runs scripts/analyze_change.py)"
    summary["study_period"] = [FIRST, LAST]
    summary.pop("map", None)   # no period maps for these periods yet
    out.write_text(json.dumps(summary, indent=1) + "\n")
    return summary


if __name__ == "__main__":
    s = run()
    for p in s["periods"]:
        st = s["state"][p["label"]]
        print(p["label"], p["sensors"], "passes", st["passes"], "H", st["weighted_suhi"], st["ci95"], "LGAs", st["lgas"])
    c = s["state_change"]
    print("change", c["delta"], c["ci95"], "over", c["lgas"], "LGAs; scenes", s["scenes"])
    print("warmed", [n for n, v in s["lgas"].items() if v["change"] and v["change"]["verdict"] == "Warmed"])
    print("urbanisation", {k: s["urbanisation"][k] for k in ("n", "slope_c_per_10pp", "ci95", "p_value")})
