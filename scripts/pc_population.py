"""WorldPop 2020 population on the raster grid of scripts/pc_build_rasters.py.

Reads only the Lagos window of the WorldPop 2020 Nigeria 100 m population-per-pixel file (unconstrained,
not UN-adjusted, the product the Earth Engine export used as WorldPop/GP/100m/pop) and sums people onto
the 60 m UTM 31N grid, so totals are preserved. Writes research/rasters/population_2020.tif (people per
60 m cell).

    python scripts/pc_population.py [local copy of nga_ppp_2020.tif]
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[1]
URL = "https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/NGA/nga_ppp_2020.tif"


def main(path: str | None = None):
    import sys
    path = path or (sys.argv[1] if len(sys.argv) > 1 else "/vsicurl/" + URL)
    import importlib.util
    spec = importlib.util.spec_from_file_location("pcb", ROOT / "scripts" / "pc_build_rasters.py")
    pcb = importlib.util.module_from_spec(spec); spec.loader.exec_module(pcb)
    lgas = json.loads((ROOT / "docs" / "data" / "lagos_uhi_processed.geojson").read_text())
    grid = pcb.build_grid(lgas)
    dst = np.zeros((grid["height"], grid["width"]), "float32")
    with rasterio.Env(GDAL_HTTP_MAX_RETRY=4, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open(path) as src:
            b = transform_bounds(grid["crs"], src.crs, *grid["bounds"])
            # clip to the file: the grid's 20 km buffer reaches west of Nigeria, past the file's edge
            win = from_bounds(*b, src.transform).round_offsets().round_lengths().intersection(
                rasterio.windows.Window(0, 0, src.width, src.height))
            arr = src.read(1, window=win).astype("float32")
            arr[(arr == src.nodata) | (arr < 0)] = 0
            reproject(arr, dst, src_transform=src.window_transform(win), src_crs=src.crs, dst_transform=grid["transform"],
                      dst_crs=grid["crs"], resampling=Resampling.sum, src_nodata=None)
            print("source people in window:", round(float(arr.sum())), "| on grid:", round(float(dst.sum())))
    pcb.OUT.mkdir(parents=True, exist_ok=True)
    pcb.write_tif(pcb.OUT / "population_2020.tif", dst, grid)
    with rasterio.open(pcb.OUT / "lagos_land.tif") as s:
        ids = s.read(1)
    names = [f["properties"]["lga_name"] for f in lgas["features"]]
    inside = np.bincount(ids.ravel(), weights=dst.ravel(), minlength=len(names) + 1)
    print("people inside the 20 LGAs (land only):", round(float(inside[1:].sum())))
    from rasterio.features import rasterize
    ids_all = rasterize(((sh, i + 1) for i, sh in enumerate(grid["shapes"])), out_shape=dst.shape, transform=grid["transform"], fill=0, dtype="uint8")
    per = np.bincount(ids_all.ravel(), weights=dst.ravel(), minlength=len(names) + 1)
    pub = {f["properties"]["lga_name"]: f["properties"]["population"] for f in lgas["features"]}
    worst = max(names, key=lambda n: abs(per[names.index(n) + 1] - pub[n]) / pub[n])
    print("largest LGA difference from the published WorldPop totals: %s %.1f%%" % (worst, 100 * (per[names.index(worst) + 1] - pub[worst]) / pub[worst]))


if __name__ == "__main__":
    main()
