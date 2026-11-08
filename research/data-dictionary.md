# Data dictionary

Units: temperatures in °C; SUHI (surface urban heat island) is LGA or cell land surface
temperature minus the mean of the countryside reference in the same satellite pass. Areas in km².
Seasons are named by the year in which the dry season ends (season 2024 = December 2023 to
March 2024).

## Published files (`docs/data/`)

### `lagos_uhi_processed.geojson`
One feature per LGA (20), geometry from FAO GAUL 2015 level 2. Earth Engine export, dry seasons
2022/23 and 2023/24.

| Field | Meaning |
| :--- | :--- |
| `lga_name`, `lga_code` | Name and GAUL code |
| `area_km2`, `land_area_km2` | Total and land area |
| `population`, `pop_density` | WorldPop 2020 people; people per km² of land |
| `mean_lst`, `modis_lst` | Landsat 8/9 and MODIS dry-season mean land surface temperature |
| `ndvi`, `ndbi` | Sentinel-2 dry-season median indices |
| `elevation`, `slope` | Copernicus GLO-30 means (m, degrees) |
| `landsat_scenes`, `s2_scenes`, `modis_images` | Images used |
| `gi_zscore_k{3,5,8}`, `gi_pvalue_k{3,5,8}`, `fdr_sig_k{3,5,8}` | Getis-Ord Gi* per LGA for k nearest neighbours, with FDR result |
| `gi_zscore`, `gi_pvalue`, `fdr_significant`, `k_stable`, `hotspot_category` | Gi* at k = 5 and whether the sign is stable across k |
| `hei`, `hei_rank` | Heat exposure index (scaled LST × scaled log density) and rank |
| `period`, `export_utc`, `script_version`, `data_status` | Provenance |

### `summary.json`
Statistics from `scripts/analyze_uhi.py` on the file above: `lst`, `spatial_autocorrelation`,
`heat_exposure`, `regression`, `sensor_agreement`, `key_findings`, `provenance`.

### `change_summary_2000_2025.json`
From `scripts/analyze_change_2000_2025.py`, using the published passes in `lagos_change_lga.csv`.

| Key | Meaning |
| :--- | :--- |
| `periods[]` | Period label, years and sensors |
| `state[period]` | Area-weighted SUHI over LGAs observed in every period, bootstrap 95% interval, passes |
| `state_change` | First to last period change, interval, number of LGAs |
| `lgas[name].periods[period]` | Median SUHI, interval, passes |
| `lgas[name].change` | Change with interval and verdict (Warmed, Cooled, No clear change); `null` when untestable |
| `lgas[name].trend` | Theil–Sen slope per decade, Mann–Kendall p, FDR result; `null` with too few seasons |
| `urbanisation` | Regression of SUHI change on GHSL built-up change, and the test without the most-built LGAs |

### `lagos_change_scenes.csv`, `lagos_change_lga.csv`, `lagos_ghsl.csv`
Earth Engine per-pass records (one row per pass; one row per LGA per pass) and GHSL built-up
and population per LGA per epoch. Columns are named in the first row; `used` and `reason` record
the quality checks.

### `map_analysis.json`
From `scripts/map_analysis.py` on the 2020–2025 rasters.

| Key | Meaning |
| :--- | :--- |
| `hotspots` | Gi* cell size, neighbour radius, FDR level, counts of hot, cold and not-significant cells |
| `bivariate` | NDVI and SUHI tercile breaks, share of cells per class (`"ij"`: SUHI tercile i, NDVI tercile j, 0 = low), cell rank correlation |
| `exposure` | WorldPop people by SUHI class, state-wide (`state`) and per LGA (`lga`), and people in cells without enough clear passes (`unobserved`) |
| `sensor_offset` | Landsat 7 minus Landsat 8 per-LGA SUHI in the same seasons (2014–2019): median, 95% interval by season bootstrap, pairs |

### `overlays.json` and `maps/suhi_*.png`
From `scripts/web_overlays.py`. Period SUHI medians in Web Mercator for the explorer: `bounds`
(south-west and north-east corners, latitude/longitude), `stops` (value, colour), `periods[]`
(label, file, passes, sensors). Transparent where there is water, no clear observation, or land
outside Lagos State.

### `maps.json`
From `scripts/render_maps.py`: the list of printed maps and the raster metadata they were drawn from.

## Research files (`research/`)

### `pc_passes.csv`
One row per Landsat pass considered by `scripts/pc_build_rasters.py`.

| Column | Meaning |
| :--- | :--- |
| `pass_id`, `date`, `time_utc`, `season`, `platform`, `wrs_path`, `tiles` | Identity of the pass |
| `ref_pixels`, `ref_lst` | Clear countryside reference cells (60 m) and their mean LST |
| `lagos_clear_share` | Share of Lagos land that is clear |
| `cold_share` | Share of built-up Lagos land (180 m blocks) more than 3 °C colder than the reference |
| `group` | Period, or `overlap` for Landsat 7 passes after 2012 (sensor comparison only) |
| `used`, `reason` | Whether the pass entered a composite, and why not |

### `pc_lga_suhi.csv`
One row per LGA per accepted pass with at least half of the LGA clear: `clear_fraction`, `suhi`.

### `rasters/` (not committed)
60 m grid, WGS 84 / UTM zone 31N, Lagos State plus 20 km.

| File | Meaning |
| :--- | :--- |
| `{period}_lst_median.tif` | Median LST of clear passes (°C) |
| `{period}_suhi_median.tif` | Median SUHI (°C) |
| `{period}_ndvi_median.tif`, `{period}_ndbi_median.tif` | Median indices from the same passes |
| `{period}_count.tif` | Clear passes per cell |
| `{period}_suhi_iqr.tif` | Interquartile range of SUHI across passes (cells with 3 or more) |
| `worldcover_2021.tif` | ESA WorldCover 2021 class (majority of 10 m pixels) |
| `reference_mask.tif` | Countryside reference: WorldCover tree, shrub, grass, cropland, herbaceous wetland or mangrove within 20 km |
| `lagos_land.tif` | LGA number (1–20, order of the GeoJSON) on land, 0 elsewhere |
| `population_2020.tif` | WorldPop 2020 people per 60 m cell |
| `hotspots_2020-2025.tif` | Gi* class on 960 m cells: 1 cold, 2 not significant, 3 hot, 0 no data |
| `bivariate_2020-2025.tif` | 1 + 3 × SUHI tercile + NDVI tercile, 0 no data |
| `meta.json` | Grid, rules and passes per period |
