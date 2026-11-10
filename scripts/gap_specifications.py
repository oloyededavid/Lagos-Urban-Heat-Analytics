"""Built-up gap under the main analytic choices, crossed:
vegetation cut-off (NDVI 0.3, 0.4, 0.5) x exclusion buffer around vegetated cells (0, 60, 120 m) x population layer
(unconstrained, constrained). Also: the gap within each LGA, the gap on low ground versus higher ground, and the gap
by distance to permanent water.

Writes docs/data/gap_specifications.json. Distances come from research/rasters/veg_distance_*.tif (scripts/extra_analysis.py).

    python scripts/gap_specifications.py
"""
import json
from pathlib import Path

import numpy as np
import rasterio
from scipy import ndimage

import uhi_metrics as um

ROOT = Path(__file__).resolve().parents[1]
RAS = ROOT / "research" / "rasters"
CUTOFFS = [("0.3", "veg_distance_0.3_m.tif"), ("0.4", "veg_distance_m.tif"), ("0.5", "veg_distance_0.5_m.tif")]
BUFFERS = [0, 60, 120]


def gap_for(pop, suhi, count, base, d, buf):
    """Built-up gap with within-group cells at distance <= buf removed (buf = 0 removes vegetated cells only)."""
    inside, wc = base["inside"], base["wc"]
    beyond = inside & (np.nan_to_num(d, nan=-1) > um.ACCESS_M)
    within = inside & ~beyond & (np.nan_to_num(d, nan=-1) > buf)
    b2 = {"inside": inside & ~((~beyond) & (np.nan_to_num(d, nan=-1) <= buf)), "beyond": beyond, "wc": wc}
    r = um.headline(pop, suhi, count, b2)
    return r["bu_gap_c"], r["bu_within"]["population"], r["bu_beyond"]["population"]


def main():
    suhi = um.read("2020-2025_suhi_median.tif")
    count = um.read("2020-2025_count.tif")
    pops = {"unconstrained": um.read("population_2020.tif"), "constrained": um.read("population_2020_constrained.tif")}
    lga = um.read("lagos_land.tif")
    wc = um.read("worldcover_2021.tif")
    low = um.read("low_ground_10m.tif") == 1
    water = wc == 80
    water_d = ndimage.distance_transform_edt(~water) * 60.0
    out = {"note": "Built-up gap in degrees C, population-weighted, WorldCover built-up cells only. Buffer removes within-group cells within "
                   "that distance of vegetation (0 removes vegetated cells only). Same heat median (kept passes) throughout.",
           "grid": {}, "lga": {}, "low_ground": {}, "water": {}}
    for cut, fname in CUTOFFS:
        d = um.read(fname); d[d < 0] = np.nan
        base = um.baseline()
        for pname, pop in pops.items():
            for buf in BUFFERS:
                g, wpop, bpop = gap_for(pop, suhi, count, base, d, buf)
                out["grid"][f"ndvi{cut}|buffer{buf}|{pname}"] = {"bu_gap_c": round(g, 3), "within_pop": round(wpop), "beyond_pop": round(bpop)}
        print(cut, {k: v["bu_gap_c"] for k, v in out["grid"].items() if k.startswith(f"ndvi{cut}") and "unconstrained" in k}, flush=True)

    # within-LGA gaps (baseline NDVI 0.4, unconstrained population, vegetated cells excluded)
    d = um.read("veg_distance_m.tif"); d[d < 0] = np.nan
    base = um.baseline()
    pop = pops["unconstrained"]
    gaps, weights = [], []
    for g_id in sorted({int(v) for v in np.unique(lga) if v > 0}):
        b2 = dict(base); b2["inside"] = base["inside"] & (lga == g_id)
        b2["beyond"] = base["beyond"] & (lga == g_id)
        gg, w, bb = gap_for(pop, suhi, count, b2, d, 0)
        out["lga"][str(g_id)] = {"bu_gap_c": round(gg, 3), "within_pop": round(w), "beyond_pop": round(bb)}
        if np.isfinite(gg) and w > 50000 and bb > 50000:
            gaps.append(gg); weights.append(min(w, bb))
    out["lga_summary"] = {"n": len(gaps), "min": round(min(gaps), 3), "max": round(max(gaps), 3),
                          "weighted_mean": round(float(np.average(gaps, weights=weights)), 3)}

    # low ground versus higher ground (vegetated cells excluded)
    for lab, m in {"low_ground_below_10m": low, "higher_ground": ~low}.items():
        b2 = dict(base); b2["inside"] = base["inside"] & m; b2["beyond"] = base["beyond"] & m
        gg, w, bb = gap_for(pop, suhi, count, b2, d, 0)
        out["low_ground"][lab] = {"bu_gap_c": round(gg, 3), "within_pop": round(w), "beyond_pop": round(bb)}

    # distance to permanent water (vegetated cells excluded)
    for lab, m in {"water_within_500m": water_d <= 500, "water_beyond_500m": water_d > 500}.items():
        b2 = dict(base); b2["inside"] = base["inside"] & m; b2["beyond"] = base["beyond"] & m
        gg, w, bb = gap_for(pop, suhi, count, b2, d, 0)
        out["water"][lab] = {"bu_gap_c": round(gg, 3), "within_pop": round(w), "beyond_pop": round(bb)}

    (ROOT / "docs" / "data" / "gap_specifications.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print("lga", out["lga_summary"]); print("low", {k: v["bu_gap_c"] for k, v in out["low_ground"].items()}); print("water", {k: v["bu_gap_c"] for k, v in out["water"].items()})


if __name__ == "__main__":
    main()
