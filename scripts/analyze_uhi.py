"""
Lagos Urban Heat & Population Exposure Analytics Engine
Author: David Oloyede (B.Tech Remote Sensing & GIS, FUTA)
License: MIT
Description: Reproducible spatial statistics (KNN k=3,5,8 vs Queen contiguity),
             BH-FDR adjustment, Rank vs Min-Max HEI robustness, and NDBI-controlled
             spatial regression with residual Moran's I diagnostics.
"""

import json
import logging
import os
import numpy as np
import geopandas as gpd
from scipy import stats
from libpysal import weights
from esda.moran import Moran
from esda.getisord import G_Local

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

CONFIG = {
    "input_paths": [
        "data/raw_lagos_wards.geojson",
        "data/raw_lagos_lgas.geojson",
        "docs/data/lagos_uhi_processed.geojson"
    ],
    "output_geojson": "docs/data/lagos_uhi_processed.geojson",
    "summary_json": "docs/data/summary.json",
    "utm_crs": "EPSG:32631",
    "geo_crs": "EPSG:4326",
    "knn_k": [3, 5, 8],
    "default_k": 5,
    "fdr_alpha": 0.05
}


def benjamini_hochberg(p_values, alpha=0.05):
    """Computes exact Benjamini-Hochberg False Discovery Rate boolean flags."""
    p_vals = np.asanyarray(p_values, dtype=float)
    n = len(p_vals)
    sorted_idx = np.argsort(p_vals)
    sorted_p = p_vals[sorted_idx]
    thresholds = (np.arange(1, n + 1) / n) * alpha
    passed = np.where(sorted_p <= thresholds)[0]
    if len(passed) == 0:
        return np.zeros(n, dtype=bool)
    cutoff = sorted_p[passed[-1]]
    return p_vals <= cutoff


def compute_spatial_statistics(gdf):
    """Computes Global Moran's I and Local Getis-Ord Gi* (on physical LST) across KNN and Queen weights."""
    gdf_utm = gdf.to_crs(CONFIG["utm_crs"])
    y_lst = gdf_utm["mean_lst"].values.astype(float)

    # 1. Queen Contiguity
    try:
        w_queen = weights.Queen.from_dataframe(gdf_utm, use_index=False, silence_warnings=True)
        w_queen.transform = "R"
        mi_queen = Moran(y_lst, w_queen)
        queen_stats = {"I": round(float(mi_queen.I), 4), "p_norm": round(float(mi_queen.p_norm), 4)}
    except Exception as exc:
        logging.warning(f"Queen contiguity warning: {exc}")
        queen_stats = {"I": None, "p_norm": None}

    # 2. KNN Sensitivity Loop (k = 3, 5, 8)
    centroids = np.column_stack([gdf_utm.geometry.centroid.x, gdf_utm.geometry.centroid.y])
    k_zscores = {}
    knn_moran = {}

    for k in CONFIG["knn_k"]:
        w_knn = weights.KNN.from_array(centroids, k=min(k, len(gdf_utm) - 1))
        w_knn.transform = "R"
        mi = Moran(y_lst, w_knn)
        knn_moran[f"k_{k}"] = {"I": round(float(mi.I), 4), "p_norm": round(float(mi.p_norm), 4)}

        gi = G_Local(y_lst, w_knn, transform="R", star=True)
        fdr_sig = benjamini_hochberg(gi.p_norm, alpha=CONFIG["fdr_alpha"])

        gdf[f"gi_zscore_k{k}"] = np.round(gi.Zs, 4)
        gdf[f"gi_pvalue_k{k}"] = np.round(gi.p_norm, 4)
        gdf[f"fdr_sig_k{k}"] = fdr_sig.astype(bool)
        k_zscores[k] = gi.Zs

    gdf["k_stable"] = (
        ((k_zscores[3] >= 0.55) & (k_zscores[5] >= 0.55) & (k_zscores[8] >= 0.55)) |
        ((k_zscores[3] <= -0.55) & (k_zscores[5] <= -0.55) & (k_zscores[8] <= -0.55))
    )
    gdf["gi_zscore"] = gdf[f"gi_zscore_k{CONFIG['default_k']}"]
    gdf["gi_pvalue"] = gdf[f"gi_pvalue_k{CONFIG['default_k']}"]
    gdf["fdr_significant"] = gdf[f"fdr_sig_k{CONFIG['default_k']}"]

    return gdf, {"queen": queen_stats, "knn": knn_moran}


def compute_hei_variants(gdf):
    """Computes Min-Max, Percentile Rank, and Z-score Heat Exposure Index variants."""
    lst = gdf["mean_lst"].values.astype(float)
    pop = gdf["pop_density"].values.astype(float)
    log_pop = np.log1p(pop)

    lst_norm = (lst - np.min(lst)) / (np.max(lst) - np.min(lst) + 1e-9)
    pop_norm = (log_pop - np.min(log_pop)) / (np.max(log_pop) - np.min(log_pop) + 1e-9)
    gdf["hei_minmax"] = np.round(lst_norm * pop_norm, 4)

    lst_rank = stats.rankdata(lst) / len(lst)
    pop_rank = stats.rankdata(pop) / len(pop)
    gdf["hei_rank"] = np.round(lst_rank * pop_rank, 4)

    rho, p_val = stats.spearmanr(gdf["hei_minmax"], gdf["hei_rank"])
    return gdf, {"spearman_minmax_vs_rank_rho": round(float(rho), 4), "p_value": round(float(p_val), 6)}


def compute_econometric_models(gdf):
    """Fits univariate and NDBI-controlled OLS models and checks residual Moran's I."""
    valid = gdf.dropna(subset=["mean_lst", "ndvi"]).copy()
    y = valid["mean_lst"].values.astype(float)
    x_ndvi = valid["ndvi"].values.astype(float)

    slope, intercept, r_val, p_val, std_err = stats.linregress(x_ndvi, y)
    ci95 = float(stats.t.ppf(0.975, df=max(1, len(y) - 2)) * std_err)

    result = {
        "univariate_ols": {
            "slope_c_per_ndvi": round(float(slope), 4),
            "ci95": round(ci95, 4),
            "r2": round(float(r_val ** 2), 4),
            "p_value": round(float(p_val), 6),
            "ndvi_min": round(float(np.min(x_ndvi)), 4),
            "ndvi_max": round(float(np.max(x_ndvi)), 4)
        }
    }

    if "ndbi" in valid.columns and valid["ndbi"].notnull().all():
        x_ndbi = valid["ndbi"].values.astype(float)
        X = np.column_stack([np.ones(len(valid)), x_ndvi, x_ndbi])
        beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
        resids = y - (X @ beta)

        gdf_utm = valid.to_crs(CONFIG["utm_crs"])
        centroids = np.column_stack([gdf_utm.geometry.centroid.x, gdf_utm.geometry.centroid.y])
        w_knn = weights.KNN.from_array(centroids, k=min(CONFIG["default_k"], len(valid) - 1))
        w_knn.transform = "R"
        mi_res = Moran(resids, w_knn)

        result["multivariate_ols"] = {
            "beta_intercept": round(float(beta[0]), 4),
            "beta_ndvi": round(float(beta[1]), 4),
            "beta_ndbi": round(float(beta[2]), 4),
            "residual_moran_i": round(float(mi_res.I), 4),
            "residual_moran_p": round(float(mi_res.p_norm), 4)
        }

    return result


def compute_modis_validation(gdf):
    """Computes Spearman rank correlation against MODIS LST if present in GeoJSON."""
    if "modis_lst" not in gdf.columns or gdf["modis_lst"].isnull().all():
        return {"status": "pending_gee_modis_export", "spearman_rho": None, "p_value": None}

    valid = gdf.dropna(subset=["mean_lst", "modis_lst"])
    rho, p_val = stats.spearmanr(valid["mean_lst"], valid["modis_lst"])
    return {
        "status": "verified",
        "spearman_rho": round(float(rho), 4),
        "p_value": round(float(p_val), 6),
        "n": int(len(valid))
    }


def main():
    os.makedirs("docs/data", exist_ok=True)
    input_file = next((p for p in CONFIG["input_paths"] if os.path.exists(p)), None)
    if not input_file:
        raise FileNotFoundError("No input GeoJSON found in data/ or docs/data/.")

    logging.info(f"Loading spatial features from {input_file}...")
    gdf = gpd.read_file(input_file)

    gdf, spatial_stats = compute_spatial_statistics(gdf)
    gdf, hei_stats = compute_hei_variants(gdf)
    reg_stats = compute_econometric_models(gdf)
    modis_stats = compute_modis_validation(gdf)

    gdf.to_crs(CONFIG["geo_crs"]).to_file(CONFIG["output_geojson"], driver="GeoJSON")
    logging.info(f"Saved updated GeoJSON to {CONFIG['output_geojson']}")

    summary = {
        "n_units": int(len(gdf)),
        "spatial_autocorrelation": spatial_stats,
        "hei_robustness": hei_stats,
        "regression": reg_stats,
        "modis_validation": modis_stats
    }
    with open(CONFIG["summary_json"], "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    logging.info(f"Saved summary statistics to {CONFIG['summary_json']}")


if __name__ == "__main__":
    main()
