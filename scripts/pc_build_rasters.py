"""Pixel-level dry-season rasters for Lagos, 2000-2025, from Landsat Collection 2 Level 2.

Data come from the Microsoft Planetary Computer STAC catalogue (open, no account; the same USGS
Collection 2 Level-2 products used by the Earth Engine scripts). For every dry-season pass (one orbit
on one date, its tiles mosaicked) the script:

  1. masks fill, cloud, dilated cloud, cirrus, cloud shadow, snow and water (QA_PIXEL) and surface
     temperature with uncertainty above 4 K (ST_QA);
  2. converts ST to land surface temperature in degrees C and SR bands to NDVI and NDBI;
  3. computes the heat island H = LST - mean LST of a fixed countryside reference in the SAME pass;
     the reference is land within 20 km of Lagos State that ESA WorldCover 2021 shows as tree,
     shrub, grass, cropland, herbaceous wetland or mangrove (not built-up, bare or water);
  4. applies the quality rules of scripts/extract_change_gee.py: at least 3,000 clear reference pixels
     at 90 m (6,750 at 60 m), at most 5% of Lagos built-up land (WorldCover class 50, tested in 180 m
     blocks) more than 3 C colder than the reference, and at least one LGA with half of its land clear.
     The published rule tested all Lagos land; that rejects clear passes because Lagos's swamp forests
     are genuinely cooler than the reference.

Kept passes are grouped into three sensor-aligned periods (2000-2012 Landsat 7, 2013-2019 Landsat 8,
2020-2025 Landsat 8 and 9). Landsat 7 passes after 2012 are kept separately for the Landsat 7 /
Landsat 8 overlap comparison and are not part of any period composite.

Grid: UTM zone 31N (EPSG:32631), 60 m. Landsat thermal bands are 60 m (TM/ETM+) or 100 m (TIRS)
native and are delivered resampled to 30 m; 60 m does not add detail the sensors do not have.

Outputs:
    research/rasters/<period>_{lst,suhi,ndvi,ndbi}_median.tif, <period>_{count,suhi_iqr}.tif
    research/rasters/worldcover_2021.tif, reference_mask.tif, lagos_land.tif
    research/pc_passes.csv     every pass examined, its checks, kept or not
    research/pc_lga_suhi.csv   heat island per LGA per kept pass, with clear fraction

    python scripts/pc_build_rasters.py [--seasons 2024] [--workers 6]
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds, transform_geom
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "research" / "rasters"
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token/"
CRS = "EPSG:32631"
RES = 60.0
BUFFER_M = 20000
FIRST, LAST = 2000, 2025
MAX_ST_QA_K = 4.0
REF_MIN_PIXELS = 6750           # 3,000 pixels at 90 m, expressed at 60 m
MAX_COLD_SHARE, COLD_C = 0.05, 3.0
LGA_MIN_CLEAR = 0.5
RURAL_CLASSES = [10, 20, 30, 40, 90, 95]   # WorldCover: tree, shrub, grass, cropland, herbaceous wetland, mangroves
PERIODS = [("2000-2012", 2000, 2012, {"landsat-7"}), ("2013-2019", 2013, 2019, {"landsat-8"}),
           ("2020-2025", 2020, 2025, {"landsat-8", "landsat-9"})]

_tokens: dict[str, tuple[str, float]] = {}


def token(collection: str) -> str:
    tok, exp = _tokens.get(collection, ("", 0))
    if time.time() > exp:
        tok = json.load(urllib.request.urlopen(SAS + collection, timeout=60))["token"]
        _tokens[collection] = (tok, time.time() + 40 * 60)
    return tok


def stac_search(body: dict) -> list[dict]:
    items, url, payload = [], f"{STAC}/search", body
    while url:
        req = urllib.request.Request(url, data=json.dumps(payload).encode() if payload else None,
                                     headers={"Content-Type": "application/json"})
        r = json.load(urllib.request.urlopen(req, timeout=120))
        items += r["features"]
        nxt = next((l for l in r.get("links", []) if l.get("rel") == "next"), None)
        url, payload = (nxt["href"], nxt.get("body")) if nxt else (None, None)
        if nxt and nxt.get("method", "GET") == "GET":
            payload = None
    return items


def season_of(dt: str) -> int:
    return int(dt[:4]) + (1 if dt[5:7] == "12" else 0)


# ---------------- grid and static layers ----------------
def build_grid(lgas):
    shapes = [transform_geom("EPSG:4326", CRS, f["geometry"]) for f in lgas["features"]]
    xs = [x for s in shapes for ring in s["coordinates"] for x, _ in ring]
    ys = [y for s in shapes for ring in s["coordinates"] for _, y in ring]
    x0, x1 = min(xs) - BUFFER_M, max(xs) + BUFFER_M
    y0, y1 = min(ys) - BUFFER_M, max(ys) + BUFFER_M
    w, h = math.ceil((x1 - x0) / RES), math.ceil((y1 - y0) / RES)
    return {"transform": from_origin(x0, y1, RES, RES), "width": w, "height": h, "crs": CRS,
            "shapes": shapes, "bounds": (x0, y0, x0 + w * RES, y1)}


def to_grid(href: str, grid, resampling, dtype="float32", nodata=None, scale_factor=2):
    """Read the part of a COG that covers the grid (decimated by scale_factor) and warp it onto the grid."""
    dst = np.full((grid["height"], grid["width"]), np.nan if dtype == "float32" else 0, dtype=dtype)
    with rasterio.Env(GDAL_HTTP_MAX_RETRY=4, GDAL_HTTP_RETRY_DELAY=2, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF"):
        with rasterio.open(href) as src:
            b = transform_bounds(grid["crs"], src.crs, *grid["bounds"])
            win = from_bounds(*b, src.transform).intersection(rasterio.windows.Window(0, 0, src.width, src.height))
            win = win.round_offsets().round_lengths()
            oh, ow = max(1, int(win.height // scale_factor)), max(1, int(win.width // scale_factor))
            arr = src.read(1, window=win, out_shape=(oh, ow), resampling=Resampling.nearest)
            t = src.window_transform(win) * rasterio.Affine.scale(win.width / ow, win.height / oh)
            src_nodata = src.nodata if nodata is None else nodata
            reproject(arr, dst, src_transform=t, src_crs=src.crs, dst_transform=grid["transform"], dst_crs=grid["crs"],
                      resampling=resampling, src_nodata=src_nodata, dst_nodata=np.nan if dtype == "float32" else 0)
    return dst


def worldcover(grid):
    lon_b = transform_bounds(CRS, "EPSG:4326", *grid["bounds"])
    items = stac_search({"collections": ["esa-worldcover"], "bbox": list(lon_b), "datetime": "2021-01-01/2021-12-31"})
    out = np.zeros((grid["height"], grid["width"]), dtype="uint8")
    for it in items:
        part = to_grid(it["assets"]["map"]["href"] + "?" + token("esa-worldcover"), grid, Resampling.mode,
                       dtype="uint8", nodata=0, scale_factor=6)
        out = np.where(out == 0, part, out)
    return out


# ---------------- per pass ----------------
def bands_for(platform):
    return ("lwir" if platform == "landsat-7" else "lwir11"), "qa"


def read_pass(items, grid, lagos_land, ref_mask, lga_ids, n_lga, built=None):
    """Mosaic the tiles of one pass and compute its layers and checks."""
    lst = np.full((grid["height"], grid["width"]), np.nan, "float32")
    ndvi, ndbi = lst.copy(), lst.copy()
    tok = token("landsat-c2-l2")
    for it in sorted(items, key=lambda i: i["properties"].get("eo:cloud_cover", 100)):
        a = it["assets"]
        st_key, stqa_key = bands_for(it["properties"]["platform"])
        h = lambda k: a[k]["href"] + "?" + tok
        qa = to_grid(h("qa_pixel"), grid, Resampling.nearest, dtype="uint16", nodata=1)
        bad = (qa == 0) | ((qa & 0b10111111) != 0) | ((qa & (1 << 7)) != 0)   # fill, dilated cloud, cirrus, cloud, shadow, snow; water
        clear = (qa != 0) & ~bad & ((qa & (1 << 6)) != 0)                     # bit 6: clear
        st = to_grid(h(st_key), grid, Resampling.bilinear, nodata=0)
        stqa = to_grid(h(stqa_key), grid, Resampling.bilinear, nodata=-9999)
        ok = clear & np.isfinite(st) & (st > 0) & np.isfinite(stqa) & (stqa * 0.01 <= MAX_ST_QA_K) & np.isnan(lst)
        lst[ok] = st[ok] * 0.00341802 + 149.0 - 273.15
        red = to_grid(h("red"), grid, Resampling.bilinear, nodata=0) * 0.0000275 - 0.2
        nir = to_grid(h("nir08"), grid, Resampling.bilinear, nodata=0) * 0.0000275 - 0.2
        sw = to_grid(h("swir16"), grid, Resampling.bilinear, nodata=0) * 0.0000275 - 0.2
        with np.errstate(invalid="ignore", divide="ignore"):
            ndvi[ok] = ((nir - red) / (nir + red))[ok]
            ndbi[ok] = ((sw - nir) / (sw + nir))[ok]
    ref = lst[ref_mask & np.isfinite(lst)]
    info = {"ref_pixels": int(ref.size), "ref_lst": float(np.mean(ref)) if ref.size else None}
    land_clear = lagos_land & np.isfinite(lst)
    info["lagos_clear_share"] = float(land_clear.sum() / lagos_land.sum())
    if not ref.size:
        return info, None
    suhi = lst - info["ref_lst"]
    # Cloud/fog check at 180 m (3 x 3 blocks), as in the Earth Engine method (QC_SCALE), but on built-up land only
    # (WorldCover class 50). Lagos's own swamp forests are genuinely more than 3 C cooler than a countryside
    # reference that includes grassland, so testing all land rejected clear passes; cloud or fog the mask missed
    # cools built-up surfaces too, which a clear morning does not.
    test = lagos_land if built is None else (lagos_land & built)
    hh, ww = (suhi.shape[0] // 3) * 3, (suhi.shape[1] // 3) * 3
    blk = lambda a: a[:hh, :ww].reshape(hh // 3, 3, ww // 3, 3)
    with np.errstate(invalid="ignore"), __import__("warnings").catch_warnings():
        __import__("warnings").simplefilter("ignore", RuntimeWarning)
        land_frac = blk(test.astype("float32")).mean(axis=(1, 3))
        s_blk = np.nanmean(np.where(blk(land_clear & test), blk(suhi), np.nan), axis=(1, 3))
    use = (land_frac >= 0.5) & np.isfinite(s_blk)
    cold = (s_blk[use] < -COLD_C).mean() if use.any() else None
    info["cold_share"] = None if cold is None else float(cold)
    # per-LGA clear fraction and mean heat island
    clear_n = np.bincount(lga_ids[land_clear], minlength=n_lga + 1)
    all_n = np.bincount(lga_ids[lagos_land], minlength=n_lga + 1)
    sums = np.bincount(lga_ids[land_clear], weights=suhi[land_clear], minlength=n_lga + 1)
    frac = np.divide(clear_n, all_n, out=np.zeros(n_lga + 1), where=all_n > 0)
    info["lga"] = [(i, float(frac[i]), float(sums[i] / clear_n[i]) if clear_n[i] else None) for i in range(1, n_lga + 1)]
    return info, {"lst": lst, "suhi": suhi.astype("float32"), "ndvi": ndvi, "ndbi": ndbi}


def verdict(info):
    if info["ref_pixels"] < REF_MIN_PIXELS:
        return "reference mostly cloudy"
    if info.get("cold_share") is None or info["cold_share"] > MAX_COLD_SHARE:
        return "cold anomaly (cloud or fog)"
    if not any(f >= LGA_MIN_CLEAR for _, f, _ in info["lga"]):
        return "no LGA at least half clear"
    return ""


def write_tif(path, arr, grid, dtype="float32", nodata=np.nan):
    with rasterio.open(path, "w", driver="GTiff", height=grid["height"], width=grid["width"], count=1, dtype=dtype,
                       crs=grid["crs"], transform=grid["transform"], nodata=nodata, compress="deflate", predictor=2 if dtype != "float32" else 3,
                       tiled=True, blockxsize=256, blockysize=256) as dst:
        dst.write(arr.astype(dtype), 1)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seasons", help="comma-separated subset, e.g. 2024")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args(argv)
    OUT.mkdir(parents=True, exist_ok=True)
    lgas = json.loads((ROOT / "docs" / "data" / "lagos_uhi_processed.geojson").read_text())
    names = [f["properties"]["lga_name"] for f in lgas["features"]]
    grid = build_grid(lgas)
    lga_ids = rasterize(((s, i + 1) for i, s in enumerate(grid["shapes"])), out_shape=(grid["height"], grid["width"]),
                        transform=grid["transform"], fill=0, dtype="uint8")
    print(f"grid {grid['width']} x {grid['height']} at {RES} m", flush=True)
    wc_path = OUT / "worldcover_2021.tif"
    if wc_path.exists():
        with rasterio.open(wc_path) as s:
            wc = s.read(1)
    else:
        wc = worldcover(grid)
        write_tif(wc_path, wc, grid, dtype="uint8", nodata=0)
    lagos_land = (lga_ids > 0) & (wc != 80) & (wc != 0)
    # reference: rural land cover within 20 km of the state (inside it too), as in the Earth Engine method
    from scipy.ndimage import distance_transform_edt
    dist = distance_transform_edt(lga_ids == 0) * RES
    ref_mask = (dist <= BUFFER_M) & np.isin(wc, RURAL_CLASSES)
    write_tif(OUT / "reference_mask.tif", ref_mask, grid, dtype="uint8", nodata=0)
    write_tif(OUT / "lagos_land.tif", lga_ids * lagos_land, grid, dtype="uint8", nodata=0)

    seasons = [int(s) for s in args.seasons.split(",")] if args.seasons else list(range(FIRST, LAST + 1))
    lon_b = transform_bounds(CRS, "EPSG:4326", *grid["bounds"])
    items = []
    for s in seasons:
        items += stac_search({"collections": ["landsat-c2-l2"], "bbox": list(lon_b), "datetime": f"{s - 1}-12-01/{s}-03-31",
                              "query": {"eo:cloud_cover": {"lt": 70}, "platform": {"in": ["landsat-7", "landsat-8", "landsat-9"]}}, "limit": 200})
    passes = defaultdict(list)
    for it in items:
        p = it["properties"]
        passes[(p["datetime"][:10], p["landsat:wrs_path"], p["platform"])].append(it)
    print(f"{len(items)} scene tiles in {len(passes)} passes", flush=True)

    rows, lga_rows = [], []
    stacks = defaultdict(lambda: defaultdict(list))

    def work(key):
        try:
            return key, *read_pass(passes[key], grid, lagos_land, ref_mask, lga_ids, len(names), built=(wc == 50))
        except Exception as e:  # network or file errors: record and continue
            return key, {"error": str(e)[:200]}, None

    with ThreadPoolExecutor(args.workers) as ex:
        for n, (key, info, layers) in enumerate(ex.map(work, sorted(passes)), 1):
            date, path, platform = key
            s = season_of(date)
            reason = info.get("error") and "read error" or verdict(info)
            group = next((lab for lab, a, b, pl in PERIODS if a <= s <= b and platform in pl), "overlap" if platform == "landsat-7" else None)
            t0 = passes[key][0]["properties"]["datetime"]
            rows.append({"pass_id": f"{platform}_{path}_{date}", "date": date, "time_utc": t0[11:19], "season": s, "platform": platform,
                         "wrs_path": path, "tiles": len(passes[key]), "ref_pixels": info.get("ref_pixels"),
                         "ref_lst": None if info.get("ref_lst") is None else round(info["ref_lst"], 2),
                         "lagos_clear_share": None if info.get("lagos_clear_share") is None else round(info["lagos_clear_share"], 3),
                         "cold_share": None if info.get("cold_share") is None else round(info["cold_share"], 4),
                         "group": group or "", "used": "yes" if not reason and group else "no", "reason": reason or ("" if group else "outside periods")})
            if not reason and layers is not None:
                for i, frac, h in info["lga"]:
                    if frac >= LGA_MIN_CLEAR and h is not None:
                        lga_rows.append({"pass_id": rows[-1]["pass_id"], "date": date, "season": s, "platform": platform, "group": group,
                                         "lga_name": names[i - 1], "clear_fraction": round(frac, 3), "suhi": round(h, 3)})
                if group and group != "overlap":
                    for k, v in layers.items():
                        stacks[group][k].append(v.astype("float16"))
            print(f"[{n}/{len(passes)}] {key} {reason or 'kept'}", flush=True)

    for name, data in (("pc_passes.csv", rows), ("pc_lga_suhi.csv", lga_rows)):
        path = ROOT / "research" / name
        if data:
            with open(path, "w", newline="") as fh:
                w = csv.DictWriter(fh, fieldnames=list(data[0]))
                w.writeheader(); w.writerows(sorted(data, key=lambda r: (r["date"], r["pass_id"])))

    summary = {}
    for lab, *_ in PERIODS:
        st = stacks.get(lab)
        if not st:
            continue
        for k in ("lst", "suhi", "ndvi", "ndbi"):
            cube = np.stack([a.astype("float32") for a in st[k]])
            write_tif(OUT / f"{lab}_{k}_median.tif", np.nanmedian(cube, axis=0), grid)
            if k == "suhi":
                n = np.isfinite(cube).sum(axis=0)
                write_tif(OUT / f"{lab}_count.tif", n, grid, dtype="uint16", nodata=0)
                q75, q25 = np.nanpercentile(cube, 75, axis=0), np.nanpercentile(cube, 25, axis=0)
                write_tif(OUT / f"{lab}_suhi_iqr.tif", np.where(n >= 3, q75 - q25, np.nan), grid)
            del cube
        summary[lab] = len(st["suhi"])
    meta = {"script": "scripts/pc_build_rasters.py", "source": "Microsoft Planetary Computer, landsat-c2-l2, esa-worldcover (2021)",
            "crs": CRS, "resolution_m": RES, "bounds": grid["bounds"], "periods": {lab: {"passes": summary.get(lab, 0), "sensors": sorted(pl)}
                                                                                     for lab, a, b, pl in PERIODS},
            "rules": {"max_st_qa_k": MAX_ST_QA_K, "ref_min_pixels_60m": REF_MIN_PIXELS, "max_cold_share": MAX_COLD_SHARE,
                      "cold_c": COLD_C, "lga_min_clear": LGA_MIN_CLEAR, "reference": f"WorldCover 2021 classes {RURAL_CLASSES} within {BUFFER_M} m"},
            "built_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta["periods"]), flush=True)


if __name__ == "__main__":
    main()
