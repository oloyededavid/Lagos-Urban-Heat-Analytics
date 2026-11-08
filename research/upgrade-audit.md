# Upgrade audit: Lagos Urban Heat Analytics

Phase 1 and the assessment part of Phase 2 of the Master Feedback and Upgrade Sheet. 8 November 2026. Nothing has been changed on the live site.

## 1. What the repository holds

| Output | Level | Source script | Status |
|---|---|---|---|
| `lagos_uhi_processed.geojson`: LST, MODIS LST, NDVI, NDBI, population, density, elevation, slope, Gi* (k = 3, 5, 8), exposure index per LGA | 20 LGAs | `extract_data_gee.js`, `ingest_gee_export.py`, `analyze_uhi.py` | Verified: tests rerun the statistics and match `summary.json`. |
| `summary.json`: Moran's I, Gi*, regressions, VIF, Landsat-MODIS agreement, exposure ranking | 20 LGAs | `analyze_uhi.py` | Verified. |
| `lagos_change_lga.csv`: heat island per LGA per usable pass | 255 LGA-pass values | `extract_change_gee.py` | Verified. |
| `lagos_change_scenes.csv`: every pass considered (374), kept or rejected and why | passes | `extract_change_gee.py` | Verified. |
| `lagos_ghsl.csv`: GHSL built-up share and population per LGA, 1975-2020 (9 epochs) | 20 LGAs | `extract_change_gee.py` | Verified. |
| `change_summary.json`: period values, change, trends, urbanisation link and leverage check | 20 LGAs | `analyze_change.py` | Verified; regenerated today, identical. |
| `maps/suhi_<period>.png`: heat island per 90 m pixel, three periods, common colour scale | pixels | `extract_change_gee.py` | The only pixel-level outputs. |

**There are no pixel-level rasters of contemporary LST, NDVI, NDBI, land cover or population**, no true-colour satellite image and no land-cover classification. Everything contemporary was exported as LGA averages only.

## 2. Findings that change the presentation

1. **The historical record is sparse.** Only 23 of 42 dry seasons (1985-2026) have a usable pass. The "1985-2003" period rests on six passes: 1985, 1991, and four Landsat 7 passes from 2000-2003. It mainly describes the early 2000s. The current title "Four decades of the surface heat island" overstates this. Recommendation: keep the analysis, retitle (for example "The Lagos surface heat island from the 1980s to today: what 28 clear mornings show"), and show the pass timeline as a figure so readers see the gaps.
2. **The urbanisation link depends on three LGAs** (Alimosho, Ikorodu, Eti-Osa); without them it disappears. Already stated on the page; must stay prominent.
3. **No individual LGA is a significant hot or cold spot after FDR correction.** Must be preserved; Gi* maps will show z-scores with this stated, not imply hot spots.
4. **Vegetation and built-up density cannot be separated** (r = -0.97, VIF 15.5). NDVI and NDBI maps must be presented as one story, not two independent effects.

## 3. Data-loading issue

The latest commit (`f32a469`) built and deployed successfully on GitHub Pages, and the site loads its data locally without errors. The live site cannot be opened from this cloud session (github.io is not on the environment's network list). **Needed from you:** what you saw (page, message, browser), or approval to allow `oloyededavid.github.io` so the live deployment can be tested directly.

## 4. Map inventory (M01-M18)

Legend: **Exists** = already in repo. **Build** = can be made now from repo data. **Export** = needs a new Earth Engine export (script written by Claude, run with your Google account). **Not defensible** = would require data that does not exist; replaced as noted.

| ID | Map | Status | How |
|---|---|---|---|
| M01 | Location map | Build | Natural Earth country outlines (public domain) + LGA boundaries. |
| M02 | LGA boundaries | Build | GAUL 2015 LGAs with names and land area. |
| M03 | Satellite image | Export | Sentinel-2 dry-season true-colour composite (cloud-masked median), 10-20 m. |
| M04 | Contemporary LST | Export (Build at LGA level now) | Pixel LST from the same Landsat 8/9 dry-season median already used for LGA means. |
| M05 | NDVI | Export (Build at LGA level now) | Sentinel-2 NDVI median, as in the current method. |
| M06 | NDBI | Export (Build at LGA level now) | Sentinel-2 NDBI median. |
| M07 | Land cover | Export | ESA WorldCover 2021 (10 m, published accuracy assessment). An existing validated product, cited as such, not a new classification. |
| M08 | Historical heat-island maps | Exists | Three period maps, common scale. Present as a comparison slider and small multiples. |
| M09 | Historical NDVI | Export | Landsat NDVI from the same usable passes per period. Sensor differences (Landsat 4/5/7 vs 8/9) must be documented. |
| M10 | Historical land cover | Not defensible as full land cover | No comparable, validated historical classification exists. Replaced by **built-up expansion** from GHSL 1985-2020 (consistent product): Build at LGA level now, Export for a pixel map. |
| M11 | Heat-island intensity | Exists (pixel) / Build (LGA) | Period maps plus LGA choropleth. |
| M12 | Population | Build (LGA density) / Export (WorldPop 100 m pixels) | |
| M13 | Population and heat overlap | Build (LGA bivariate map) / Export (pixel) | Bivariate colour map, temperature × density. |
| M14 | LGA temperature map | Build | Choropleth of LGA mean LST. |
| M15 | Global autocorrelation visual | Build | Moran scatterplot with the LGA map linked. |
| M16 | Local Gi* map | Build | z-scores with the FDR result stated (none significant). |
| M17 | Landsat-MODIS comparison | Build | Difference map per LGA + scatter. |
| M18 | Relationship maps | Build | Small multiples LST / NDVI / NDBI at LGA level; pixel versions after export. |

Summary: **10 maps can be built now** from repository data (M01, M02, M08, M11, M12, M13, M14, M15, M16, M17, M18 at LGA level). **6 need one Earth Engine export** (M03, M04-M06 pixels, M07, M09, plus pixel versions of M10, M12, M13). **M10 as full land-cover change is not defensible** and is replaced by built-up expansion.

## 5. Figure inventory (F01-F14)

| ID | Figure | Status |
|---|---|---|
| F01 | Method workflow | Build (diagram from the scripts' actual steps). |
| F02 | Dataset and temporal coverage | Build: a timeline of all 374 passes by sensor, kept vs rejected, showing the 1992-1998 gap. |
| F03 | Land-cover composition | Export (WorldCover per LGA). |
| F04 | LST distribution | Build (LGA strip/box plot); pixel histogram after export. |
| F05 | Historical comparison | Build (period estimates with intervals; per-season values per LGA). |
| F06 | NDVI-LST | Build (scatter with fit and interval). |
| F07 | NDBI-LST | Build. |
| F08 | LGA temperature distribution | Build (ranked dot plot). |
| F09 | Population and exposure | Build (exposure ranking and its two components). |
| F10 | Moran's I | Build (Moran scatterplot, permutation distribution). |
| F11 | Local clustering | Build (Gi* z by LGA for k = 3, 5, 8, FDR threshold marked). |
| F12 | Landsat-MODIS | Build (scatter with 1:1 line, mean offset). |
| F13 | Historical land-cover transition | Replaced by built-up trajectory per LGA, GHSL 1975-2020 (Build). A Sankey diagram would need comparable classes in each period, which do not exist. |
| F14 | Synthesis diagram | Build. |

## 6. Additional analyses (Section 6 of the sheet)

| | Analysis | Verdict | Notes |
|---|---|---|---|
| A | Land-cover transitions | Partial | Built-up expansion only (GHSL). Full transition matrix not defensible. |
| B | Vegetation-temperature | Yes | Exists at LGA level; pixel-level after export, with spatial-autocorrelation-aware interpretation. |
| C | Built-up expansion and heat | Yes | Exists (urbanisation link + leverage check); add maps. |
| D | Heat-island method review | Yes | Reference area documented; a sensitivity test with a different reference buffer needs an Earth Engine rerun. |
| E | Exposure | Yes, carefully | Population-weighted surface temperature per LGA can be computed from repo data. Not health risk. |
| F | Spatial clustering | Yes | Preserve the FDR result. |
| G | Sensitivity | Partial | Can do now from repo data: mean vs median of passes, leave-one-pass-out, effect of the minimum-pass rule. Reference-area and resolution sensitivity need Earth Engine. |

## 7. Design (decided 8 November 2026)

Same structure, type (Satoshi, Zodiak) and light layout as the Oueme-Ogun paper. No dark mode on the page or in the explorer. Blue is the interface colour (header, links, buttons). Maps and figures keep data colour scales: orange heat scale for temperature, heat island and exposure, green for vegetation, grey for built-up density, blue-to-red for hot-spot scores. The heat-island period maps appear once. Fewer numbers; each finding has a map.

## 8. Decisions needed

1. **Earth Engine export:** will you run one script in the Earth Engine Code Editor (about 30-60 minutes of processing, results to Google Drive) so the pixel maps can be made? Without it, the maps stay at LGA level, plus the three historical heat-island maps.
2. **Land cover:** use ESA WorldCover 2021 as a cited, validated product (yes/no).
3. **Live site:** what did the data-loading problem look like, or allow `oloyededavid.github.io` for testing.

## 9. Independent review, 8 November 2026

Three reviewers who did not build the page (UI/UX critic, QA agent, cartography and remote sensing reviewer) checked the published version. Fixed without new data: unsupported claims ("inner city changed little", "heat has spread outwards", "too strong to be chance", the policy sentence), the 17-LGA scope of the headline figure, abstract rounding, colour meaning in every caption, hot-spot scale (fixed at +/-2, hot is orange and cool is blue, as in Figure 6), hatching for LGAs that cannot be tested, scale bar and north arrow, labels on large LGAs, "built-up density" renamed built-up index, phone layout for the period maps, header Explorer link, one keyboard stop per map, dark-mode and continuous-coverage wording in the explorer.

Not fixable without new analysis (needs an Earth Engine rerun or new data):
1. Landsat 7 / Landsat 8 overlap test, and a within-sensor change estimate, to separate city change from sensor change.
2. Sensitivity of the heat-island result to the cold-anomaly cap (5%), the reference buffer (20 km) and the minimum clear-pass rule; a common-footprint version of the period maps.
3. The same QA masks (ST_QA, cirrus) in the contemporary temperature map, per-LGA clear-observation counts, and an explanation or bound for the 5.4 C Landsat-MODIS offset.
4. Population-weighted surface temperature and people above a temperature threshold (needs pixel temperature).
5. GHSL epoch matched to the temperature epoch; inclusion of Epe, Ibeju Lekki and Kosofe (44% of land) in the change analysis.
6. Sea and lagoon mask for the LGA polygons used in the maps.
7. Validation of surface temperature against ground measurements.
