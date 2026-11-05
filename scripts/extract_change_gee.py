"""Four decades of dry-season surface heat in Lagos (Google Earth Engine).

Measures the surface urban heat island (SUHI) of every Lagos State LGA in every usable
Landsat pass (the frames of one orbit on one day, mosaicked) of the dry season (December-March), 1985-2026:

    SUHI = mean land surface temperature of the LGA
           - mean temperature of a fixed rural reference, in the SAME scene

Differencing within a scene cancels most of the day's weather, haze and sensor
differences, so changes over time reflect the city rather than the year. Scenes in
which cloud or fog the cloud mask missed makes much of Lagos colder than the
countryside are rejected (a clear daytime scene almost never does this).

Outputs (docs/data/):
    lagos_change_scenes.csv   every pass considered, its quality checks, used or not
    lagos_change_lga.csv      SUHI per LGA per used pass
    lagos_ghsl.csv            GHSL built-up surface and population per LGA, 1975-2020
    maps/suhi_<period>.png    pixel-level SUHI map per period (median over scenes)
    change_meta.json          provenance, map bounds and colour scale

    pip install -r requirements-gee.txt
    earthengine authenticate
    python scripts/extract_change_gee.py --project YOUR-CLOUD-PROJECT
    python scripts/analyze_change.py
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import ee
import numpy as np

SCRIPT_VERSION = "1.0.0"
REPO_ROOT = Path(__file__).resolve().parents[1]
OUT = REPO_ROOT / "docs" / "data"

FIRST_SEASON, LAST_SEASON = 1985, 2026   # season Y = December Y-1 to March Y
SCALE = 90                               # metres; thermal bands are 60-120 m native
QC_SCALE = 180                           # coarser scale for the scene-level checks
REF_BUFFER_M = 20000                     # rural reference: within 20 km of Lagos State
REF_BUILT_MAX = 100                      # m2 GHSL 2020 built surface per 100 m cell (1%)
MAX_ST_UNCERTAINTY_K = 4.0               # Landsat ST_QA
REF_MIN_COVER = 0.0                      # no minimum share: partly cloudy passes still measure the countryside...
REF_MIN_PIXELS = 3000                    # ...as long as at least 3,000 reference pixels are clear (about 100 km2)
MAX_COLD_SHARE = 0.05                    # ...and at most 5% of Lagos land > 3 degC below it
COLD_C = 3.0
LGA_MIN_COVER = 0.5                      # an LGA counts in a scene if 50% of its land is clear

# Periods for the maps and the website. Each pools several dry seasons.
# Every season belongs to a period, and each period is one Landsat sensor generation, so
# sensor differences cannot masquerade as change within a period. Clear dry-season
# mornings over Lagos are rare, so the periods are wide enough to hold several each.
PERIODS = [
    ("1985-2003", list(range(1985, 2004)), 1995),   # Landsat 4/5, and Landsat 7 before its scan-line fault
    ("2004-2013", list(range(2004, 2014)), 2010),   # Landsat 7 after the fault
    ("2014-2026", list(range(2014, 2027)), 2020),   # Landsat 8/9; GHSL 2020 is the latest observed epoch
]
GHSL_YEARS = [1975, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020]
# Seasons per batch export of the per-pass table
ERAS = [(1985, 1999), (2000, 2007), (2008, 2013), (2014, 2018), (2019, 2021), (2022, 2023), (2024, 2026)]

# Map colours: blue below the reference, then the website's light-to-dark heat ramp.
MAP_STOPS = [(-2.0, (134, 182, 239)), (0.0, (241, 238, 230)), (2.0, (249, 160, 90)),
             (4.0, (242, 113, 28)), (6.0, (217, 80, 11)), (8.0, (169, 58, 8)), (10.0, (107, 36, 6))]


def tidy_name(name: str) -> str:
    return " ".join(str(name).replace("/ ", "/").replace(" /", "/").split())


def lagos_lgas() -> ee.FeatureCollection:
    return (ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level2")
            .filter(ee.Filter.eq("ADM0_NAME", "Nigeria"))
            .filter(ee.Filter.eq("ADM1_NAME", "Lagos")))


def land_mask() -> ee.Image:
    """Fixed land mask (JRC surface water occurrence < 50%): every scene averages the same land."""
    return ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").unmask(0).lt(50)


def ghsl(kind: str, year: int) -> ee.Image:
    cid = "JRC/GHSL/P2023A/GHS_BUILT_S" if kind == "built" else "JRC/GHSL/P2023A/GHS_POP"
    return ee.Image(f"{cid}/{year}").select("built_surface" if kind == "built" else "population_count")


def reference_mask(lagos: ee.Geometry):
    """Land within 20 km of Lagos State that GHSL shows as essentially unbuilt in 2020
    (and so in every earlier epoch). The same pixels are the reference in every scene."""
    region = lagos.buffer(REF_BUFFER_M, 500)
    rural = ghsl("built", 2020).unmask(0).lt(REF_BUILT_MAX)
    return rural.And(land_mask()).clip(region).rename("ref"), region


def _prep(image: ee.Image, newer: bool) -> ee.Image:
    qa = image.select("QA_PIXEL")
    clear = (qa.bitwiseAnd(1 << 1).eq(0)          # dilated cloud
             .And(qa.bitwiseAnd(1 << 3).eq(0))    # cloud
             .And(qa.bitwiseAnd(1 << 4).eq(0)))   # cloud shadow
    if newer:
        clear = clear.And(qa.bitwiseAnd(1 << 2).eq(0))  # cirrus
    st = image.select("ST_B10" if newer else "ST_B6").multiply(0.00341802).add(149.0).subtract(273.15)
    good = image.select("ST_QA").multiply(0.01).lte(MAX_ST_UNCERTAINTY_K)
    sr = image.select(["SR_B5", "SR_B4"] if newer else ["SR_B4", "SR_B3"]).multiply(0.0000275).add(-0.2)
    data = st.mask().gt(0).rename("fp")    # where the scene has data, cloudy or not
    out = (st.rename("lst").addBands(sr.normalizedDifference().rename("ndvi")).updateMask(clear.And(good))
           .addBands(data.selfMask()))
    pass_id = (ee.String(image.get("SPACECRAFT_ID")).replace("ANDSAT_", "").cat("_")
               .cat(ee.Number(image.get("WRS_PATH")).format("%03d")).cat("_")
               .cat(ee.Date(image.get("system:time_start")).format("YYYYMMdd")))
    return ee.Image(out.copyProperties(image, ["system:time_start", "SPACECRAFT_ID", "WRS_PATH"])).set("pass_id", pass_id)


def raw_collection(seasons, region) -> ee.ImageCollection:
    """Landsat scenes of the given dry seasons. From 2014 only Landsat 8/9 are used, so
    a season never mixes the drifting Landsat 7 orbit with the newer sensors."""
    out = None
    for season in seasons:
        start, end = f"{season - 1}-12-01", f"{season}-04-01"

        def col(cid, newer, start=start, end=end):
            return (ee.ImageCollection(cid).filterBounds(region).filterDate(start, end)
                    .filter(ee.Filter.lt("CLOUD_COVER", 70)).map(lambda i: _prep(i, newer)))

        c = (col("LANDSAT/LC08/C02/T1_L2", True).merge(col("LANDSAT/LC09/C02/T1_L2", True)) if season >= 2014
             else col("LANDSAT/LT04/C02/T1_L2", False).merge(col("LANDSAT/LT05/C02/T1_L2", False))
             .merge(col("LANDSAT/LE07/C02/T1_L2", False)))
        out = c if out is None else out.merge(c)
    return to_passes(out)


def to_passes(col: ee.ImageCollection) -> ee.ImageCollection:
    """Mosaic the frames (WRS rows) of one orbit on one day into a single pass, so city
    and countryside are always compared within the same overpass."""
    def mosaic(pid):
        part = col.filter(ee.Filter.eq("pass_id", pid))
        first = ee.Image(part.first())
        return (part.mosaic().set("pass_id", pid, "system:time_start", first.get("system:time_start"),
                                  "SPACECRAFT_ID", first.get("SPACECRAFT_ID"), "WRS_PATH", first.get("WRS_PATH"),
                                  "frames", part.size()))
    return ee.ImageCollection(col.aggregate_array("pass_id").distinct().map(mosaic))


def with_reference(col, ref_mask, ref_region):
    def add(img):
        r = img.select("lst").updateMask(ref_mask).reduceRegion(
            ee.Reducer.mean().combine(ee.Reducer.count(), sharedInputs=True), ref_region, QC_SCALE,
            maxPixels=1e10, tileScale=4)
        tot = img.select("fp").And(ref_mask).selfMask().reduceRegion(ee.Reducer.count(), ref_region, QC_SCALE,
                                                                     maxPixels=1e10, tileScale=4)
        return img.set("ref_lst", r.get("lst_mean"), "ref_n", r.get("lst_count"), "ref_in_fp", tot.get("fp"))
    return col.map(add).filter(ee.Filter.notNull(["ref_lst"]))


def add_suhi(img):
    return img.addBands(img.select("lst").subtract(ee.Number(img.get("ref_lst"))).rename("suhi").toFloat())


def _get(obj, tries=6):
    for k in range(tries):
        try:
            return obj.getInfo()
        except ee.EEException as exc:
            if k == tries - 1 or not any(s in str(exc) for s in ("Too many", "timed out", "Computation", "429", "503")):
                raise
            time.sleep(15 * (k + 1))


def _point():
    return ee.Geometry.Point([3.4, 6.5])   # placeholder geometry: table assets need one


def pass_table(seasons, lgas, lagos, ref_mask, ref_region) -> ee.FeatureCollection:
    """One row per LGA per pass (SUHI, LST, NDVI, clear pixels) plus one '__pass__' row
    per pass with its quality figures. Run as a batch export: it is too large to compute
    interactively."""
    land = land_mask()
    col = with_reference(raw_collection(seasons, ref_region), ref_mask, ref_region).map(add_suhi)
    reducer = ee.Reducer.mean().combine(ee.Reducer.count(), sharedInputs=True)

    def per_pass(img):
        cold = img.select("suhi").updateMask(land).lt(-COLD_C).reduceRegion(
            ee.Reducer.mean(), lagos, QC_SCALE, maxPixels=1e10, tileScale=4)
        info = ee.Dictionary({"pass_id": img.get("pass_id"), "t": img.get("system:time_start"),
                              "sat": img.get("SPACECRAFT_ID"), "path": img.get("WRS_PATH"),
                              "frames": img.get("frames"), "ref_lst": img.get("ref_lst"), "ref_n": img.get("ref_n"),
                              "ref_in_fp": img.get("ref_in_fp")})
        rows = (img.select(["suhi", "lst", "ndvi"]).updateMask(land).reduceRegions(lgas, reducer, SCALE, tileScale=4)
                .filter(ee.Filter.gt("suhi_count", 0))
                .map(lambda f: ee.Feature(_point(), info).set({"lga": f.get("ADM2_NAME"), "suhi": f.get("suhi_mean"),
                                                            "lst": f.get("lst_mean"), "ndvi": f.get("ndvi_mean"),
                                                            "n": f.get("suhi_count")})))
        head = ee.Feature(_point(), info).set({"lga": "__pass__", "cold": cold.get("suhi")})
        return rows.merge(ee.FeatureCollection([head]))

    return col.map(per_pass).flatten()


def period_image(ids, seasons, lagos, ref_mask, ref_region) -> ee.Image:
    col = with_reference(raw_collection(seasons, ref_region).filter(ee.Filter.inList("pass_id", ids)),
                         ref_mask, ref_region).map(add_suhi)
    return col.select("suhi").median().updateMask(land_mask()).clip(lagos).rename("suhi").toFloat()


def run_exports(tasks, label):
    """Start batch exports and wait for them; raise if any fails."""
    for t in tasks:
        t.start()
    ids = [t.id for t in tasks]
    print(f"  {label}: {len(ids)} export task(s) started", flush=True)
    last = {}
    while True:
        st = ee.data.getTaskStatus(ids)
        for x in st:
            if last.get(x["id"]) != x["state"]:
                last[x["id"]] = x["state"]
                print(f"    {x.get('description')}: {x['state']}", flush=True)
        if all(x["state"] in ("COMPLETED", "FAILED", "CANCELLED") for x in st):
            bad = [f"{x.get('description')}: {x.get('error_message')}" for x in st if x["state"] != "COMPLETED"]
            if bad:
                raise RuntimeError("export failed: " + "; ".join(bad))
            return
        time.sleep(30)


def _delete_if_exists(asset_id):
    try:
        ee.data.deleteAsset(asset_id)
    except ee.EEException:
        pass


def fetch_table(asset_id) -> list[dict]:
    fc = ee.FeatureCollection(asset_id)
    n = _get(fc.size())
    out = []
    for start in range(0, n, 2500):
        out += [f["properties"] for f in _get(ee.FeatureCollection(fc.toList(2500, start)))["features"]]
    return out


def grid_pixels(image, bounds, step) -> np.ndarray:
    w, s, e, n = bounds
    raw = ee.data.computePixels({
        "expression": image.unmask(-9999), "fileFormat": "NUMPY_NDARRAY",
        "grid": {"dimensions": {"width": int(round((e - w) / step)), "height": int(round((n - s) / step))},
                 "affineTransform": {"scaleX": step, "shearX": 0, "translateX": w,
                                     "shearY": 0, "scaleY": -step, "translateY": n},
                 "crsCode": "EPSG:4326"}})
    return np.asarray(raw["suhi"], dtype=float)


def colourise(arr):
    xs = np.array([s[0] for s in MAP_STOPS])
    rgba = np.zeros(arr.shape + (4,), dtype=np.uint8)
    v = np.clip(arr, xs[0], xs[-1])
    for c in range(3):
        rgba[..., c] = np.interp(v, xs, [s[1][c] for s in MAP_STOPS]).round().astype(np.uint8)
    rgba[..., 3] = np.where(arr <= -9000, 0, 255)
    return rgba


def sensor_label(sat: str) -> str:
    return {"LANDSAT_4": "Landsat 4", "LANDSAT_5": "Landsat 5", "LANDSAT_7": "Landsat 7",
            "LANDSAT_8": "Landsat 8", "LANDSAT_9": "Landsat 9"}.get(sat, sat)


def season_of(ms: int) -> tuple[int, str]:
    d = datetime.fromtimestamp(ms / 1000, timezone.utc)
    return (d.year + 1 if d.month == 12 else d.year), d.strftime("%Y-%m-%d")


def _r(v, d=2):
    return "" if v is None else round(float(v), d)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True, help="Google Cloud project registered for Earth Engine")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--seasons", help="comma-separated subset, for testing")
    ap.add_argument("--no-maps", action="store_true")
    ap.add_argument("--map-step", type=float, default=0.0008, help="map pixel size in degrees (about 90 m)")
    ap.add_argument("--asset-folder", help="Earth Engine folder for the batch exports (default projects/PROJECT/assets/lagos_uhi)")
    ap.add_argument("--reuse", action="store_true", help="reuse existing export assets instead of exporting again")
    ap.add_argument("--reuse-table", action="store_true", help="reuse the existing per-pass table but export the maps")
    args = ap.parse_args(argv)

    ee.Initialize(project=args.project)
    lgas = lagos_lgas()
    lagos = lgas.geometry()
    ref_mask, ref_region = reference_mask(lagos)
    land_counts = {tidy_name(f["properties"]["ADM2_NAME"]): f["properties"]["count"] for f in
                   _get(land_mask().selfMask().rename("c").reduceRegions(lgas, ee.Reducer.count(), SCALE,
                                                                         tileScale=4))["features"]}
    seasons = ([int(s) for s in args.seasons.split(",")] if args.seasons
               else list(range(FIRST_SEASON, LAST_SEASON + 1)))
    folder = args.asset_folder or f"projects/{args.project}/assets/lagos_uhi"
    try:
        ee.data.createFolder(folder)
    except ee.EEException:
        pass
    # The per-pass table is exported in eras: smaller batch jobs finish faster, and a
    # failure only costs one era. Each era is a separate table asset.
    eras = [[x for x in seasons if lo <= x <= hi] for lo, hi in ERAS]
    eras = [e for e in eras if e]
    table_ids = [f"{folder}/lagos_change_passes_{e[0]}_{e[-1]}" for e in eras]
    if not (args.reuse or args.reuse_table):
        tasks = []
        for e, tid in zip(eras, table_ids):
            _delete_if_exists(tid)
            tasks.append(ee.batch.Export.table.toAsset(pass_table(e, lgas, lagos, ref_mask, ref_region),
                                                       tid.rsplit("/", 1)[1], tid))
        run_exports(tasks, "per-pass tables")
    rows = [r for tid in table_ids for r in fetch_table(tid)]
    heads = {r["pass_id"]: r for r in rows if r["lga"] == "__pass__"}
    by_pass = {}
    for r in rows:
        if r["lga"] != "__pass__":
            by_pass.setdefault(r["pass_id"], []).append(r)
    print(f"  {len(heads)} passes, {len(rows) - len(heads)} LGA rows fetched", flush=True)

    used_ids, lga_rows, scene_rows = {}, [], []
    for pid, s in sorted(heads.items(), key=lambda kv: (kv[1]["t"], kv[0])):
        season, date = season_of(s["t"])
        cover = (s.get("ref_n") or 0) / max(1, s.get("ref_in_fp") or 0)
        cold = s.get("cold")
        reason = ("reference mostly cloudy" if cover < REF_MIN_COVER or (s.get("ref_n") or 0) < REF_MIN_PIXELS else
                  "cold anomaly (cloud or fog)" if cold is None or cold > MAX_COLD_SHARE else "")
        seen = []
        if not reason:
            for r in by_pass.get(pid, []):
                name = tidy_name(r["lga"])
                cov = (r.get("n") or 0) / land_counts[name]
                if cov >= LGA_MIN_COVER and r.get("suhi") is not None:
                    seen.append([name, pid, season, date, sensor_label(s["sat"]), _r(r["suhi"]), _r(r.get("lst")),
                                 _r(r.get("ndvi"), 4), _r(cov, 3)])
            if not seen:
                reason = "no LGA at least half clear"
        if not reason:
            used_ids.setdefault(season, []).append(pid)
            lga_rows += seen
        scene_rows.append([pid, date, season, sensor_label(s["sat"]), s.get("path"), s.get("frames"),
                           _r(s.get("ref_lst")), _r(cover, 3), _r(cold, 4), len(seen) if not reason else 0,
                           "yes" if not reason else "no", reason])

    args.out.mkdir(parents=True, exist_ok=True)
    with open(args.out / "lagos_change_scenes.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["pass_id", "date", "season", "sensor", "wrs_path", "frames", "ref_lst", "ref_cover",
                    "cold_share", "lgas_observed", "used", "reason"])
        w.writerows(scene_rows)
    with open(args.out / "lagos_change_lga.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["lga_name", "pass_id", "season", "date", "sensor", "suhi", "lst", "ndvi", "coverage"])
        w.writerows(sorted(lga_rows, key=lambda r: (r[0], r[3], r[1])))
    print(f"{sum(len(v) for v in used_ids.values())} of {len(scene_rows)} scenes used; {len(lga_rows)} LGA rows",
          flush=True)

    # GHSL built-up surface and population per LGA
    imgs = ee.Image.cat([ghsl("built", y).rename(f"b{y}") for y in GHSL_YEARS]
                        + [ghsl("pop", y).rename(f"p{y}") for y in GHSL_YEARS])
    sums = _get(imgs.reduceRegions(lgas, ee.Reducer.sum(), 100, tileScale=4))["features"]
    land_km2 = {tidy_name(f["properties"]["ADM2_NAME"]): f["properties"]["sum"] / 1e6 for f in
                _get(land_mask().multiply(ee.Image.pixelArea()).rename("a")
                     .reduceRegions(lgas, ee.Reducer.sum(), 30, tileScale=4))["features"]}
    with open(args.out / "lagos_ghsl.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["lga_name", "year", "built_km2", "built_share", "population", "land_km2"])
        for f in sorted(sums, key=lambda f: tidy_name(f["properties"]["ADM2_NAME"])):
            p, name = f["properties"], tidy_name(f["properties"]["ADM2_NAME"])
            for y in GHSL_YEARS:
                b = p[f"b{y}"] / 1e6
                w.writerow([name, y, _r(b, 3), _r(b / land_km2[name], 4), int(round(p[f"p{y}"])),
                            _r(land_km2[name], 2)])

    meta = {"script": "scripts/extract_change_gee.py", "script_version": SCRIPT_VERSION,
            "export_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "method": {"scale_m": SCALE, "reference_buffer_m": REF_BUFFER_M,
                       "reference_ghsl2020_built_max_m2_per_ha": REF_BUILT_MAX,
                       "max_st_uncertainty_k": MAX_ST_UNCERTAINTY_K, "ref_min_cover": REF_MIN_COVER,
                       "ref_min_pixels": REF_MIN_PIXELS, "unit": "pass (frames of one orbit on one day, mosaicked)",
                       "max_cold_share": MAX_COLD_SHARE, "cold_threshold_c": COLD_C,
                       "lga_min_cover": LGA_MIN_COVER},
            "periods": []}
    if not args.no_maps:
        b = _get(lagos.bounds(1).coordinates())[0]
        xs, ys, step = [c[0] for c in b], [c[1] for c in b], args.map_step
        bounds = [float(np.floor(min(xs) / step) * step), float(np.floor(min(ys) / step) * step),
                  float(np.ceil(max(xs) / step) * step), float(np.ceil(max(ys) / step) * step)]
        maps_dir = args.out / "maps"
        maps_dir.mkdir(exist_ok=True)
        meta["map"] = {"bounds": [[bounds[1], bounds[0]], [bounds[3], bounds[2]]], "pixel_deg": step,
                       "stops": [[v, "#%02x%02x%02x" % c] for v, c in MAP_STOPS]}
        from PIL import Image
        w, s_, e, n = bounds
        todo = []
        for label, ps, gy in PERIODS:
            ids = [i for x in ps for i in used_ids.get(x, [])]
            if ids and not args.reuse:
                aid = f"{folder}/suhi_{label.replace('-', '_')}"
                _delete_if_exists(aid)
                todo.append(ee.batch.Export.image.toAsset(
                    period_image(ids, ps, lagos, ref_mask, ref_region), f"suhi_{label.replace('-', '_')}", aid,
                    crs="EPSG:4326", crsTransform=[step, 0, w, 0, -step, n],
                    region=ee.Geometry.Rectangle([w, s_, e, n], None, False), maxPixels=1e9))
        if todo:
            run_exports(todo, "period maps")
        for label, ps, gy in PERIODS:
            ids = [i for x in ps for i in used_ids.get(x, [])]
            entry = {"label": label, "seasons": ps, "ghsl_year": gy, "n_scenes": len(ids)}
            if ids:
                arr = grid_pixels(ee.Image(f"{folder}/suhi_{label.replace('-', '_')}").select("suhi"), bounds, step)
                (Image.fromarray(colourise(arr), "RGBA").quantize(colors=96, method=Image.Quantize.FASTOCTREE)
                 .save(maps_dir / f"suhi_{label}.png", optimize=True))
                v = arr[arr > -9000]
                entry.update({"file": f"maps/suhi_{label}.png", "pixels_observed": int(v.size),
                              "pixel_median_c": _r(np.median(v)), "share_above_3c": _r((v > 3).mean(), 4),
                              "share_above_6c": _r((v > 6).mean(), 4)})
                print(f"  map {label}: {len(ids)} passes, median {np.median(v):.2f} degC", flush=True)
            meta["periods"].append(entry)
    (args.out / "change_meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
