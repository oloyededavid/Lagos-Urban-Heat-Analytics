"""
Lagos Urban Heat & Population Exposure Analytics Engine
Author: David Oloyede (B.Tech Remote Sensing & GIS, FUTA)
License: MIT

Reads docs/data/lagos_uhi_processed.geojson (installed by scripts/ingest_gee_export.py)
and writes the per-LGA statistics back into it, plus docs/data/summary.json:

- Global Moran's I of surface temperature, Queen contiguity and k-nearest neighbours
  (k = 3, 5, 8), with permutation p-values
- Local Getis-Ord Gi* hot and cold spots, two-sided p-values, Benjamini-Hochberg FDR
- Heat exposure index (min-max and rank versions)
- OLS of surface temperature on NDVI, NDBI and both, with 95% confidence intervals,
  collinearity, leave-one-out robustness and residual Moran's I
- Landsat vs MODIS agreement
- Key findings with plain verdicts, used by the website

    python scripts/analyze_uhi.py
"""
from __future__ import annotations

import hashlib
import json
import logging
import sys
import warnings
from pathlib import Path

import geopandas as gpd
import numpy as np
from esda.getisord import G_Local
from esda.moran import Moran
from libpysal import weights
from scipy import stats

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

REPO_ROOT = Path(__file__).resolve().parents[1]
GEOJSON = REPO_ROOT / "docs" / "data" / "lagos_uhi_processed.geojson"
SUMMARY = REPO_ROOT / "docs" / "data" / "summary.json"
UTM = "EPSG:32631"
KS = (3, 5, 8)
DEFAULT_K = 5
ALPHA = 0.05
PERMUTATIONS = 999
SEED = 20240301

# Columns this script writes; everything else comes from the Earth Engine export.
DERIVED = ["gi_zscore_k3", "gi_pvalue_k3", "fdr_sig_k3", "gi_zscore_k5", "gi_pvalue_k5", "fdr_sig_k5",
           "gi_zscore_k8", "gi_pvalue_k8", "fdr_sig_k8", "gi_zscore", "gi_pvalue", "fdr_significant",
           "k_stable", "hotspot_category", "hei", "hei_rank"]


# ---------------------------------------------------------------- helpers
def benjamini_hochberg(p_values, alpha: float = ALPHA) -> np.ndarray:
    """Benjamini-Hochberg: True where a test survives false-discovery-rate control."""
    p = np.asarray(p_values, dtype=float)
    n = len(p)
    order = np.argsort(p)
    passed = np.where(p[order] <= (np.arange(1, n + 1) / n) * alpha)[0]
    if not len(passed):
        return np.zeros(n, dtype=bool)
    return p <= p[order][passed[-1]]


def knn_weights(points: np.ndarray, k: int, transform: str = "R") -> weights.W:
    w = weights.KNN.from_array(points, k=min(k, len(points) - 1))
    w.transform = transform
    return w


def moran(y, w) -> dict:
    np.random.seed(SEED)
    m = Moran(y, w, permutations=PERMUTATIONS)
    return {"I": round(float(m.I), 4), "z": round(float(m.z_norm), 4), "p_norm": round(float(m.p_norm), 6),
            "p_perm": round(float(m.p_sim), 4)}


def _gi(y, w_binary):
    np.random.seed(SEED)
    gi = G_Local(y, w_binary, transform="R", star=True, permutations=0)
    z = np.asarray(gi.Zs, dtype=float)
    p = 2 * stats.norm.sf(np.abs(z))
    return z, p


def ols(y, columns: dict) -> dict:
    """Classical OLS with standard errors, 95% CIs and p-values."""
    names = ["intercept"] + list(columns)
    X = np.column_stack([np.ones(len(y))] + [np.asarray(v, dtype=float) for v in columns.values()])
    y = np.asarray(y, dtype=float)
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    n, k = X.shape
    dof = n - k
    sigma2 = resid @ resid / dof
    se = np.sqrt(np.diag(sigma2 * np.linalg.inv(X.T @ X)))
    t = beta / se
    tcrit = stats.t.ppf(0.975, dof)
    ss_tot = ((y - y.mean()) ** 2).sum()
    coefs = {nm: {"beta": round(float(b), 4), "se": round(float(s), 4),
                  "ci95": [round(float(b - tcrit * s), 4), round(float(b + tcrit * s), 4)],
                  "p_value": round(float(2 * stats.t.sf(abs(tt), dof)), 6)}
             for nm, b, s, tt in zip(names, beta, se, t)}
    return {"n": int(n), "r2": round(float(1 - resid @ resid / ss_tot), 4), "coefficients": coefs,
            "_resid": resid}


# ---------------------------------------------------------------- analysis
def spatial_statistics(gdf: gpd.GeoDataFrame):
    utm = gdf.to_crs(UTM)
    y = gdf["mean_lst"].to_numpy(float)
    pts = np.column_stack([utm.geometry.centroid.x, utm.geometry.centroid.y])

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        w_queen = weights.Queen.from_dataframe(utm, use_index=False, silence_warnings=True)
    w_queen.transform = "R"
    out = {"queen": moran(y, w_queen), "knn": {}}
    zq, pq = _gi(y, weights.Queen.from_dataframe(utm, use_index=False, silence_warnings=True))
    sig = benjamini_hochberg(pq)
    out["queen"].update({"n_fdr_hot": int((sig & (zq > 0)).sum()), "n_fdr_cold": int((sig & (zq < 0)).sum())})

    zs = {}
    for k in KS:
        out["knn"][f"k_{k}"] = moran(y, knn_weights(pts, k))
        z, p = _gi(y, knn_weights(pts, k, transform="B"))
        sig = benjamini_hochberg(p)
        gdf[f"gi_zscore_k{k}"] = np.round(z, 4)
        gdf[f"gi_pvalue_k{k}"] = np.round(p, 4)
        gdf[f"fdr_sig_k{k}"] = sig
        out["knn"][f"k_{k}"].update({"n_fdr_hot": int((sig & (z > 0)).sum()), "n_fdr_cold": int((sig & (z < 0)).sum())})
        zs[k] = z

    gdf["gi_zscore"] = gdf[f"gi_zscore_k{DEFAULT_K}"]
    gdf["gi_pvalue"] = gdf[f"gi_pvalue_k{DEFAULT_K}"]
    gdf["fdr_significant"] = gdf[f"fdr_sig_k{DEFAULT_K}"]
    # Stable: the same sign and |z| >= 1 for every k
    gdf["k_stable"] = np.all([zs[k] >= 1 for k in KS], axis=0) | np.all([zs[k] <= -1 for k in KS], axis=0)
    gdf["hotspot_category"] = np.where(gdf["fdr_significant"] & (gdf["gi_zscore"] > 0), "Hot spot",
                                       np.where(gdf["fdr_significant"] & (gdf["gi_zscore"] < 0), "Cold spot",
                                                "Not significant"))
    return gdf, out


def heat_exposure(gdf):
    lst = gdf["mean_lst"].to_numpy(float)
    logpop = np.log1p(gdf["pop_density"].to_numpy(float))
    mm = lambda v: (v - v.min()) / (v.max() - v.min())
    gdf["hei"] = np.round(mm(lst) * mm(logpop), 4)
    n = len(gdf)
    gdf["hei_rank"] = np.round((stats.rankdata(lst) / n) * (stats.rankdata(logpop) / n), 4)
    rho, p = stats.spearmanr(gdf["hei"], gdf["hei_rank"])
    top5 = gdf.sort_values("hei", ascending=False)["lga_name"].head(5).tolist()
    return gdf, {"method": "minmax(LST) x minmax(log1p(pop_density))", "top5": top5,
                 "spearman_minmax_vs_rank": round(float(rho), 4), "p_value": round(float(p), 6)}


def regression(gdf):
    y = gdf["mean_lst"].to_numpy(float)
    ndvi, ndbi = gdf["ndvi"].to_numpy(float), gdf["ndbi"].to_numpy(float)
    m1, m2, m3 = ols(y, {"ndvi": ndvi}), ols(y, {"ndbi": ndbi}), ols(y, {"ndvi": ndvi, "ndbi": ndbi})

    utm = gdf.to_crs(UTM)
    pts = np.column_stack([utm.geometry.centroid.x, utm.geometry.centroid.y])
    m3["residual_moran"] = moran(m3.pop("_resid"), knn_weights(pts, DEFAULT_K))
    m1.pop("_resid"), m2.pop("_resid")
    sd = lambda v: float(np.std(v, ddof=1))
    m3["standardised"] = {"ndvi": round(m3["coefficients"]["ndvi"]["beta"] * sd(ndvi) / sd(y), 4),
                          "ndbi": round(m3["coefficients"]["ndbi"]["beta"] * sd(ndbi) / sd(y), 4)}
    r = float(np.corrcoef(ndvi, ndbi)[0, 1])
    loo = []
    for i in range(len(y)):
        keep = np.arange(len(y)) != i
        loo.append(ols(y[keep], {"ndvi": ndvi[keep], "ndbi": ndbi[keep]})["coefficients"]["ndvi"]["beta"])
    return {"lst_on_ndvi": m1, "lst_on_ndbi": m2, "lst_on_ndvi_ndbi": m3,
            "collinearity": {"r_ndvi_ndbi": round(r, 4), "vif": round(1 / (1 - r * r), 4)},
            "leave_one_out_ndvi_beta": {"min": round(min(loo), 4), "max": round(max(loo), 4)}}


def sensor_agreement(gdf):
    a, b = gdf["mean_lst"].to_numpy(float), gdf["modis_lst"].to_numpy(float)
    rho, p = stats.spearmanr(a, b)
    r, pr = stats.pearsonr(a, b)
    d = a - b
    return {"n": int(len(a)), "spearman_rho": round(float(rho), 4), "spearman_p": round(float(p), 8),
            "pearson_r": round(float(r), 4), "pearson_p": round(float(pr), 8),
            "mean_difference_c": round(float(d.mean()), 4), "rmse_c": round(float(np.sqrt((d ** 2).mean())), 4)}


def lst_summary(gdf):
    s = gdf.set_index("lga_name")["mean_lst"]
    return {"mean": round(float(s.mean()), 2), "min": round(float(s.min()), 2), "max": round(float(s.max()), 2),
            "range": round(float(s.max() - s.min()), 2), "hottest": s.idxmax(), "coolest": s.idxmin()}


def base_checksum(geojson_path: Path) -> str:
    """Hash of the Earth Engine values and geometry only (rounded, canonical), so it
    does not change when this script rewrites its own derived columns."""
    data = json.loads(Path(geojson_path).read_text(encoding="utf-8"))

    def rnd(x):
        if isinstance(x, float):
            return round(x, 6)
        if isinstance(x, list):
            return [rnd(v) for v in x]
        if isinstance(x, dict):
            return {k: rnd(v) for k, v in x.items()}
        return x
    feats = sorted(({"p": {k: rnd(v) for k, v in f["properties"].items() if k not in DERIVED},
                     "g": rnd(f["geometry"])} for f in data["features"]), key=lambda f: f["p"]["lga_name"])
    return hashlib.sha256(json.dumps(feats, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def provenance(gdf) -> dict:
    status = set(gdf.get("data_status", gpd.pd.Series(["UNKNOWN"])).fillna("UNKNOWN"))
    first = gdf.iloc[0]
    ok = status == {"GEE_EXPORT"} and bool(first.get("script_version"))
    return {"status": "GEE_EXPORT" if ok else "UNVERIFIED", "is_verified_export": bool(ok),
            "gee_script_version": first.get("script_version"), "gee_export_utc": first.get("export_utc"),
            "period": first.get("period"),
            "landsat_scenes": _int(first.get("landsat_scenes")), "s2_scenes": _int(first.get("s2_scenes")),
            "modis_images": _int(first.get("modis_images"))}


def _int(v):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else int(v)


def key_findings(sa, reg, sens, hei) -> list[dict]:
    k5 = sa["knn"][f"k_{DEFAULT_K}"]
    n_hot, n_cold = k5["n_fdr_hot"], k5["n_fdr_cold"]
    c1, c3 = reg["lst_on_ndvi"]["coefficients"]["ndvi"], reg["lst_on_ndvi_ndbi"]["coefficients"]
    return [
        {"id": "clustering", "title": "Heat clusters across neighbouring LGAs",
         "verdict": "Significant" if k5["p_perm"] < ALPHA else "No link",
         "stats": {"I": k5["I"], "p_perm": k5["p_perm"], "k": DEFAULT_K}},
        {"id": "hotspots", "title": "Individual hot and cold spots",
         "verdict": "Significant" if n_hot + n_cold else "No link", "stats": {"n_hot": n_hot, "n_cold": n_cold}},
        {"id": "vegetation", "title": "Greener LGAs are cooler",
         "verdict": "Significant" if c1["p_value"] < ALPHA else "No link",
         "stats": {"beta": c1["beta"], "ci95": c1["ci95"], "r2": reg["lst_on_ndvi"]["r2"], "p_value": c1["p_value"]}},
        {"id": "builtup", "title": "Trees or concrete? The data cannot separate them",
         "verdict": "Not robust" if c3["ndvi"]["p_value"] >= ALPHA else "Significant",
         "stats": {"vif": reg["collinearity"]["vif"], "beta_ndvi": c3["ndvi"]["beta"], "ci95_ndvi": c3["ndvi"]["ci95"],
                   "p_ndvi": c3["ndvi"]["p_value"], "beta_ndbi": c3["ndbi"]["beta"], "p_ndbi": c3["ndbi"]["p_value"]}},
        {"id": "sensors", "title": "Two satellites agree on the pattern",
         "verdict": "Significant" if sens["spearman_p"] < ALPHA else "No link",
         "stats": {"rho": sens["spearman_rho"], "mean_difference_c": sens["mean_difference_c"]}},
        {"id": "exposure", "title": "Where heat meets the most people", "verdict": "Ranking",
         "stats": {"top5": hei["top5"], "rank_agreement": hei["spearman_minmax_vs_rank"]}},
    ]


def run(geojson_path: Path = GEOJSON, summary_path: Path = SUMMARY) -> dict:
    gdf = gpd.read_file(geojson_path).sort_values("lga_name").reset_index(drop=True)
    # Keep text fields as written (the reader would otherwise turn timestamps into dates)
    raw = {f["properties"]["lga_name"]: f["properties"]
           for f in json.loads(Path(geojson_path).read_text(encoding="utf-8"))["features"]}
    for col in ("export_utc", "period"):
        if col in gdf:
            gdf[col] = [raw[n].get(col) for n in gdf["lga_name"]]
    gdf, sa = spatial_statistics(gdf)
    gdf, hei = heat_exposure(gdf)
    reg = regression(gdf)
    sens = sensor_agreement(gdf)

    gdf.to_file(geojson_path, driver="GeoJSON")
    prov = provenance(gdf)
    prov["base_checksum"] = base_checksum(geojson_path)
    summary = {"provenance": prov, "n_units": int(len(gdf)), "lst": lst_summary(gdf),
               "spatial_autocorrelation": sa, "heat_exposure": hei, "regression": reg,
               "sensor_agreement": sens, "key_findings": key_findings(sa, reg, sens, hei)}
    Path(summary_path).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    logging.info("Wrote %s and %s", geojson_path, summary_path)
    return summary


if __name__ == "__main__":
    run(*(Path(a) for a in sys.argv[1:3]))
