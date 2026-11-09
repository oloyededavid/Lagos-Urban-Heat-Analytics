"""Population, land cover, access and low-ground analysis on the 60 m research grid (EPSG:32631).

Reads research rasters and docs/data/lagos_uhi_processed.geojson (LGA boundaries), writes
docs/data/extra_analysis.json (every number on the extra maps and tables) and the access
sensitivity rasters research/rasters/veg_distance_{0.3,0.5}_m.tif.

Heat classes use the 2020-2025 dry-season median heat island (SUHI, °C vs countryside) on cells with
at least 3 clear passes. Population is WorldPop 2020 (modelled). Associations only; not causes.

    python scripts/extra_analysis.py
"""
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from scipy import ndimage
from rasterio.crs import CRS
from rasterio.warp import transform_geom
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
RAS = ROOT / "research" / "rasters"
DATA = ROOT / "docs" / "data"
WC_NAMES = {10: "Tree cover", 20: "Shrubland", 30: "Grassland", 40: "Cropland", 50: "Built-up",
            60: "Bare / sparse", 70: "Snow and ice", 80: "Permanent water", 90: "Herbaceous wetland", 95: "Mangroves", 100: "Moss and lichen"}
CELL_M = 60.0
ACCESS_M = 300.0
LOW_M = 10.0
HOT_C = 4.0


def read(name):
    with rasterio.open(RAS / name) as s:
        a = s.read(1).astype("float64")
        t, crs, nd = s.transform, s.crs, s.nodata
    if nd is not None and not np.isnan(nd):
        a[a == nd] = np.nan
    return a, t, crs


def wpct(mask, pop):
    tot = pop.sum()
    return float(pop[mask].sum() / tot) if tot else float("nan")


def main():
    ndvi, t, crs = read("2020-2025_ndvi_median.tif")
    grid_t, grid_crs = t, crs
    suhi, _, _ = read("2020-2025_suhi_median.tif")
    count, _, _ = read("2020-2025_count.tif")
    pop, _, _ = read("population_2020.tif")
    land, _, _ = read("lagos_land.tif")
    wc, _, _ = read("worldcover_2021.tif")
    low = read("low_ground_10m.tif")[0] == 1
    veg_d = read("veg_distance_m.tif")[0]
    veg_d[veg_d < 0] = np.nan
    inside = (land > 0) & np.isfinite(ndvi)
    ok = inside & np.isfinite(suhi) & (count >= 3)          # cells with a usable heat value
    pop_ok = np.where(inside & np.isfinite(pop) & (pop > 0), pop, 0.0)
    total = float(pop_ok.sum())
    pop_heat = np.where(ok, pop_ok, 0.0)                    # population on cells with a heat value
    beyond = inside & (np.nan_to_num(veg_d, nan=-1) > ACCESS_M)

    out = {"script": "scripts/extra_analysis.py", "grid_m": CELL_M, "access_m": ACCESS_M,
           "low_ground_m": LOW_M, "hot_threshold_c": HOT_C, "population_total": round(total),
           "population_with_heat_value_share": round(float(pop_heat.sum() / total), 4)}

    # 1. population by access class and heat class
    cls = {"within_300m": inside & ~beyond, "beyond_300m": beyond}
    out["access_heat"] = {}
    for k, m in cls.items():
        mm = m & ok
        p = pop_ok[mm]
        out["access_heat"][k] = {
            "population_share_of_total": round(float(pop_ok[m].sum() / total), 4),
            "pop_weighted_mean_suhi_c": round(float(np.sum(p * suhi[mm]) / p.sum()), 2) if p.sum() else None,
            "population_in_hot_cells_share": round(float(pop_ok[mm & (suhi >= HOT_C)].sum() / pop_ok[m].sum()), 4) if pop_ok[m].sum() else None,
        }
    gap = beyond & ok & (suhi >= HOT_C)
    out["gap_beyond_300m_and_hot"] = {"population": round(float(pop_ok[gap].sum())),
                                      "share_of_total": round(float(pop_ok[gap].sum() / total), 4),
                                      "cells": int(gap.sum())}

    # 2. sensitivity of the hot threshold
    out["hot_threshold_sensitivity"] = {f"{th:g}": round(float(pop_ok[ok & (suhi >= th)].sum() / pop_heat.sum()), 4) for th in (2, 3, 4, 5)}

    # 3. low ground versus higher ground (population-weighted)
    out["low_ground"] = {}
    for k, m in {"below_10m": inside & low, "10m_and_above": inside & ~low}.items():
        mm = m & ok
        p = pop_ok[mm]
        out["low_ground"][k] = {
            "area_share": round(float(m.sum() / inside.sum()), 4),
            "population_share_of_total": round(float(pop_ok[m].sum() / total), 4),
            "pop_weighted_mean_suhi_c": round(float(np.sum(p * suhi[mm]) / p.sum()), 2) if p.sum() else None,
            "population_beyond_300m_share": round(float(pop_ok[m & beyond].sum() / pop_ok[m].sum()), 4) if pop_ok[m].sum() else None,
        }

    # 4. land cover: area, population and heat by WorldCover class
    out["landcover"] = {}
    for c, name in WC_NAMES.items():
        m = inside & (wc == c)
        if not m.any():
            continue
        mm = m & ok
        p = pop_ok[mm]
        out["landcover"][str(c)] = {
            "name": name,
            "area_share": round(float(m.sum() / inside.sum()), 4),
            "population_share": round(float(pop_ok[m].sum() / total), 4),
            "median_suhi_c": round(float(np.median(suhi[mm])), 2) if mm.any() else None,
            "share_cells_hot": round(float((suhi[mm] >= HOT_C).mean()), 4) if mm.any() else None,
            "pop_weighted_mean_suhi_c": round(float(np.sum(p * suhi[mm]) / p.sum()), 2) if p.sum() else None,
        }

    # 5. green access quintiles: population-weighted heat along the access gradient
    d = np.where(inside & np.isfinite(veg_d), veg_d, np.nan)
    bins = [0, 60, 120, 180, 300, 600, 1e9]
    labels = ["0-60 m", "60-120 m", "120-180 m", "180-300 m", "300-600 m", "600 m and more"]
    out["distance_bands"] = {}
    for lo, hi, lab in zip(bins[:-1], bins[1:], labels):
        m = inside & (d >= 0) & (d <= hi) if lo == 0 else inside & (d > lo) & (d <= hi)   # first band includes vegetated cells (distance 0)
        mm = m & ok
        p = pop_ok[mm]
        out["distance_bands"][lab] = {
            "population_share": round(float(pop_ok[m].sum() / total), 4),
            "pop_weighted_mean_suhi_c": round(float(np.sum(p * suhi[mm]) / p.sum()), 2) if p.sum() else None,
        }

    # 6. LGA level: population beyond 300 m, low ground and heat
    gj = json.loads((DATA / "lagos_uhi_processed.geojson").read_text())
    out["lga"] = {}
    for f in gj["features"]:
        name = f["properties"]["lga_name"]
        g = shape(f["geometry"])
        # rasterise the LGA on the research grid (transform from the rasters)
        geom = transform_geom(CRS.from_epsg(4326), grid_crs, g.__geo_interface__)
        mask = geometry_mask([geom], out_shape=inside.shape, transform=grid_t, invert=True, all_touched=False)
        m = mask & inside
        if not m.any() or pop_ok[m].sum() == 0:
            continue
        mm = m & ok
        p = pop_ok[mm]
        out["lga"][name] = {
            "population": round(float(pop_ok[m].sum())),
            "population_beyond_300m_share": round(float(pop_ok[m & beyond].sum() / pop_ok[m].sum()), 4),
            "population_low_ground_share": round(float(pop_ok[m & low].sum() / pop_ok[m].sum()), 4),
            "pop_weighted_mean_suhi_c": round(float(np.sum(p * suhi[mm]) / p.sum()), 2) if p.sum() else None,
            "population_in_hot_cells_share": round(float(pop_ok[mm & (suhi >= HOT_C)].sum() / pop_ok[m].sum()), 4),
        }

    prof = {"driver": "GTiff", "height": inside.shape[0], "width": inside.shape[1], "count": 1, "dtype": "float32",
            "crs": crs, "transform": t, "nodata": -9999.0}
    # 7. access sensitivity rasters at NDVI 0.3 and 0.5 (distance to vegetation)
    for thr in (0.3, 0.5):
        veg = inside & (ndvi >= thr)
        dist = ndimage.distance_transform_edt(~veg, sampling=CELL_M)
        with rasterio.open(RAS / f"veg_distance_{thr:g}_m.tif", "w", **prof) as dst:
            dst.write(np.where(inside, dist, -9999.0).astype("float32"), 1)
        out.setdefault("access_sensitivity_rasters", []).append(f"veg_distance_{thr:g}_m.tif")

    # class rasters used by render_maps.py: access x heat (0 within 300 m; 1 beyond, under 4 C; 2 beyond, 4 C or more),
    # and LGA index (0 = none; 1..n follows out["lga_order"])
    cls_arr = np.full(inside.shape, 255, "uint8")
    cls_arr[inside & ~beyond] = 0
    cls_arr[beyond & ok & (suhi < HOT_C)] = 1
    cls_arr[beyond & ok & (suhi >= HOT_C)] = 2
    cls_arr[beyond & ~ok] = 1
    prof8 = {**prof, "dtype": "uint8", "nodata": 255}
    with rasterio.open(RAS / "access_heat_class.tif", "w", **prof8) as dst:
        dst.write(cls_arr, 1)
    lga_arr = np.zeros(inside.shape, "uint8")
    order = [n for n in out["lga"]]
    for i, f in enumerate(gj["features"], start=1):
        name = f["properties"]["lga_name"]
        if name not in out["lga"]:
            continue
        geom = transform_geom(CRS.from_epsg(4326), crs, shape(f["geometry"]).__geo_interface__)
        mk = geometry_mask([geom], out_shape=inside.shape, transform=t, invert=True, all_touched=False)
        lga_arr[mk & inside] = order.index(name) + 1
    with rasterio.open(RAS / "lga_index.tif", "w", **prof8) as dst:
        dst.write(lga_arr, 1)
    out["lga_order"] = order

    (DATA / "extra_analysis.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", DATA / "extra_analysis.json", "| gap pop share", out["gap_beyond_300m_and_hot"]["share_of_total"])


if __name__ == "__main__":
    main()
