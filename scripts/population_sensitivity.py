"""Population sensitivity: WorldPop 2020 constrained (maxar_v1) and unconstrained population masked to built-up land.

The headline metrics are recomputed with each population layer and written to docs/data/sensitivity_population.json.
The constrained file must first be downloaded to research/rasters/raw/nga_ppp_2020_constrained.tif (the URL is in
CONSTRAINED; the server does not support HTTP range reads). Resampling is by sum, so people are conserved.

    python scripts/population_sensitivity.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import uhi_metrics as um  # noqa: E402
import pc_build_rasters as pb  # noqa: E402

CONSTRAINED = "https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/maxar_v1/NGA/nga_ppp_2020_constrained.tif"


def resample_sum(path, grid):
    dst = np.zeros((grid["height"], grid["width"]), "float32")
    with rasterio.open(path) as src:
            b = transform_bounds(grid["crs"], src.crs, *grid["bounds"])
            win = from_bounds(*b, src.transform).round_offsets().round_lengths().intersection(
                rasterio.windows.Window(0, 0, src.width, src.height))
            arr = src.read(1, window=win).astype("float32")
            nd = src.nodata
            if nd is not None:
                arr[arr == nd] = 0
            arr[arr < 0] = 0
            reproject(arr, dst, src_transform=src.window_transform(win), src_crs=src.crs, dst_transform=grid["transform"],
                      dst_crs=grid["crs"], resampling=Resampling.sum, src_nodata=None)
            print("source people in window:", round(float(arr.sum())), "| on grid:", round(float(dst.sum())), flush=True)
    return dst


def main():
    lgas = json.loads((ROOT / "docs" / "data" / "lagos_uhi_processed.geojson").read_text())
    grid = pb.build_grid(lgas)
    base = um.baseline()
    suhi = um.read("2020-2025_suhi_median.tif")
    count = um.read("2020-2025_count.tif")
    pop_unc = um.read("population_2020.tif")
    raw = ROOT / "research" / "rasters" / "raw" / "nga_ppp_2020_constrained.tif"   # downloaded from CONSTRAINED; the server has no range reads
    pop_con = resample_sum(str(raw), grid)
    pb.write_tif(um.RAS / "population_2020_constrained.tif", pop_con, grid)

    bu = base["wc"] == 50
    variants = {
        "unconstrained": pop_unc,
        "constrained": pop_con,
        "unconstrained_built_up_only": np.where(bu, np.nan_to_num(pop_unc), 0.0),
    }
    out = {"source": {"constrained": CONSTRAINED, "unconstrained": "WorldPop 2020 nga_ppp_2020 (scripts/pc_population.py)"},
           "variants": {}}
    for k, p in variants.items():
        r = um.headline(p, suhi, count, base)
        out["variants"][k] = {"total_population": round(float(np.nansum(p[base["inside"]]))), **r}
    out["note"] = ("Constrained layer restricts people to built-up areas using a settlement mask; unconstrained spreads them "
                   "across all cells. The built-up-only variant keeps the unconstrained totals on built-up cells.")
    (ROOT / "docs" / "data" / "sensitivity_population.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    for k, v in out["variants"].items():
        print(k, round(v["beyond_share"], 4), round(v["bu_gap_c"], 2), round(v["pooled_gap_c"], 2))


if __name__ == "__main__":
    main()
