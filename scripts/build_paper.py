"""Build paper/paper.md from paper/template.md. Numbers come from docs/data/*.json, research/pass_stack.csv and a few
counts read from research/rasters (land area, no-data share, land-cover shares, share of the reference inside the state).

    python scripts/build_paper.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data"
A = json.loads((DATA / "access.json").read_text())
E = json.loads((DATA / "extra_analysis.json").read_text())
M = json.loads((DATA / "map_analysis.json").read_text())


def pct(x, d=0):
    return f"{x * 100:.{d}f}"


def f1(x):
    """One decimal, rounding half up on the stored value, so ties such as 3.65 do not depend on float representation."""
    from decimal import Decimal, ROUND_HALF_UP
    return str(Decimal(str(round(x, 6))).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)).replace("-", "−")


vals = {
    "pop_total_m": f"{E['population_total'] / 1e6:.1f}",
    "beyond_pct": pct(A["population_beyond_300m_share"]),
    "beyond_lo_pct": pct(A["population_beyond_300m_ndvi_sensitivity"]["0.3"]["population_beyond_300m_share"]),
    "beyond_hi_pct": pct(A["population_beyond_300m_ndvi_sensitivity"]["0.5"]["population_beyond_300m_share"]),
    "gap_pct": pct(E["gap_beyond_300m_and_hot"]["share_of_total"]),
    "gap_pop_m": f"{E['gap_beyond_300m_and_hot']['population'] / 1e6:.1f}",
    "hot_within_pct": pct(E["access_heat"]["within_300m"]["population_in_hot_cells_share"]),
    "hot_beyond_pct": pct(E["access_heat"]["beyond_300m"]["population_in_hot_cells_share"]),
    "wm_within": f1(E["access_heat"]["within_300m"]["pop_weighted_mean_suhi_c"]),
    "wm_beyond": f1(E["access_heat"]["beyond_300m"]["pop_weighted_mean_suhi_c"]),
    "hot2_pct": pct(E["hot_threshold_sensitivity"]["2"]),
    "hot5_pct": pct(E["hot_threshold_sensitivity"]["5"]),
    "built_pop_pct": pct(E["landcover"]["50"]["population_share"]),
    "built_area_pct": pct(E["landcover"]["50"]["area_share"]),
    "built_median": f1(E["landcover"]["50"]["median_suhi_c"]),
    "tree_pop_pct": pct(E["landcover"]["10"]["population_share"]),
    "tree_area_pct": pct(E["landcover"]["10"]["area_share"]),
    "tree_median": f1(E["landcover"]["10"]["median_suhi_c"]),
    "low_area_pct": pct(A["low_ground_area_share"]),
    "low_pop_pct": pct(A["low_ground_population_share"]),
    "low_diff": f1(A["heat_low_minus_other_median_c"]),
    "low_cells": f"{A['heat_cells_low']:,}",
    "other_cells": f"{A['heat_cells_other']:,}",
    "veg_ndvi": f"{A['veg_ndvi_threshold']:.1f}",
    "access_m": f"{A['access_m']:.0f}",
    "far600_pct": pct(E["distance_bands"]["600 m and more"]["population_share"]),
    "band_first": f1(E["distance_bands"]["0-60 m"]["pop_weighted_mean_suhi_c"]),
    "band_last": f1(E["distance_bands"]["600 m and more"]["pop_weighted_mean_suhi_c"]),
}

import rasterio
import numpy as np
from PIL import Image
with rasterio.open(ROOT / "research" / "rasters" / "lagos_land.tif") as src:
    land = src.read(1)
land_km2 = float((land > 0).sum()) * 60 * 60 / 1e6
with rasterio.open(ROOT / "research" / "rasters" / "2020-2025_count.tif") as src:
    cnt = src.read(1).astype("float64")
with rasterio.open(ROOT / "research" / "rasters" / "2020-2025_ndvi_median.tif") as src:
    ndvi = src.read(1).astype("float64")
    if src.nodata is not None:
        ndvi[ndvi == src.nodata] = np.nan
land_m = land > 0
with rasterio.open(ROOT / "research" / "rasters" / "2020-2025_suhi_median.tif") as src:
    suhi_chk = src.read(1).astype("float64")
    if src.nodata is not None:
        suhi_chk[suhi_chk == src.nodata] = np.nan
nodata = land_m & ~np.isfinite(ndvi)
few = land_m & np.isfinite(ndvi) & (cnt > 0) & (cnt < 3)   # has a value but fewer than 3 clear passes
heat_share = (np.isfinite(suhi_chk) & land_m & (cnt >= 3)).sum() / (np.isfinite(ndvi) & land_m).sum()
S = E["stratified"]
bu_w, bu_b = S["built_up"]["within_300m"], S["built_up"]["beyond_300m"]
ot_w, ot_b = S["other_land"]["within_300m"], S["other_land"]["beyond_300m"]
pooled_gap = E["access_heat"]["beyond_300m"]["pop_weighted_mean_suhi_c"] - E["access_heat"]["within_300m"]["pop_weighted_mean_suhi_c"]
bu_gap = bu_b["pop_weighted_mean_suhi_c"] - bu_w["pop_weighted_mean_suhi_c"]
beyond_pop = bu_b["population"] + ot_b["population"]
within_pop = bu_w["population"] + ot_w["population"]
V = E["vegetated_cells"]
vals.update({
    "ot_gap": f1(ot_b["pop_weighted_mean_suhi_c"] - ot_w["pop_weighted_mean_suhi_c"]),
    "pooled_gap": f1(pooled_gap), "bu_gap": f1(bu_gap),
    "bu_within": f1(bu_w["pop_weighted_mean_suhi_c"]), "bu_beyond": f1(bu_b["pop_weighted_mean_suhi_c"]),
    "bu_hot_within": pct(bu_w["population_in_hot_cells_share"]), "bu_hot_beyond": pct(bu_b["population_in_hot_cells_share"]),
    "ot_within": f1(ot_w["pop_weighted_mean_suhi_c"]), "ot_beyond": f1(ot_b["pop_weighted_mean_suhi_c"]),
    "ot_hot_within": pct(ot_w["population_in_hot_cells_share"]), "ot_hot_beyond": pct(ot_b["population_in_hot_cells_share"]),
    "beyond_built_pct": pct(bu_b["population"] / beyond_pop), "within_built_pct": pct(bu_w["population"] / within_pop),
    "veg_pop_pct": pct(V["population_share_of_total"]), "veg_mean": f1(V["pop_weighted_mean_suhi_c"]),
    "within_excl_veg": f1(V["within_300m_excluding_vegetated_pop_weighted_mean_suhi_c"]),
    "bu_band_first": f1(S["built_up"]["distance_bands"]["0-60 m"]["pop_weighted_mean_suhi_c"]),
    "bu_band_last": f1(S["built_up"]["distance_bands"]["600 m and more"]["pop_weighted_mean_suhi_c"]),
    "hot4_pct": pct(E["hot_threshold_sensitivity"]["4"]),
    "pop_land_m": f"{M['exposure']['population_on_land'] / 1e6:.1f}",
})
with rasterio.open(ROOT / "research" / "rasters" / "worldcover_2021.tif") as src:
    wc_all = src.read(1)
with rasterio.open(ROOT / "research" / "rasters" / "population_2020.tif") as src:
    pop_all = src.read(1).astype("float64")
pop_all = np.where(np.isfinite(pop_all) & (pop_all > 0), pop_all, 0.0)
land_all = land > 0
area_n = land_all.sum()
vals.update({
    "lc_built_area": f"{(land_all & (wc_all == 50)).sum() / area_n * 100:.0f}",
    "lc_tree_area": f"{(land_all & (wc_all == 10)).sum() / area_n * 100:.0f}",
    "lc_built_pop": f"{pop_all[land_all & (wc_all == 50)].sum() / pop_all[land_all].sum() * 100:.0f}",
    "lc_tree_pop": f"{pop_all[land_all & (wc_all == 10)].sum() / pop_all[land_all].sum() * 100:.0f}",
})
GS = json.loads((DATA / "gap_specifications.json").read_text())
SN = json.loads((DATA / "sensitivity_ndvi.json").read_text())["cutoffs"]
grid_gaps = [v["bu_gap_c"] for v in GS["grid"].values()]
if not all(g > 0 for g in grid_gaps):
    raise SystemExit("built-up gap changes sign in some specification")
G = GS["grid"]
_sp = json.loads((DATA / "sensitivity_passes.json").read_text())
for _k in ("leave_one_pass_out", "leave_one_year_out", "leave_one_lga_out"):
    if not all(r["bu_gap_c"] > 0 for r in _sp[_k]["runs"].values()):
        raise SystemExit(f"built-up gap not positive in {_k}")
if not _sp["screening_all_saved_passes"]["bu_gap_c"] > 0:
    raise SystemExit("built-up gap not positive with screening off")
if not all(v["bu_gap_c"] > 0 for v in GS["lga"].values()):
    raise SystemExit("an LGA gap is not positive")
if not (_sp["baseline_check"]["count_matches"] and _sp["baseline_check"]["max_abs_diff_median_c"] < 0.05):
    raise SystemExit("pass stack does not reproduce the composite")
vals.update({
    "pop_con_bu_ex": f1(G["ndvi0.4|buffer0|constrained"]["bu_gap_c"]),
    "bu_band_second": f1(E["stratified"]["built_up"]["distance_bands"]["60-120 m"]["pop_weighted_mean_suhi_c"]),
    "nohot_pct": f1((1 - E["population_with_heat_value_share"]) * 100),
})
vals.update({
    **{f"g{c.replace('.', '')}_{b}": f1(G[f"ndvi{c}|buffer{b}|unconstrained"]["bu_gap_c"]) for c in ("0.3", "0.5") for b in (0, 60, 120)},
    **{f"g04_{b}": f1(G[f"ndvi0.4|buffer{b}|unconstrained"]["bu_gap_c"]) for b in (0, 60, 120)},
    "spec_min": f1(min(grid_gaps)), "spec_max": f1(max(grid_gaps)),
    "nd03_gap": f1(SN["0.3"]["bu_gap_c"]), "nd04_gap": f1(SN["0.4"]["bu_gap_c"]), "nd05_gap": f1(SN["0.5"]["bu_gap_c"]),
    "nd03_pool": f1(SN["0.3"]["pooled_gap_c"]), "nd05_pool": f1(SN["0.5"]["pooled_gap_c"]),
    "ex_veg_gap": f1(G["ndvi0.4|buffer0|unconstrained"]["bu_gap_c"]),
    "ex60_gap": f1(G["ndvi0.4|buffer60|unconstrained"]["bu_gap_c"]),
    "ex120_gap": f1(G["ndvi0.4|buffer120|unconstrained"]["bu_gap_c"]),
    "lga_w": f"{GS['lga_summary']['weighted_mean']:.2f}", "lga_lo": f1(GS["lga_summary"]["min"]), "lga_hi": f1(GS["lga_summary"]["max"]),
    "lga_n": str(GS["lga_summary"]["n"]),
    "low_gap": f1(GS["low_ground"]["low_ground_below_10m"]["bu_gap_c"]), "high_gap": f1(GS["low_ground"]["higher_ground"]["bu_gap_c"]),
    "water_in": f1(GS["water"]["water_within_500m"]["bu_gap_c"]), "water_out": f1(GS["water"]["water_beyond_500m"]["bu_gap_c"]),
})
vals.update({"heat_pct": f"{heat_share * 100:.0f}",
             "heat_pop_m": f"{E['population_total'] * E['population_with_heat_value_share'] / 1e6:.1f}",
             "low_absdiff": f"{abs(A['heat_low_minus_other_median_c']):.1f}",
             "walk_min": f"{float(A['access_m']) / 5000 * 60:.1f}",
             "nodata_comp_pct": f"{(np.isfinite(ndvi) & land_m).sum() / land_m.sum() * 100:.0f}",
             "land_km2": f"{land_km2:,.0f}", "n_lga": str(len(E["lga"])),
             "nodata_pct": f"{nodata.sum() / land_m.sum() * 100:.0f}",
             "few_pct": f"{few.sum() / land_m.sum() * 100:.0f}"})

# figures: only the two maps with complete inputs (population, land cover); the low-ground map has NDVI gaps
(ROOT / "paper" / "figures").mkdir(parents=True, exist_ok=True)
for src, dst in [("m12_population", "fig1_population"), ("m02_landcover", "fig2_landcover")]:
    Image.open(ROOT / "docs" / "assets" / "maps" / f"{src}.webp").convert("RGB").save(ROOT / "paper" / "figures" / f"{dst}.png", optimize=True)

# ---- sensitivity checks (scripts/population_sensitivity.py, scripts/pass_sensitivity.py) ----
SP = json.loads((DATA / "sensitivity_population.json").read_text())["variants"]
SQ = json.loads((DATA / "sensitivity_passes.json").read_text())
passes_csv = list(__import__("csv").DictReader(open(ROOT / "research" / "pass_stack.csv")))
verdicts = __import__("collections").Counter(r["verdict"] for r in passes_csv)
assert sum(verdicts.values()) == len(passes_csv) and verdicts["kept"] == json.loads((DATA / "sensitivity_passes.json").read_text())["kept_passes"], "pass verdicts do not add up"
with rasterio.open(ROOT / "research" / "rasters" / "reference_mask.tif") as src:
    refm = src.read(1) > 0
with rasterio.open(ROOT / "research" / "rasters" / "lagos_land.tif") as src:
    lga_id = src.read(1)
ref_inside_share = float((refm & (lga_id > 0)).sum() / refm.sum()) * 100
lp = SQ["leave_one_pass_out"]["range"]; ly = SQ["leave_one_year_out"]["range"]; ll = SQ["leave_one_lga_out"]["range"]
sc = SQ["screening_all_saved_passes"]
kept_n = SQ["kept_passes"]; saved_n = SQ["saved_passes"]
vals.update({
    "n_passes": str(len(passes_csv)), "n_kept": str(kept_n), "n_saved": str(saved_n),
    "v_cloud": str(verdicts["reference mostly cloudy"]), "v_lga": str(verdicts["no LGA at least half clear"]),
    "v_cold": str(verdicts["cold anomaly (cloud or fog)"]), "v_err": str(verdicts["read error"]),
    "ref_inside_pct": f"{ref_inside_share:.0f}",
    "pop_con_beyond": pct(SP["constrained"]["beyond_share"]), "pop_con_bu_gap": f1(SP["constrained"]["bu_gap_c"]),
    "pop_con_pooled": f1(SP["constrained"]["pooled_gap_c"]),
    "pop_bu_beyond": pct(SP["unconstrained_built_up_only"]["beyond_share"]), "pop_bu_pooled": f1(SP["unconstrained_built_up_only"]["pooled_gap_c"]),
    "bu_gap_lo": f1(lp["bu_gap_c"]["min"]), "bu_gap_hi": f1(lp["bu_gap_c"]["max"]),
    "pool_gap_lo": f1(lp["pooled_gap_c"]["min"]), "pool_gap_hi": f1(lp["pooled_gap_c"]["max"]),
    "bu_hw_lo": pct(lp["bu_hot_within"]["min"]), "bu_hw_hi": pct(lp["bu_hot_within"]["max"]),
    "bu_hb_lo": pct(lp["bu_hot_beyond"]["min"]), "bu_hb_hi": pct(lp["bu_hot_beyond"]["max"]),
    "loy_gap_lo": f1(ly["bu_gap_c"]["min"]), "loy_gap_hi": f1(ly["bu_gap_c"]["max"]),
    "lga_gap_lo": f1(ll["bu_gap_c"]["min"]), "lga_gap_hi": f1(ll["bu_gap_c"]["max"]),
    "scr_bu_gap": f1(sc["bu_gap_c"]), "scr_pool_gap": f1(sc["pooled_gap_c"]),
    "diff_max": f"{SQ['baseline_check']['max_abs_diff_median_c']:.3f}",
    "bu_gap_full": f1(SQ["full"]["bu_gap_c"]),
})

tpl = (ROOT / "paper" / "template.md").read_text(encoding="utf-8")
missing = sorted(set(re.findall(r"\{\{(\w+)\}\}", tpl)) - set(vals))
if missing:
    raise SystemExit(f"template keys without values: {missing}")
out = re.sub(r"\{\{(\w+)\}\}", lambda m: vals[m.group(1)], tpl)
(ROOT / "paper" / "paper.md").write_text(out, encoding="utf-8")
print("wrote paper/paper.md with", len(vals), "values")
