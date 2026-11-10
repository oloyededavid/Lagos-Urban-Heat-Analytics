"""Headline metrics on the 60 m grid, with the same definitions as scripts/extra_analysis.py.

Used by the sensitivity checks (scripts/population_sensitivity.py, scripts/pass_sensitivity.py).
Vegetation, distance and land cover are fixed at their baseline values; only the heat median and the
population weights change between checks.
"""
import numpy as np
import rasterio
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAS = ROOT / "research" / "rasters"
ACCESS_M = 300.0
HOT_C = 4.0


def read(name):
    with rasterio.open(RAS / name) as s:
        a = s.read(1).astype("float64")
        nd = s.nodata
    if nd is not None and not np.isnan(nd):
        a[a == nd] = np.nan
    return a


def baseline():
    land = read("lagos_land.tif") > 0
    ndvi = read("2020-2025_ndvi_median.tif")
    veg_d = read("veg_distance_m.tif")
    veg_d[veg_d < 0] = np.nan
    wc = read("worldcover_2021.tif")
    inside = land & np.isfinite(ndvi)
    beyond = inside & (np.nan_to_num(veg_d, nan=-1) > ACCESS_M)
    return {"inside": inside, "beyond": beyond, "wc": wc}


def headline(pop, suhi, count, base):
    """pop: people per cell (float array); suhi: heat median; count: clear passes per cell."""
    inside, beyond, wc = base["inside"], base["beyond"], base["wc"]
    pop_ok = np.where(inside & np.isfinite(pop) & (pop > 0), pop, 0.0)
    total = pop_ok.sum()
    ok = inside & np.isfinite(suhi) & (count >= 3)
    hot = ok & (suhi >= HOT_C)

    def group(mask):
        m = mask & ok
        p = pop_ok[m]
        mean = float(np.sum(p * suhi[m]) / p.sum()) if p.sum() else float("nan")
        share_hot = float(pop_ok[mask & hot].sum() / pop_ok[mask].sum()) if pop_ok[mask].sum() else float("nan")
        return {"population": float(pop_ok[mask].sum()), "mean_c": mean, "hot_share": share_hot}

    bu = inside & (wc == 50)
    res = {
        "beyond_share": float(pop_ok[beyond].sum() / total),
        "all_within": group(inside & ~beyond),
        "all_beyond": group(inside & beyond),
        "bu_within": group(bu & ~beyond),
        "bu_beyond": group(bu & beyond),
    }
    res["pooled_gap_c"] = res["all_beyond"]["mean_c"] - res["all_within"]["mean_c"]
    res["bu_gap_c"] = res["bu_beyond"]["mean_c"] - res["bu_within"]["mean_c"]
    res["bu_share_of_beyond_pop"] = float(res["bu_beyond"]["population"] / res["all_beyond"]["population"])
    return res
