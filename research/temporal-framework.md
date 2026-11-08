# Temporal framework assessment: 2000–2025

8 November 2026. Evidence: `docs/data/lagos_change_scenes.csv` (every dry-season Landsat pass the pipeline examined, kept or rejected) and `scripts/epoch_framework.py`, which reruns the published change analysis, unchanged, under different period schemes. Results: `research/epoch_framework.json`. No new Earth Engine processing was done.

## 1. What the archive holds (current pipeline rules)

| Epoch (proposed in the brief) | Passes examined | Clear passes kept | Sensors of kept passes |
|---|---|---|---|
| 2000–2005 | 29 | 5 | Landsat 7 |
| 2006–2012 | 56 | 6 | Landsat 7 (SLC-off) |
| 2013–2019 | 94 | 7 | Landsat 8 |
| 2020–2025 | 153 | 6 | Landsat 8 (5), Landsat 9 (1) |

- Each kept pass sees on average 9 to 10 of the 20 LGAs clearly; no pass sees all of them.
- Dry seasons 2021, 2022 and 2023 have no kept pass.
- The pipeline examined Landsat 7 only up to 2013 (`extract_change_gee.py` uses Landsat 8/9 only from 2014). No Landsat 7 pass after 2013 was kept, so there is **no overlap period** in which Landsat 7 and Landsat 8 can be compared.
- Landsat 5 TM contributes nothing after 1999 over Lagos: the Tier-1 collection queried (scenes under 70% cloud) holds Landsat 5 dry-season passes over Lagos only for 1985–1987 and one in 1999, which was rejected. Why the archive is empty after 1999 was not investigated here.

## 2. The change result under three period schemes

| Scheme | LGAs seen clearly in every period | Change, first to last period, °C (95% interval) | LGAs with a clear rise |
|---|---|---|---|
| Published: 1985–2003, 2004–2013, 2014–2026 | 17 | +1.74 (+0.62 to +2.53) | 4 of 17 (Alimosho, Apapa, Eti-Osa, Ikorodu) |
| Brief: 2000–2005, 2006–2012, 2013–2019, 2020–2025 | 6 | +2.25 (−1.49 to +5.10) | 0 of 7 |
| One sensor per period: 2000–2012, 2013–2019, 2020–2025 | 10 | +0.81 (−2.09 to +3.32) | 1 of 12 (Ikorodu) |

Interpretation:

1. **The published statewide rise depends on the 1985 and 1991 passes.** Restricted to 2000–2025, the same passes and the same method give no statistically clear statewide change.
2. **More epochs make it worse, not better.** Four epochs of 5 to 7 passes leave only 6 LGAs seen clearly in all four, so the comparison covers a small, mostly inner-city group.
3. **Sensor and epoch are confounded in every scheme.** In the brief's scheme the switch from Landsat 7 to Landsat 8 coincides exactly with the 2012/2013 boundary; in the one-sensor scheme it is the boundary by design. Without an overlap test, change across that boundary cannot be separated from a sensor offset.
4. The group of LGAs differs between schemes (17, 6, 10), so the period values are **not comparable across schemes**; only changes within one scheme are meaningful.

## 3. Recommended framework

- **Study period 2000–2025**, three periods aligned to sensors: 2000–2012 (Landsat 7), 2013–2019 (Landsat 8), 2020–2025 (Landsat 8 and 9). The brief's four epochs are not supported by the number of clear passes.
- **Report the period values with the number of passes and LGAs behind each,** and state plainly that, on current evidence, the statewide change is not distinguishable from zero; only Ikorodu shows a clear rise.
- **Before publishing a change estimate, run one new export** (Earth Engine) that:
  1. adds Landsat 7 passes for 2013–2021, so Landsat 7 and Landsat 8 can be compared in the same dry seasons and a sensor offset estimated;
  2. records each pass's acquisition time, so overpass-time differences can be quantified;
  3. tests sensitivity of the kept set to the cold-anomaly cap (3%, 5%, 8%) and the minimum reference coverage, since these rules decide which passes count;
  4. adds a second reference mask defined from GHSL 2000 (land unbuilt in 2000, not 2020), to check whether urban growth into the countryside reference changes the result;
  5. exports per-pass, per-LGA clear-pixel counts, so each LGA value carries its sample size.
- **Distinguish clearly** on the site: single-pass observations (each pass), multi-year composites (each period's median), and none of the values as annual or continuous. No interpolation between periods.

## 4. Status of the published numbers

| Published figure | Reproduced? | Under 2000–2025 |
|---|---|---|
| 8.4 °C gap between hottest and coolest LGA (2022–2024 Landsat 8/9 median) | Yes: `analyze_uhi.py` reproduces `summary.json` (tests pass) | Unaffected (contemporary) |
| +1.7 °C statewide heat-island change | Yes, for the published scheme | Not reproduced: +0.8 °C (−2.1 to +3.3) |
| 26% to 42% of land more than 3 °C above the countryside | Pixel-level, from the Earth Engine export; not recomputable offline | Needs the new export |

The 2015–2024 project report (Landsat 8/9 single-year composites for 2015, 2019 and 2024) is not used: its rasters and training data are not in the repository, it compares absolute temperatures of three single dry seasons (which mixes weather with change), and it states Landsat 9 data for 2015, before Landsat 9's launch in September 2021.
