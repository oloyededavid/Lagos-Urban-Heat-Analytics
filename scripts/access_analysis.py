"""Green space access and low-ground exposure, on the 60 m research grid (EPSG:32631).

Writes docs/data/access.json (every number on the access maps), research/rasters/veg_distance_m.tif
(distance to the nearest vegetated cell) and research/rasters/low_ground_10m.tif (low-ground mask), both
used by render_maps.py.

Definitions (stated on the page):
  - Vegetated cell: 2020-2025 dry-season median NDVI at or above VEG_NDVI (0.4 by default; 0.3 and 0.5 are
    reported as sensitivity checks).
  - Access: a resident has green-space access if a vegetated cell lies within ACCESS_M metres (300 m, about 3.6
    minutes on foot at 5 km/h). This is a proxy, not a measured walking network.
  - Low ground: cells below LOW_M metres of elevation from the Copernicus DEM GLO-30. This is an elevation
    proxy for flood-prone ground. It is not a flood map and does not use drainage.
  - Population: WorldPop 2020, a modelled estimate, not a census count.

    python scripts/access_analysis.py
"""
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
RAS = ROOT / "research" / "rasters"
OUT = ROOT / "docs" / "data" / "access.json"
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token/"
VEG_NDVI = 0.4
SENSITIVITY = (0.3, 0.4, 0.5)
ACCESS_M = 300.0
LOW_M = 10.0
CELL_M = 60.0


def read(name):
    with rasterio.open(RAS / name) as s:
        a = s.read(1).astype("float64")
        nd = s.nodata
        if nd is not None and not np.isnan(nd):
            a[a == nd] = np.nan
        return a, s.transform, s.crs, s.bounds


def dem_on_grid(shape, transform, crs, bounds):
    """Copernicus DEM GLO-30 (Planetary Computer, anonymous SAS), resampled onto the research grid."""
    import json as _json
    import urllib.request
    from rasterio.warp import transform_bounds

    west, south, east, north = transform_bounds(crs, "EPSG:4326", *bounds)
    pad = 0.05
    bbox = [west - pad, south - pad, east + pad, north + pad]
    body = _json.dumps({"collections": ["cop-dem-glo-30"], "bbox": bbox, "limit": 100}).encode()
    req = urllib.request.Request(f"{STAC}/search", data=body, headers={"Content-Type": "application/json"})
    items = _json.load(urllib.request.urlopen(req, timeout=120))["features"]
    tok = _json.load(urllib.request.urlopen(SAS + "cop-dem-glo-30", timeout=60))["token"]
    dem = np.full(shape, np.nan, "float64")
    for it in items:
        href = it["assets"]["data"]["href"] + "?" + tok
        with rasterio.open(href) as src:
            tile = np.full(shape, np.nan, "float64")
            reproject(source=rasterio.band(src, 1), destination=tile, dst_transform=transform, dst_crs=crs,
                      resampling=Resampling.bilinear, src_nodata=src.nodata, dst_nodata=np.nan)
        dem = np.where(np.isnan(dem), tile, dem)
    return dem, len(items)


def main():
    ndvi, t, crs, bounds = read("2020-2025_ndvi_median.tif")
    pop, _, _, _ = read("population_2020.tif")
    land, _, _, _ = read("lagos_land.tif")
    shape = ndvi.shape
    inside = np.isfinite(ndvi) & (land > 0) if np.nanmax(land) > 0 else np.isfinite(ndvi)
    pop_ok = np.where(inside & np.isfinite(pop) & (pop > 0), pop, 0.0)
    total = float(pop_ok.sum())

    sens = {}
    for thr in SENSITIVITY:
        veg = inside & (ndvi >= thr)
        dist = ndimage.distance_transform_edt(~veg, sampling=CELL_M)
        beyond = inside & (dist > ACCESS_M)
        share = float(pop_ok[beyond].sum() / total) if total else float("nan")
        sens[f"{thr:.1f}"] = {"ndvi_threshold": thr, "population_beyond_300m_share": round(share, 4)}
        if abs(thr - VEG_NDVI) < 1e-9:
            main_dist = np.where(inside, dist, np.nan)
            main_share = share

    dem, n_tiles = dem_on_grid(shape, t, crs, bounds)
    low = inside & np.isfinite(dem) & (dem < LOW_M)
    pop_low = float(pop_ok[low].sum() / total) if total else float("nan")
    area_low = float(low.sum() / inside.sum()) if inside.sum() else float("nan")

    # surface heat on low versus other ground: cell medians, cells with at least 3 clear passes
    suhi, _, _, _ = read("2020-2025_suhi_median.tif")
    count = read("2020-2025_count.tif")[0]
    ok = inside & np.isfinite(dem) & np.isfinite(suhi) & (count >= 3)   # same usable-heat rule as extra_analysis.py
    a = suhi[ok & low]
    b = suhi[ok & ~low]
    diff_med = float(np.median(a) - np.median(b)) if a.size and b.size else float("nan")

    dist_path = RAS / "veg_distance_m.tif"
    prof = {"driver": "GTiff", "height": shape[0], "width": shape[1], "count": 1, "dtype": "float32",
            "crs": crs, "transform": t, "nodata": -9999.0}
    with rasterio.open(dist_path, "w", **prof) as d:
        d.write(np.where(np.isfinite(main_dist), main_dist, -9999.0).astype("float32"), 1)
    with rasterio.open(RAS / "low_ground_10m.tif", "w", **{**prof, "nodata": 255, "dtype": "uint8"}) as d:
        d.write(np.where(inside & np.isfinite(dem), low.astype("uint8"), 255).astype("uint8"), 1)

    out = {
        "script": "scripts/access_analysis.py",
        "grid_m": CELL_M,
        "veg_ndvi_threshold": VEG_NDVI,
        "access_m": ACCESS_M,
        "low_ground_m": LOW_M,
        "population_source": "WorldPop 2020 (modelled estimate)",
        "population_total": round(total),
        "population_beyond_300m_share": round(main_share, 4),
        "population_beyond_300m_ndvi_sensitivity": sens,
        "dem_tiles": n_tiles,
        "low_ground_area_share": round(area_low, 4),
        "low_ground_population_share": round(pop_low, 4),
        "heat_low_minus_other_median_c": round(diff_med, 3),
        "heat_cells_low": int(a.size),
        "heat_cells_other": int(b.size),
        "note": "Cell-level medians. No interval: grid cells are spatially dependent, so a bootstrap over cells would overstate precision. Descriptive only, not causal.",
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", OUT, "| beyond 300 m share", out["population_beyond_300m_share"], "| low-ground population share", out["low_ground_population_share"])


if __name__ == "__main__":
    main()
