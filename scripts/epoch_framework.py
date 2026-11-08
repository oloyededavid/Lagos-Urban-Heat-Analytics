"""Test period schemes for the heat-island change analysis on the published per-pass data.

Reruns scripts/analyze_change.py, unchanged, with different period definitions and records the
results side by side in research/epoch_framework.json. Uses only the clear passes already in
docs/data/lagos_change_lga.csv, so it needs no Earth Engine access. Pixel-level fields (the
period maps and the share of land above 3 C) are not recomputed: those need a new export.

    python scripts/epoch_framework.py
"""
from __future__ import annotations

import csv
import importlib.util
import json
import shutil
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data"
OUT = ROOT / "research" / "epoch_framework.json"

# (label, first season, last season, GHSL epoch used for built-up change)
SCHEMES = {
    "published_1985_2026": [("1985-2003", 1985, 2003, 1995), ("2004-2013", 2004, 2013, 2010), ("2014-2026", 2014, 2026, 2020)],
    "brief_four_epochs_2000_2025": [("2000-2005", 2000, 2005, 2000), ("2006-2012", 2006, 2012, 2010),
                                    ("2013-2019", 2013, 2019, 2015), ("2020-2025", 2020, 2025, 2020)],
    "sensor_consistent_2000_2025": [("2000-2012", 2000, 2012, 2005), ("2013-2019", 2013, 2019, 2015), ("2020-2025", 2020, 2025, 2020)],
}


def load_analysis():
    spec = importlib.util.spec_from_file_location("analyze_change", ROOT / "scripts" / "analyze_change.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sensors_by_period(periods):
    used = [r for r in csv.DictReader(open(DATA / "lagos_change_scenes.csv")) if r["used"] == "yes"]
    out = {}
    for label, a, b, _ in periods:
        c = Counter(r["sensor"] for r in used if a <= int(r["season"]) <= b)
        out[label] = dict(sorted(c.items()))
    return out


def run_scheme(analysis, periods):
    meta = json.loads((DATA / "change_meta.json").read_text())
    meta["periods"] = [{"label": lab, "seasons": list(range(a, b + 1)), "ghsl_year": g} for lab, a, b, g in periods]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for name in ("lagos_change_lga.csv", "lagos_change_scenes.csv", "lagos_ghsl.csv"):
            shutil.copy(DATA / name, tmp / name)
        (tmp / "change_meta.json").write_text(json.dumps(meta))
        s = analysis.run(tmp, tmp / "out.json")
    labels = [p[0] for p in periods]
    return {
        "periods": {lab: {"passes": s["state"][lab]["passes"], "weighted_suhi_common": s["state"][lab]["weighted_suhi"],
                          "ci95": s["state"][lab]["ci95"], "common_lgas": s["state"][lab]["lgas"],
                          "weighted_suhi_all_observed": s["state"][lab]["all_observed"]["weighted_suhi"],
                          "lgas_observed": s["state"][lab]["all_observed"]["lgas"]} for lab in labels},
        "sensors": sensors_by_period(periods),
        "change_first_to_last": s["state_change"],
        "lgas_warmed": sorted(n for n, v in s["lgas"].items() if v["change"] and v["change"]["verdict"] == "Warmed"),
        "lgas_testable": sum(1 for v in s["lgas"].values() if v["change"] and v["change"]["verdict"] != "Too few clear days"),
        "urbanisation": {k: s["urbanisation"][k] for k in ("n", "slope_c_per_10pp", "ci95", "p_value", "spearman_rho", "spearman_p", "ghsl_years")}
        | {"without_most_built": s["urbanisation"]["without_most_built"]},
    }


def main():
    analysis = load_analysis()
    result = {"script": "scripts/epoch_framework.py", "source": "docs/data/lagos_change_lga.csv (published clear passes)",
              "note": "State values are land-area-weighted heat island (C above the countryside) over the LGAs with at least "
                      "three clear passes in every period of the scheme; intervals resample whole passes.",
              "schemes": {name: run_scheme(analysis, periods) for name, periods in SCHEMES.items()}}
    OUT.write_text(json.dumps(result, indent=1) + "\n")
    return result


if __name__ == "__main__":
    r = main()
    for name, s in r["schemes"].items():
        print(name)
        for lab, p in s["periods"].items():
            print(f"  {lab}: passes {p['passes']:2d}  common {p['common_lgas']:2d} LGAs  H = {p['weighted_suhi_common']} {p['ci95']}  sensors {s['sensors'][lab]}")
        c = s["change_first_to_last"]
        print(f"  change {c['delta']} {c['ci95']} over {c['lgas']} LGAs; warmed: {s['lgas_warmed']} of {s['lgas_testable']} testable")
