# 1. Install Geospatial Libraries in Cloud Session
!pip install -q geopandas libpysal esda statsmodels scipy

import numpy as np
import pandas as pd
import geopandas as gpd
import libpysal
from esda.getisord import G_Local
from statsmodels.stats.multitest import multipletests
from scipy.stats import pearsonr
import statsmodels.api as sm
from google.colab import files

print("1. Loading GEE-exported Lagos dataset...")
gdf = gpd.read_file("lagos_wards_raw.geojson")

# Standardize administrative unit name column (ADM2_NAME is FAO GAUL's column)
for col in ['ADM2_NAME', 'ward_name', 'WardName', 'WARD_NAME', 'adm3_en', 'name', 'NAME']:
    if col in gdf.columns:
        gdf['ward_name'] = gdf[col].astype(str)
        break
if 'ward_name' not in gdf.columns:
    gdf['ward_name'] = [f"Lagos Zone {i+1}" for i in range(len(gdf))]

# Drop missing rows and project to UTM Zone 31N (EPSG:32631) for meter-accurate geometry
gdf = gdf.dropna(subset=['mean_lst', 'population']).copy()
gdf_utm = gdf.to_crs("EPSG:32631")

# 2. Cross-Sensor Validation & Covariate OLS Check
if 'modis_lst' in gdf_utm.columns:
    valid_sub = gdf_utm.dropna(subset=['mean_lst', 'modis_lst'])
    r_val, p_val = pearsonr(valid_sub['mean_lst'], valid_sub['modis_lst'])
    print(f"   [Validation] Landsat 30m vs MODIS 1km LST Pearson r = {r_val:.3f} (p = {p_val:.4e})")

if {'ndvi', 'ndbi', 'elevation'}.issubset(gdf_utm.columns):
    reg_df = gdf_utm[['mean_lst', 'ndvi', 'ndbi', 'elevation']].dropna()
    X = sm.add_constant(reg_df[['ndvi', 'ndbi', 'elevation']])
    ols_model = sm.OLS(reg_df['mean_lst'], X).fit()
    print(f"   [Covariate Check] OLS R-squared (NDVI + NDBI + DEM) = {ols_model.rsquared:.3f}")

# 3. Compute Population Density & Strictly Bounded [0, 1] Heat Exposure Index
print("2. Computing Population Density and Min-Max Normalized Heat Exposure Index...")
gdf_utm['lst_zscore'] = (gdf_utm['mean_lst'] - gdf_utm['mean_lst'].mean()) / gdf_utm['mean_lst'].std()

area_sqkm = gdf_utm.geometry.area / 1_000_000
gdf_utm['pop_density'] = gdf_utm['population'] / area_sqkm

lst_min, lst_max = gdf_utm['mean_lst'].min(), gdf_utm['mean_lst'].max()
gdf_utm['lst_norm'] = (gdf_utm['mean_lst'] - lst_min) / (lst_max - lst_min)

pop_log = np.log1p(gdf_utm['pop_density'])
p_min, p_max = pop_log.min(), pop_log.max()
gdf_utm['pop_density_norm'] = (pop_log - p_min) / (p_max - p_min)

gdf_utm['heat_exposure_index'] = gdf_utm['lst_norm'] * gdf_utm['pop_density_norm']
top_quartile_pop = gdf_utm['pop_density'].quantile(0.75)

# 4. Run KNN Spatial Weights & Getis-Ord Gi* Sensitivity Loop (k = 3, 5, 8)
print("3. Running KNN spatial weights & Getis-Ord Gi* sensitivity loop...")
y = gdf_utm['mean_lst'].values

for k in [3, 5, 8]:
    w = libpysal.weights.KNN.from_dataframe(gdf_utm, k=k)
    w.transform = 'R'
    
    g_local = G_Local(y, w, transform='R', star=True)
    gdf_utm[f'gi_zscore_k{k}'] = g_local.Zs
    
    p_two_sided = 2.0 * g_local.p_norm
    gdf_utm[f'gi_pvalue_k{k}'] = p_two_sided
    
    fdr_rej, fdr_pcorr, _, _ = multipletests(p_two_sided, alpha=0.05, method='fdr_bh')
    gdf_utm[f'fdr_sig_k{k}'] = fdr_rej
    print(f"   -> Sensitivity k={k}: {fdr_rej.sum()} units significant after Benjamini-Hochberg FDR.")

# 5. Lock Primary Model (k=5) and Classify Priority Cooling Zones
gdf_utm['gi_zscore'] = gdf_utm['gi_zscore_k5']
gdf_utm['fdr_significant'] = gdf_utm['fdr_sig_k5']

def classify_units(row):
    is_hotspot = bool(row['fdr_significant']) and (row['gi_zscore'] > 0)
    is_dense = row['pop_density'] >= top_quartile_pop
    if is_hotspot and is_dense:
        return 'Priority Cooling Zone'
    elif is_hotspot:
        return 'Significant Heat Hotspot'
    elif bool(row['fdr_significant']) and (row['gi_zscore'] < 0):
        return 'Thermal Refugium'
    else:
        return 'Not Significant'

gdf_utm['hotspot_category'] = gdf_utm.apply(classify_units, axis=1)

# 6. Reproject to WGS84 (EPSG:4326) for Leaflet Web Rendering
print("4. Exporting web-ready GeoJSON in EPSG:4326...")
keep_cols = [
    'ward_name', 'mean_lst', 'modis_lst', 'ndvi', 'ndbi', 'elevation', 'slope',
    'pop_density', 'lst_zscore', 'heat_exposure_index',
    'gi_zscore_k3', 'gi_zscore_k5', 'gi_zscore_k8',
    'fdr_sig_k3', 'fdr_sig_k5', 'fdr_sig_k8',
    'gi_zscore', 'fdr_significant', 'hotspot_category', 'geometry'
]
final_cols = [c for c in keep_cols if c in gdf_utm.columns]
gdf_web = gdf_utm[final_cols].to_crs("EPSG:4326")

output_filename = "lagos_uhi_processed.geojson"
gdf_web.to_file(output_filename, driver="GeoJSON")
files.download(output_filename)
print("Done! File downloaded.")
