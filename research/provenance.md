# Provenance

## Sources

| Data | Version and access | Licence | Used for |
| :--- | :--- | :--- | :--- |
| Landsat 7 ETM+, 8 OLI/TIRS, 9 OLI-2/TIRS-2 Collection 2 Level 2 | Microsoft Planetary Computer STAC, collection `landsat-c2-l2` (thermal `lwir` / `lwir11`, `qa`, `qa_pixel`, red, NIR, SWIR1) | USGS, public domain | Pixel LST, SUHI, NDVI, NDBI, 2000–2025 |
| Landsat 4–9 Collection 2 Level 2 | Google Earth Engine (`scripts/extract_change_gee.py`) | USGS, public domain | Per-LGA per-pass records in `docs/data/lagos_change_*.csv` |
| Sentinel-2 L2A, MODIS MOD11A2, Copernicus GLO-30 | Google Earth Engine (`scripts/extract_data_gee.js`) | Copernicus open licence; NASA open data | LGA statistics, 2022–2024 |
| ESA WorldCover 2021 v200 | Planetary Computer `esa-worldcover`; Zanaga et al. (2022), doi:10.5281/zenodo.7254221 | CC BY 4.0 | Land cover map, countryside reference, water mask. Overall accuracy 76.7% globally and 76.5% for Africa (product validation report v2.0) |
| WorldPop 2020, 100 m, unconstrained | `data.worldpop.org`, `nga_ppp_2020.tif` | CC BY 4.0 | Population and exposure (a modelled estimate) |
| GHSL P2023A built-up surface and population | Google Earth Engine | European Commission, CC BY 4.0 | Built-up change, 1995–2020 |
| FAO GAUL 2015, level 2 | Google Earth Engine | FAO GAUL licence (non-commercial) | LGA boundaries |
| Natural Earth 1:50m admin-0 countries v5.1.2 | github.com/nvkelso/natural-earth-vector | Public domain | Locator inset (`research/locator_countries.geojson`) |

## Processing rules (pixel rasters)

`scripts/pc_build_rasters.py`, values in `research/rasters/meta.json`:

- Dry seasons December to March, scenes under 70% cloud, Landsat 7, 8 and 9, WRS paths covering Lagos.
- Clear pixel: QA_PIXEL not fill, dilated cloud, cirrus, cloud or shadow; ST_QA at most 4 K.
- ST = DN × 0.00341802 + 149 K; reflectance = DN × 0.0000275 − 0.2.
- Countryside reference per pass: mean LST of clear reference cells; a pass needs at least 6,750
  clear reference cells at 60 m (equal to 3,000 at 90 m).
- A pass is rejected when more than 5% of built-up Lagos land (180 m blocks) is over 3 °C colder
  than the reference (cloud or fog the mask missed), or when no LGA is at least half clear.
- Periods: 2000–2012 Landsat 7, 2013–2019 Landsat 8, 2020–2025 Landsat 8 and 9. Landsat 7
  passes after 2012 are kept only for the sensor comparison.

## Map registry

All maps are written by `scripts/render_maps.py` to `docs/assets/maps/`, drawn in WGS 84 / UTM
zone 31N with a scale bar, north arrow, graticule, LGA boundaries, legend with units, no-data and
water keys, locator inset and source line.

| Map | Content | Inputs |
| :--- | :--- | :--- |
| m01_reference | LGAs and countryside reference | GAUL, `reference_mask.tif` |
| m02_landcover | Land cover 2021 with class shares | `worldcover_2021.tif` |
| m03_lst | LST, 2020–2025 | `2020-2025_lst_median.tif` |
| m04_suhi | SUHI, 2020–2025 | `2020-2025_suhi_median.tif` |
| m05_ndvi | NDVI, 2020–2025 | `2020-2025_ndvi_median.tif` |
| m06_ndbi | NDBI, 2020–2025 | `2020-2025_ndbi_median.tif` |
| m07_suhi_periods | SUHI in three periods | `{period}_suhi_median.tif` |
| m08_ndvi_periods | NDVI in three periods | `{period}_ndvi_median.tif` |
| m09_coverage | Clear passes per cell, three periods | `{period}_count.tif` |
| m10_change | SUHI change 2000–2012 to 2020–2025 | period medians and counts |
| m11_uncertainty | SUHI interquartile range, 2020–2025 | `2020-2025_suhi_iqr.tif` |
| m12_population | Population density 2020 | `population_2020.tif` |
| m13_hotspots | Gi* hot and cold spots, FDR 0.05 | `hotspots_2020-2025.tif`, `map_analysis.json` |
| m14_ndvi_heat | NDVI × SUHI terciles | `bivariate_2020-2025.tif`, `map_analysis.json` |
| m15_exposure | Residents by SUHI class per LGA (chart) | `map_analysis.json` |
| m16_ndvi_change | NDVI change 2000–2012 to 2020–2025 | period medians and counts |
