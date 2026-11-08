# Lagos Urban Heat & Exposure Analytics

Dry-season land surface temperature, hot spots and population heat exposure across the
20 Local Government Areas (LGAs) of Lagos State, Nigeria, and how the city's surface heat
island has changed over four decades (1985–2026).

**Live site:** https://oloyededavid.github.io/Lagos-Urban-Heat-Analytics/

The site has a map with six layers (surface temperature, hot and cold spots, heat exposure,
vegetation, population density, and the heat island over time, with a period slider, play and a
then-and-now swipe). It also has a plain-language overview, a four-decade change view with a heat
strip for every LGA, a page for each LGA, a "what explains the heat" panel, the full statistical
audit and rankings. A guided tour and a
glossary come with it, and you can download the data, the map and the charts.

## What the data shows

All numbers come from one Google Earth Engine export (script v2.0.0), covering the dry seasons
(December–March) of 2022/23 and 2023/24. The scenes used were 113 Landsat, 150 Sentinel-2 and
32 MODIS.

| Finding | Result |
| :--- | :--- |
| Surface temperature | Mean 37.4 °C. LGA averages range from 31.8 °C (Epe) to 40.1 °C (Ajeromi/Ifelodun). |
| Clustering | Hot LGAs sit next to each other: Moran's I = 0.53 with Queen contiguity and 0.37 with 5 nearest neighbours (permutation p = 0.002 for both). |
| Hot spots | No single LGA is a significant hot or cold spot after false discovery rate correction. The clustering is a broad pattern, not isolated spots. |
| Vegetation | Alone, every +0.1 of NDVI goes with surfaces about 1.7 °C cooler (R² = 0.94). |
| Vegetation vs built-up | NDVI and NDBI are almost mirror images (r = −0.97, VIF = 15.5). Allowing for built-up density, NDVI's effect falls to −0.4 °C per +0.1 and its 95% interval includes zero. The data cannot separate the cooling from trees from the absence of concrete. |
| Sensor check | MODIS (1 km) ranks the LGAs almost the same as Landsat (Spearman ρ = 0.97), but reads about 5.4 °C cooler. |
| Exposure | Heat meets the most people in Ajeromi/Ifelodun, Mushin, Agege, Shomolu and Surulere. |

These are cross-sectional associations across 20 large areas, not causes or forecasts.

### Four decades of change (1985–2026)

The heat island is how much hotter an LGA's ground is than a fixed patch of countryside around
Lagos, measured within the same satellite pass. Of 374 dry-season Landsat passes from 1985 to
2026, 28 passed the cloud, fog and coverage checks. Clear dry-season mornings over coastal Lagos
are rare. The periods follow the Landsat sensor generations.

| Finding | Result |
| :--- | :--- |
| Lagos heat island | +2.1 °C (1985–2003), +3.7 °C (2004–2013), +3.9 °C (2014–2026), area-weighted over the 17 LGAs with enough clear passes in every period |
| Change | +1.7 °C from 1985–2003 to 2014–2026 (95% interval +0.6 to +2.5 °C) |
| Land running hot | The share of Lagos land more than 3 °C above the countryside rose from 26% to 42% |
| Where it grew | On the edges of the city: Ikorodu +3.3 °C, Alimosho +2.9, Eti-Osa +2.4, Apapa +2.3. Ikorodu also has a significant trend across all seasons after FDR correction. The dense core (Surulere, Mushin, Agege) was already about +6–7 °C in 1985–2003 and shows no clear change. |
| Urbanisation | LGAs whose built-up share grew most also warmed most: about +1.2 °C per 10 percentage points of land newly built up (95% interval +0.4 to +2.1, p = 0.009, 17 LGAs; GHSL 1995 to 2020). The link rests on Alimosho, Ikorodu and Eti-Osa, which urbanised most; without them it disappears (−0.6 °C per 10 points, 95% interval −3.9 to +2.8) |

## Data and methods

| Layer | Source |
| :--- | :--- |
| LGA boundaries | FAO GAUL 2015, level 2. Stray line fragments are removed on ingest. |
| Land surface temperature | Landsat 8/9 C2 L2 `ST_B10`, masked for cloud and shadow, land only, dry-season median |
| Cross-check | MODIS Terra MOD11A2 day LST, 1 km |
| Vegetation, built-up, water mask | Sentinel-2 SR: NDVI, NDBI, MNDWI (open water excluded) |
| Terrain | Copernicus GLO-30 DEM: elevation and slope |
| Population | WorldPop 2020, 100 m; density is people per km² of land |
| Four-decade heat island | Landsat 4, 5, 7, 8 and 9 C2 L2 surface temperature, every dry-season pass 1985–2026 (`scripts/extract_change_gee.py`) |
| Rural reference, built-up history | EU Global Human Settlement Layer (GHSL P2023A) built-up surface and population, 1975–2020; JRC Global Surface Water for the land mask |

The statistics are computed in `scripts/analyze_uhi.py`:

- **Clustering:** global Moran's I with Queen contiguity and k-nearest-neighbour weights (k = 3, 5, 8), 999 permutations.
- **Hot spots:** Getis-Ord Gi* with two-sided p-values and Benjamini–Hochberg false discovery rate control. An LGA counts as stable across k only if its z-score keeps the same sign for all three values of k.
- **Heat exposure index:** the min–max scaled temperature multiplied by the scaled log population density, with a rank-based check.
- **Regressions:** OLS with 95% confidence intervals, VIF, a leave-one-out check and residual Moran's I.
- **Sensor agreement:** Landsat–MODIS Spearman and Pearson correlation, mean difference and RMSE.

The four-decade change is computed in `scripts/extract_change_gee.py` (Earth Engine) and
`scripts/analyze_change.py`:

- **Unit of measurement:** the Landsat frames of one orbit on one day are joined into one pass. Each LGA's heat island in a pass is its mean land temperature minus the mean of the rural reference in the same pass. The reference is land within 20 km of Lagos State that GHSL shows as essentially unbuilt in 2020.
- **Quality checks:** a pass needs at least 3,000 clear reference pixels (about 100 km²). It is rejected if more than 5% of Lagos land reads over 3 °C colder than the countryside, which signals cloud or fog the cloud mask missed. An LGA counts in a pass only if half of its land is clear. Every pass considered, with its checks, is in `docs/data/lagos_change_scenes.csv`.
- **Periods and intervals:** each period value is the median across passes, with a bootstrap 95% interval. An LGA with fewer than 3 clear passes in a period is shown but gets no interval or verdict. The Lagos-wide interval resamples whole passes.
- **Trend:** a Theil–Sen slope across dry seasons, with a Mann–Kendall test and Benjamini–Hochberg FDR across the 18 LGAs with at least eight clear dry seasons.
- **Urbanisation test:** OLS across LGAs of heat-island change on GHSL built-up change, with a 95% interval.

### Limitations

- **Sample size:** with only 20 LGAs, statistical power is low.
- **Scale:** LGA averages hide variation within each LGA. This is the ecological fallacy and the modifiable areal unit problem.
- **Season:** only the dry season is covered.
- **Surface vs air:** land surface temperature is measured at the morning overpass and is not air temperature.
- **Data age:** population is from 2020 and boundaries from 2015.
- **Change record:** the Landsat archive for West Africa is empty from 1992 to 1999 and thin before that, so the first period rests on 6 passes. Landsat 4, 5 and 7 passed over earlier in the morning than Landsat 8 and 9, when the heat island is weaker, so part of the change may come from the sensors. The countryside reference may itself have changed (farming, forest loss), which would make the heat island look smaller, not larger. GHSL 2020 stands in for the latest built-up area.

## Reproduce

1. **Export.** Run `scripts/extract_data_gee.js` in the Earth Engine Code Editor and run the
   `lagos_lgas_raw` export task. Then download `lagos_lgas_raw.geojson` from Google Drive.
2. **Install and analyse.** This validates the export, writes
   `docs/data/lagos_uhi_processed.geojson` and regenerates `docs/data/summary.json`:

   ```bash
   pip install -r requirements.txt
   python scripts/ingest_gee_export.py path/to/lagos_lgas_raw.geojson
   ```

3. **Test.**

   ```bash
   pip install -r requirements-dev.txt
   pytest
   ```

   The tests also check that the published summary matches what the script produces from the
   published data.
4. **Four-decade change (optional).** This needs an Earth Engine account and runs as batch
   exports in your Earth Engine project, which take about an hour or two:

   ```bash
   pip install -r requirements-gee.txt
   earthengine authenticate
   python scripts/extract_change_gee.py --project YOUR-CLOUD-PROJECT
   python scripts/analyze_change.py
   ```

5. **View the site locally.**

   ```bash
   python -m http.server -d docs 8000
   ```

## Repository layout

```
docs/                 website (GitHub Pages)
  index.html          study page (figures drawn by assets/app.js from the JSON summaries)
  explore.html        interactive explorer
  assets/             page script, stylesheet and explorer preview
  data/               processed GeoJSON, statistical summaries, four-decade change data
    maps/             heat-island maps for each period (PNG)
  vendor/             Leaflet 1.9.4 and Chart.js 4.4.1
scripts/
  extract_data_gee.js     Earth Engine export
  ingest_gee_export.py    validation and installation
  analyze_uhi.py          statistics
  extract_change_gee.py   four-decade heat-island extraction (Earth Engine, Python)
  analyze_change.py       four-decade change statistics
tests/
```

## Licence and citation

- **Code:** MIT (`LICENSE`).
- **Derived data and figures:** CC BY 4.0 (`LICENSE-DATA.md`). Source datasets keep their own terms.
- **Citation:** see `CITATION.cff`.

Research, analysis and design by David Oloyede.
