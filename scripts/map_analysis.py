"""Derived map products from the rasters of scripts/pc_build_rasters.py.

1. Hot spots (Getis-Ord Gi*) of the 2020-2025 surface heat island on a ~1 km grid, with a
   Benjamini-Hochberg false-discovery-rate correction.
2. Vegetation against heat: 3 x 3 classes (terciles) of NDVI and SUHI for a bivariate map.
3. Population exposure: WorldPop 2020 people by SUHI class, state-wide and per LGA.
4. Landsat 7 against Landsat 8: per-LGA SUHI from both sensors in the same dry seasons (2014-2019).

Writes research/rasters/hotspots_2020-2025.tif, research/rasters/bivariate_2020-2025.tif and
docs/data/map_analysis.json.

    python scripts/map_analysis.py
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.ndimage import convolve
from scipy.stats import norm

ROOT = Path(__file__).resolve().parents[1]
RAS = ROOT / "research" / "rasters"
PERIOD = "2020-2025"
BLOCK = 16                 # 16 x 60 m = 960 m cells for Gi*
BAND_BLOCKS = 2            # neighbours within 2 blocks (about 2 km) of the cell centre, the cell itself included
MIN_VALID = 0.5            # block needs half its land cells observed
FDR_Q = 0.05
SUHI_CLASSES = [-np.inf, 0, 2, 4, 6, np.inf]
SUHI_LABELS = ["below 0", "0 to 2", "2 to 4", "4 to 6", "6 or more"]
RNG = np.random.default_rng(20251108)


def read(name):
    import rasterio  # imported here so the statistics can be tested without the raster stack
    with rasterio.open(RAS / name) as s:
        a = s.read(1).astype("float64")
        if s.nodata is not None and not np.isnan(s.nodata):
            a[a == s.nodata] = np.nan
        return a, s.profile


def bh(p):
    """Benjamini-Hochberg adjusted p values."""
    p = np.asarray(p); n = p.size
    order = np.argsort(p)
    q = p[order] * n / np.arange(1, n + 1)
    q = np.minimum.accumulate(q[::-1])[::-1]
    out = np.empty(n); out[order] = np.minimum(q, 1)
    return out


def gi_star(suhi, land):
    h, w = (s // BLOCK for s in suhi.shape)
    s = suhi[:h * BLOCK, :w * BLOCK].reshape(h, BLOCK, w, BLOCK)
    l = land[:h * BLOCK, :w * BLOCK].reshape(h, BLOCK, w, BLOCK)
    n_land = l.sum(axis=(1, 3))
    obs = np.isfinite(s) & l
    n_obs = obs.sum(axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        x = np.where(obs, s, 0).sum(axis=(1, 3)) / n_obs
    valid = (n_land >= BLOCK * BLOCK * 0.5) & (n_obs >= n_land * MIN_VALID)
    x = np.where(valid, x, np.nan)
    r = BAND_BLOCKS
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    k = ((yy ** 2 + xx ** 2) <= r * r).astype(float)
    v = valid.astype(float)
    xv = np.where(valid, x, 0)
    n = valid.sum()
    mean, sd = xv[valid].mean(), xv[valid].std()
    wsum = convolve(v, k, mode="constant")             # W_i (binary weights, self included)
    lag = convolve(xv, k, mode="constant")             # sum_j w_ij x_j
    s1 = wsum                                          # binary weights: sum of w_ij^2 = W_i
    with np.errstate(invalid="ignore", divide="ignore"):
        z = (lag - mean * wsum) / (sd * np.sqrt((n * s1 - wsum ** 2) / (n - 1)))
    z = np.where(valid, z, np.nan)
    p = 2 * norm.sf(np.abs(z[valid]))
    q = np.full(z.shape, np.nan); q[valid] = bh(p)
    cls = np.zeros(z.shape, "uint8")                   # 0 no data, 1 cold spot, 2 not significant, 3 hot spot
    cls[valid] = 2
    cls[valid & (q < FDR_Q) & (z > 0)] = 3
    cls[valid & (q < FDR_Q) & (z < 0)] = 1
    return cls, x, int(n)


def write(name, arr, profile, transform=None, dtype="uint8", nodata=0):
    import rasterio
    pr = dict(profile, dtype=dtype, nodata=nodata, count=1, compress="deflate")
    if transform is not None:
        pr.update(transform=transform, height=arr.shape[0], width=arr.shape[1])
    with rasterio.open(RAS / name, "w", **pr) as d:
        d.write(arr.astype(dtype), 1)


def main():
    suhi, prof = read(f"{PERIOD}_suhi_median.tif")
    ndvi, _ = read(f"{PERIOD}_ndvi_median.tif")
    count, _ = read(f"{PERIOD}_count.tif")
    ids, _ = read("lagos_land.tif")
    pop, _ = read("population_2020.tif")
    ids = np.nan_to_num(ids).astype(int)
    land = ids > 0
    lgas = json.loads((ROOT / "docs" / "data" / "lagos_uhi_processed.geojson").read_text())
    names = [f["properties"]["lga_name"] for f in lgas["features"]]
    out = {"script": "scripts/map_analysis.py", "period": PERIOD}

    # 1. hot spots
    import rasterio
    cls, _blk, n = gi_star(suhi, land)
    t = prof["transform"]
    write(f"hotspots_{PERIOD}.tif", cls, prof, transform=rasterio.Affine(t.a * BLOCK, 0, t.c, 0, t.e * BLOCK, t.f))
    out["hotspots"] = {"cell_m": BLOCK * 60, "neighbour_radius_m": BAND_BLOCKS * BLOCK * 60, "fdr_q": FDR_Q, "cells": n,
                       "hot": int((cls == 3).sum()), "cold": int((cls == 1).sum()), "not_significant": int((cls == 2).sum()),
                       "note": "Input values are spatially autocorrelated medians, so significance is optimistic; read classes as a pattern, not as independent tests."}

    # 2. bivariate classes (terciles over observed land cells)
    ok = land & np.isfinite(suhi) & np.isfinite(ndvi) & (count >= 3)
    nt = np.quantile(ndvi[ok], [1 / 3, 2 / 3]); st = np.quantile(suhi[ok], [1 / 3, 2 / 3])
    nc = np.digitize(ndvi, nt); sc = np.digitize(suhi, st)
    biv = np.where(ok, 1 + sc * 3 + nc, 0)              # 1..9; row = SUHI tercile, column = NDVI tercile
    write(f"bivariate_{PERIOD}.tif", biv, prof)
    share = {f"{i}{j}": round(float(((sc == i) & (nc == j) & ok).sum() / ok.sum()), 4) for i in range(3) for j in range(3)}
    rho = float(np.corrcoef(np.argsort(np.argsort(ndvi[ok])), np.argsort(np.argsort(suhi[ok])))[0, 1])
    out["bivariate"] = {"ndvi_terciles": [round(float(v), 3) for v in nt], "suhi_terciles": [round(float(v), 2) for v in st],
                        "share_by_class": share, "spearman_ndvi_suhi_cells": round(rho, 3), "cells": int(ok.sum()),
                        "note": "Cell-level rank correlation across one region; neighbouring cells are not independent, so no p value is given."}

    # 3. exposure
    obs = land & np.isfinite(suhi) & (count >= 3)
    k = np.digitize(suhi, SUHI_CLASSES[1:-1])
    tot_pop = float(pop[land].sum())
    state = {lab: round(float(pop[obs & (k == i)].sum())) for i, lab in enumerate(SUHI_LABELS)}
    per = []
    for i, nm in enumerate(names, 1):
        m = ids == i
        row = {"lga_name": nm, "population": round(float(pop[m].sum())), "unobserved": round(float(pop[m & ~obs].sum()))}
        for j, lab in enumerate(SUHI_LABELS):
            row[lab] = round(float(pop[m & obs & (k == j)].sum()))
        per.append(row)
    out["exposure"] = {"source": "WorldPop 2020, 100 m, unconstrained (modelled, not a census)", "classes_c": SUHI_LABELS,
                       "population_on_land": round(tot_pop), "unobserved": round(float(pop[land & ~obs].sum())), "state": state, "lga": per}

    # 4. Landsat 7 vs Landsat 8, same LGA and same season
    with open(ROOT / "research" / "pc_lga_suhi.csv", newline="") as fh:
        rows = list(csv.DictReader(fh))
    by = defaultdict(lambda: defaultdict(list))
    for r in rows:
        sens = "l7" if r["platform"] == "landsat-7" else ("l8" if r["platform"] == "landsat-8" else None)
        if sens and 2014 <= int(r["season"]) <= 2019:
            by[(r["lga_name"], r["season"])][sens].append(float(r["suhi"]))
    pairs = [(k, np.median(v["l7"]) - np.median(v["l8"])) for k, v in by.items() if v["l7"] and v["l8"]]
    if pairs:
        d = np.array([p for _, p in pairs])
        seasons = sorted({k[1] for k, _ in pairs})
        # bootstrap by season (passes within a season share weather)
        boot = []
        for _ in range(4000):
            pick = RNG.choice(seasons, len(seasons))
            boot.append(np.median(np.concatenate([[p for (lg, s), p in pairs if s == ss] for ss in pick])))
        out["sensor_offset"] = {"pairs": len(pairs), "seasons": seasons, "median_l7_minus_l8": round(float(np.median(d)), 2),
                                "ci95": [round(float(v), 2) for v in np.percentile(boot, [2.5, 97.5])],
                                "pairs_detail": [{"lga_name": k[0], "season": int(k[1]), "l7_minus_l8": round(float(p), 2)} for k, p in pairs]}
    else:
        out["sensor_offset"] = {"pairs": 0, "note": "No LGA had clear Landsat 7 and Landsat 8 passes in the same season."}
    # 5. agreement with the published Earth Engine record (independent pipeline: GHSL reference, 90 m)
    ee = json.loads((ROOT / "docs" / "data" / "change_summary_2000_2025.json").read_text())
    pcm = defaultdict(list)
    for r in rows:
        if r["group"] and r["group"] != "overlap":
            pcm[(r["lga_name"], r["group"])].append(float(r["suhi"]))
    comp = []
    for nm, L in ee["lgas"].items():
        for lab, per in L["periods"].items():
            v = pcm.get((nm, lab))
            if per.get("enough") and per.get("median") is not None and v and len(v) >= 3:
                comp.append({"lga_name": nm, "period": lab, "ee": per["median"], "pc": round(float(np.median(v)), 2), "pc_passes": len(v)})
    if comp:
        e = np.array([c["ee"] for c in comp]); p = np.array([c["pc"] for c in comp])
        from scipy.stats import spearmanr
        out["agreement_with_ee"] = {"pairs": len(comp), "spearman": round(float(spearmanr(e, p)[0]), 3),
                                    "mean_pc_minus_ee": round(float((p - e).mean()), 2), "rmse": round(float(np.sqrt(((p - e) ** 2).mean())), 2),
                                    "note": "Different reference (WorldCover vs GHSL), grid (60 vs 90 m) and pass selection; agreement in ranking matters more than in level.",
                                    "detail": comp}
        # agreement on change (first to last period), the quantity Sections 4.6 and 4.7 rely on
        first, last = "2000-2012", "2020-2025"
        ch = []
        for nm, L in ee["lgas"].items():
            c = L.get("change")
            a, b = pcm.get((nm, first)), pcm.get((nm, last))
            if c and c.get("verdict") != "Too few clear days" and a and b and len(a) >= 3 and len(b) >= 3:
                ch.append({"lga_name": nm, "ee": c["delta"], "pc": round(float(np.median(b) - np.median(a)), 2)})
        if ch:
            e = np.array([c["ee"] for c in ch]); p = np.array([c["pc"] for c in ch])
            out["agreement_with_ee"]["change"] = {"lgas": len(ch), "spearman": round(float(spearmanr(e, p)[0]), 3),
                                                  "same_sign": int((np.sign(e) == np.sign(p)).sum()), "rmse": round(float(np.sqrt(((p - e) ** 2).mean())), 2),
                                                  "detail": ch}
    (ROOT / "docs" / "data" / "map_analysis.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps({k: v for k, v in out.items() if k not in ("exposure",)}, indent=1)[:3000])
    print("exposure state:", out["exposure"]["state"], "unobserved:", out["exposure"]["unobserved"])


if __name__ == "__main__":
    main()
