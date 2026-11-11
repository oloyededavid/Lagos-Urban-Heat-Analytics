"""Save every 2020-2025 Landsat 8/9 pass that has a countryside reference, kept or rejected, as per-pass
heat island rasters, so the period medians can be checked with leave-one-out and screening sensitivity.

Reuses the reading, masking and screening functions of scripts/pc_build_rasters.py. It writes only
research/rasters/passes/ and research/pass_stack.csv, and does not touch the period rasters or pc_passes.csv.

    python scripts/pass_stack.py
"""
import csv
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_bounds

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import pc_build_rasters as pb  # noqa: E402

OUT = ROOT / "research" / "rasters" / "passes"
PERIOD_SEASONS = range(2020, 2026)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lgas = json.loads((ROOT / "docs" / "data" / "lagos_uhi_processed.geojson").read_text())
    names = [f["properties"]["lga_name"] for f in lgas["features"]]
    grid = pb.build_grid(lgas)
    lga_ids = rasterize(((s, i + 1) for i, s in enumerate(grid["shapes"])), out_shape=(grid["height"], grid["width"]),
                        transform=grid["transform"], fill=0, dtype="uint8")
    with rasterio.open(ROOT / "research" / "rasters" / "worldcover_2021.tif") as s:
        wc = s.read(1)
    lagos_land = (lga_ids > 0) & (wc != 80) & (wc != 0)
    from scipy.ndimage import distance_transform_edt
    dist = distance_transform_edt(lga_ids == 0) * pb.RES
    ref_mask = (dist <= pb.BUFFER_M) & np.isin(wc, pb.RURAL_CLASSES)

    lon_b = transform_bounds(pb.CRS, "EPSG:4326", *grid["bounds"])
    items = []
    for s in PERIOD_SEASONS:
        items += pb.stac_search({"collections": ["landsat-c2-l2"], "bbox": list(lon_b), "datetime": f"{s - 1}-12-01/{s}-03-31",
                                 "query": {"eo:cloud_cover": {"lt": 70}, "platform": {"in": ["landsat-8", "landsat-9"]}}, "limit": 200})
    passes = defaultdict(list)
    for it in items:
        p = it["properties"]
        passes[(p["datetime"][:10], p["landsat:wrs_path"], p["platform"])].append(it)
    print(f"{len(items)} tiles in {len(passes)} passes", flush=True)

    def work(key):
        try:
            return key, *pb.read_pass(passes[key], grid, lagos_land, ref_mask, lga_ids, len(names), built=(wc == 50))
        except Exception as e:  # keep going; record the error
            print(f"read error for {key}: {e!r}", file=sys.stderr, flush=True)
            return key, {"error": str(e)[:200]}, None

    rows = []
    with ThreadPoolExecutor(6) as ex:
        for n, (key, info, layers) in enumerate(ex.map(work, sorted(passes)), 1):
            date, path, platform = key
            reason = info.get("error") and "read error" or pb.verdict(info)
            pid = f"{platform}_{path}_{date}"
            if layers is not None:
                with rasterio.open(OUT / f"{pid}_suhi.tif", "w", driver="GTiff", height=grid["height"], width=grid["width"], count=1,
                                   dtype="float32", crs=grid["crs"], transform=grid["transform"], nodata=np.nan) as dst:
                    dst.write(layers["suhi"].astype("float32"), 1)
            rows.append({"pass_id": pid, "date": date, "platform": platform, "wrs_path": path,
                         "ref_pixels": info.get("ref_pixels"), "cold_share": info.get("cold_share"),
                         "verdict": reason or "kept", "saved": layers is not None})
            print(f"[{n}/{len(passes)}] {pid} {reason or 'kept'}", flush=True)
    with open(ROOT / "research" / "pass_stack.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(sorted(rows, key=lambda r: r["date"]))
    print("done", sum(r["saved"] for r in rows), "passes saved", flush=True)


if __name__ == "__main__":
    main()
