"""Uncertainty of the 2020-2025 heat medians: leave-one-pass-out, leave-one-year-out, leave-one-LGA-out and
the effect of the screening rules.

Reads the per-pass rasters written by scripts/pass_stack.py and writes docs/data/sensitivity_passes.json.
The baseline median over kept passes is checked against research/rasters/2020-2025_suhi_median.tif first.

    python scripts/pass_sensitivity.py
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import uhi_metrics as um  # noqa: E402

PASSES = ROOT / "research" / "rasters" / "passes"


def load_stack(rows):
    arrs, ids = [], []
    for r in rows:
        with rasterio.open(PASSES / f"{r['pass_id']}_suhi.tif") as s:
            a = s.read(1).astype("float32")
        arrs.append(a); ids.append(r)
    return np.stack(arrs), ids


def median_blocks(rows, block=150):
    """Median over many passes without holding them all in memory: read matching row blocks from each file."""
    import warnings
    paths = [PASSES / f"{r['pass_id']}_suhi.tif" for r in rows]
    with rasterio.open(paths[0]) as s0:
        H, W = s0.height, s0.width
    med = np.full((H, W), np.nan, "float32")
    cnt = np.zeros((H, W), "float64")
    for r0 in range(0, H, block):
        r1 = min(H, r0 + block)
        blk = []
        for p in paths:
            with rasterio.open(p) as s:
                blk.append(s.read(1, window=rasterio.windows.Window(0, r0, W, r1 - r0)).astype("float32"))
        st = np.stack(blk)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med[r0:r1] = np.nanmedian(st, axis=0)
        cnt[r0:r1] = np.isfinite(st).sum(axis=0)
    return med, cnt


def median_of(stack):
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        med = np.nanmedian(stack, axis=0)
        cnt = np.isfinite(stack).sum(axis=0).astype("float64")
    return med, cnt


def summarise(med, cnt, base):
    r = um.headline(um.read("population_2020.tif"), med.astype("float64"), cnt, base)
    return {"bu_gap_c": r["bu_gap_c"], "pooled_gap_c": r["pooled_gap_c"], "bu_within_c": r["bu_within"]["mean_c"],
            "bu_beyond_c": r["bu_beyond"]["mean_c"], "bu_hot_within": r["bu_within"]["hot_share"],
            "bu_hot_beyond": r["bu_beyond"]["hot_share"], "all_hot_beyond": r["all_beyond"]["hot_share"],
            "all_hot_within": r["all_within"]["hot_share"]}


def spread(runs, key):
    vals = [r[key] for r in runs.values()]
    return {"min": round(float(min(vals)), 3), "max": round(float(max(vals)), 3), "n": len(vals)}


def main():
    rows = list(csv.DictReader(open(ROOT / "research" / "pass_stack.csv")))
    kept = [r for r in rows if r["verdict"] == "kept" and r["saved"] == "True"]
    allp = [r for r in rows if r["saved"] == "True"]
    base = um.baseline()
    lga = um.read("lagos_land.tif")
    print(f"kept passes: {len(kept)}; all saved passes: {len(allp)}", flush=True)

    stack, ids = load_stack(kept)
    med, cnt = median_of(stack)
    ref = um.read("2020-2025_suhi_median.tif")
    both = np.isfinite(ref) & np.isfinite(med)
    diff = float(np.nanmax(np.abs(ref[both] - med[both]))) if both.any() else float("nan")
    cnt_ref = um.read("2020-2025_count.tif")
    check = {"max_abs_diff_median_c": round(diff, 4), "count_matches": bool(np.nanmax(np.abs(cnt_ref - cnt)) == 0)}
    print("baseline check", check, flush=True)
    full = summarise(med, cnt, base)

    loo = {}
    for i, r in enumerate(ids):
        keep = [j for j in range(len(ids)) if j != i]
        m, c = median_of(stack[keep])
        loo[r["pass_id"]] = summarise(m, c, base)
    years = sorted({r["date"][:4] for r in ids})
    lOY = {}
    for y in years:
        keep = [j for j, r in enumerate(ids) if r["date"][:4] != y]
        if not keep:
            continue
        m, c = median_of(stack[keep])
        lOY[y] = summarise(m, c, base)

    lgas = sorted({int(v) for v in np.unique(lga) if v > 0})
    lLGA = {}
    for g in lgas:
        b2 = dict(base); b2["inside"] = base["inside"] & (lga != g)
        b2["beyond"] = base["beyond"] & (lga != g)
        lLGA[str(g)] = summarise(med, cnt, b2)

    # screening: median over every saved pass, including the ones rejected by the cold-anomaly or LGA rules
    rej = [r for r in allp if r["verdict"] != "kept"]
    m_all, c_all = median_blocks(allp)
    screen = summarise(m_all, c_all, base)

    out = {
        "baseline_check": check,
        "kept_passes": len(kept),
        "saved_passes": len(allp),
        "rejected_but_saved": len(rej),
        "full": full,
        "leave_one_pass_out": {"runs": loo, "range": {k: spread(loo, k) for k in full}},
        "leave_one_year_out": {"runs": lOY, "range": {k: spread(lOY, k) for k in full}},
        "leave_one_lga_out": {"runs": lLGA, "range": {k: spread(lLGA, k) for k in full}},
        "screening_all_saved_passes": screen,
    }
    (ROOT / "docs" / "data" / "sensitivity_passes.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print("full", {k: round(v, 3) for k, v in full.items()})
    print("screening", {k: round(v, 3) for k, v in screen.items()})


if __name__ == "__main__":
    main()
