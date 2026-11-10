"""Headline gaps at vegetation cut-offs of 0.3, 0.4 and 0.5 (distance to vegetation recomputed for each cut-off).

Reads research/rasters/veg_distance_{0.3,0.5}_m.tif (written by scripts/extra_analysis.py) and
veg_distance_m.tif (0.4). Writes docs/data/sensitivity_ndvi.json.

    python scripts/ndvi_cutoff_sensitivity.py
"""
import json
from pathlib import Path

import numpy as np

import uhi_metrics as um

ROOT = Path(__file__).resolve().parents[1]


def main():
    suhi = um.read("2020-2025_suhi_median.tif")
    count = um.read("2020-2025_count.tif")
    pop = um.read("population_2020.tif")
    out = {"note": "Gaps recomputed for each vegetation cut-off; same heat median and population as the main result."}
    out["cutoffs"] = {}
    for thr, name in [("0.3", "veg_distance_0.3_m.tif"), ("0.4", "veg_distance_m.tif"), ("0.5", "veg_distance_0.5_m.tif")]:
        base = um.baseline()
        d = um.read(name)
        d[d < 0] = np.nan
        base["beyond"] = base["inside"] & (np.nan_to_num(d, nan=-1) > um.ACCESS_M)
        r = um.headline(pop, suhi, count, base)
        out["cutoffs"][thr] = {"beyond_share": r["beyond_share"], "bu_gap_c": r["bu_gap_c"], "pooled_gap_c": r["pooled_gap_c"]}
        print(thr, round(r["beyond_share"], 4), round(r["bu_gap_c"], 3), round(r["pooled_gap_c"], 3))
    (ROOT / "docs" / "data" / "sensitivity_ndvi.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
