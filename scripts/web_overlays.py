"""Explorer overlays: period heat-island rasters as transparent PNGs for the web map.

Reprojects each period's median SUHI (research/rasters/{period}_suhi_median.tif, 60 m, UTM 31N) to Web
Mercator (EPSG:3857) at 60 m, colours it with the same ramp as the printed maps (render_maps.SUHI_STOPS),
makes water, no-data and land outside Lagos State transparent, and writes
docs/data/maps/suhi_{period}.png plus docs/data/overlays.json (bounds in latitude/longitude, stops,
pass counts) for docs/explore.html.

    python scripts/web_overlays.py
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
import rasterio
from matplotlib import colors as mcolors
from PIL import Image
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform_bounds

ROOT = Path(__file__).resolve().parents[1]
RAS = ROOT / "research" / "rasters"
OUT = ROOT / "docs" / "data" / "maps"


def main():
    spec = importlib.util.spec_from_file_location("rm", ROOT / "scripts" / "render_maps.py")
    rm = importlib.util.module_from_spec(spec); spec.loader.exec_module(rm)
    meta = json.loads((RAS / "meta.json").read_text())
    with rasterio.open(RAS / "lagos_land.tif") as s:
        land = s.read(1) > 0
        src_t, src_crs, (h, w), b = s.transform, s.crs, s.shape, s.bounds
    dst_t, dw, dh = calculate_default_transform(src_crs, "EPSG:3857", w, h, *b, resolution=60)
    out = {"script": "scripts/web_overlays.py", "crs": "EPSG:3857", "stops": [[v, c] for v, c in rm.SUHI_STOPS], "periods": []}
    OUT.mkdir(parents=True, exist_ok=True)
    m_land = np.zeros((dh, dw), "uint8")
    reproject(land.astype("uint8"), m_land, src_transform=src_t, src_crs=src_crs, dst_transform=dst_t, dst_crs="EPSG:3857", resampling=Resampling.nearest)
    rows, cols = np.where(m_land.any(axis=1))[0], np.where(m_land.any(axis=0))[0]
    r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1     # crop to Lagos land
    for lab in rm.PERIODS:
        p = RAS / f"{lab}_suhi_median.tif"
        if not p.exists():
            continue
        with rasterio.open(p) as s:
            a = s.read(1).astype("float32")
        a = np.where(land, a, np.nan)
        d = np.full((dh, dw), np.nan, "float32")
        reproject(a, d, src_transform=src_t, src_crs=src_crs, src_nodata=np.nan, dst_transform=dst_t, dst_crs="EPSG:3857",
                  dst_nodata=np.nan, resampling=Resampling.nearest)
        rgba = rm.SUHI(rm.SUHI_NORM(np.clip(d, -4, 10)))
        rgba[..., 3] = np.where(np.isfinite(d) & (m_land > 0), 1, 0)
        name = f"suhi_{lab}.png"
        img = Image.fromarray((rgba[r0:r1, c0:c1] * 255).astype("uint8"), "RGBA")
        img.quantize(64, method=Image.Quantize.FASTOCTREE).save(OUT / name, optimize=True)  # 64-colour palette keeps it small
        info = meta["periods"][lab]
        out["periods"].append({"label": lab, "file": f"maps/{name}", "passes": info["passes"], "sensors": info["sensors"]})
    x0, y0 = dst_t.c + dst_t.a * c0, dst_t.f + dst_t.e * r1
    x1, y1 = dst_t.c + dst_t.a * c1, dst_t.f + dst_t.e * r0
    lon0, lat0, lon1, lat1 = transform_bounds("EPSG:3857", "EPSG:4326", x0, y0, x1, y1)
    out["bounds"] = [[round(lat0, 6), round(lon0, 6)], [round(lat1, 6), round(lon1, 6)]]
    (ROOT / "docs" / "data" / "overlays.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
