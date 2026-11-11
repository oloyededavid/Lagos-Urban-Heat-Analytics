---
title: "Surface urban heat island and distance to vegetation in Lagos State, Nigeria, 2020–2024"
author: "David Oloyede"
date: "November 2026"
---

# Abstract

We ask whether residents of Lagos State who live far from vegetation also live on hotter ground. The heat measure is the surface urban heat island (UHI): how much warmer the land surface is than the surrounding countryside, taken from Landsat satellite images from December to February, January 2020 to December 2024, at about 11:00 local time. About {{pop_total_m}} million modelled residents live on land with a vegetation value. {{beyond_pct}}% of them live more than {{access_m}} m from vegetation, and {{beyond_built_pct}}% of those live on built-up cells. Among built-up cells, the land surface where residents beyond {{access_m}} m live is {{bu_gap}} °C warmer on average than where residents within it live, or {{ex_veg_gap}} °C if vegetated cells are left out. The gap is positive in every check reported here, which does not vary the countryside reference or the {{access_m}} m distance. It ranges from {{spec_min}} to {{spec_max}} °C across the vegetation cut-offs, buffers of 0 to 120 m and population layers, and from {{lga_lo}} to {{lga_hi}} °C within single LGAs. In these ranges the vegetated cells are left out of the nearby group. Across all land-cover types the gap is {{pop_con_pooled}} to {{pooled_gap}} °C, depending on the population layer. These are cross-sectional associations. They do not show that vegetation lowers surface temperature.

**Keywords:** surface urban heat island; land surface temperature; Landsat; vegetation; Lagos; population

# 1. Introduction

Cities are warmer than the land around them. The air-temperature version of this is largest on clear, calm nights (Oke, 1982). Satellite surface temperature measures the ground surface instead, and that is the quantity used here (Voogt & Oke, 2003).

Lagos State holds about {{pop_land_m}} million modelled residents on its mapped land. Built-up land lies mainly west of the lagoon, and tree cover is concentrated in the east and along the water.

We ask two questions. How is the surface heat island spread across the population? And are residents far from vegetation on warmer built-up ground, or does the difference disappear once land cover is held fixed? A comparison across all cells mixes the two, so the main comparison is built-up cells with built-up cells. We do not analyse change over 2000–2025. Early images are few, and the switch from Landsat 7 to Landsat 8 changes the bands; a sensor offset estimated for the earlier study could not be resolved with the data available.

# 2. Data and methods

**Study area.** Lagos State covers {{land_km2}} km² of mapped land on the Atlantic coast of south-west Nigeria, with {{n_lga}} local government areas (LGAs).

## 2.1 Heat, vegetation, population and land cover

Surface temperature and vegetation come from Landsat 8 and 9 Collection 2 Level 2 images (USGS, Landsat Collection 2), accessed through Microsoft Planetary Computer, for dry-season images searched from December 2019 to March 2025; the images kept run from January 2020 to December 2024. We masked clouds, cloud shadow and pixels with a temperature uncertainty above 4 K, and resampled to a 60 m grid in UTM zone 31N. For each cell we took the median over the clear images, and a cell needs at least three to enter the heat analysis. Vegetation is the median normalised difference vegetation index (NDVI, a satellite greenness index), and a cell is vegetated when NDVI is at least {{veg_ndvi}}; cut-offs of 0.3 and 0.5 are tested.

The UHI intensity of a cell on one image is its surface temperature minus the mean temperature of a countryside reference, and we map the median over images. The reference is land within 20 km of the state that WorldCover 2021 classes as tree cover, shrubland, grassland, cropland, wetland or mangrove (Zanaga et al., 2022). {{ref_inside_pct}}% of the reference cells lie inside the state.

Population is the WorldPop 2020 unconstrained product at 100 m (WorldPop, 2020; Tatem, 2017), a modelled estimate, summed onto the 60 m grid. As a check we also use WorldPop's constrained product, which places people only on settlement cells. Land cover is ESA WorldCover 2021 at 10 m, sampled at the cell centre.

## 2.2 Image selection

We searched all Landsat 8 and 9 dry-season scenes from December 2019 to March 2025 with under 70% cloud, giving {{n_passes}} passes (one satellite, one day, one path). A pass was kept if its reference had at least 6,750 clear 60 m pixels, no more than 5% of built-up 180 m blocks were more than 3 °C colder than the reference (a cloud and fog screen), and at least one LGA was half clear. {{n_kept}} passes were kept. {{v_cloud}} failed on a cloudy reference, {{v_lga}} had no LGA half clear, {{v_cold}} failed the cold screen ({{v_cold_nomeasure}} of them because no built-up block was clear enough to measure it) and {{v_err}} could not be read. All {{n_kept}} kept passes are on Landsat path 191 at about 10:03 UTC (11:03 local time), from January 2020 to December 2024. Only {{n_p191}} of the {{n_passes}} passes are on that path, so {{n_kept}} of {{n_p191}} passes on the path were kept. The cold screen uses the heat values, so it is partly selection on the outcome. Section 3.3 tests this.

## 2.3 Distance and heat measures

Distance to vegetation is the straight-line distance from a cell to the nearest vegetated cell. Residents are "within" if their cell is within {{access_m}} m (about {{walk_min}} minutes on foot at 5 km/h) and "beyond" otherwise. The measure ignores roads, fences and access, and counts a single 60 m cell of street trees as vegetation.

A cell is hot when its UHI intensity is at least 4 °C. The hot share of a group is the population on hot cells divided by all residents of the group, so cells without a heat value count as not hot; {{nohot_pct}}% of residents have no heat value, so the shares are lower bounds by at most that much. Mean heat is population-weighted. About {{nodata_pct}}% of land cells have no vegetation or heat value, probably because of the cloud, shadow and uncertainty masks, and a further {{few_pct}}% have one or two images. The figures use only inputs without gaps (population and land cover). We report no confidence intervals. Neighbouring cells are strongly dependent, so an interval from resampling cells would be too narrow, and a spatial block bootstrap was not done.

# 3. Results

## 3.1 Population and land cover

Across all land cells, built-up land covers {{lc_built_area}}% of the area and holds {{lc_built_pop}}% of the population, and tree cover covers {{lc_tree_area}}% and holds {{lc_tree_pop}}% (Figures 1 and 2). The median UHI intensity is {{built_median}} °C on built-up cells and {{tree_median}} °C on tree-covered cells.

![**Figure 1.** Population density, 2020, WorldPop, 100 m, people per km² on a log scale. A modelled estimate.](paper/figures/fig1_population.png)

![**Figure 2.** ESA WorldCover 2021 land cover over all land cells in the state.](paper/figures/fig2_landcover.png)

## 3.2 Distance to vegetation and heat

{{beyond_pct}}% of residents live more than {{access_m}} m from vegetation. That moves from {{beyond_lo_pct}}% to {{beyond_hi_pct}}% when the NDVI cut-off moves from 0.3 to 0.5. Residents on vegetated cells are {{veg_pop_pct}}% of the population and are cool partly by definition, since vegetation and temperature come from the same images.

**Table 1.** Population-weighted mean UHI intensity (°C) and hot-cell share by land cover and distance to vegetation. Hot means at least 4 °C. The gap is beyond minus within.

| Group | Within {{access_m}} m (°C) | Beyond {{access_m}} m (°C) | Gap (°C) | Hot share, within / beyond |
|---|---|---|---|---|
| Built-up cells | {{bu_within}} | {{bu_beyond}} | {{bu_gap}} | {{bu_hot_within}}% / {{bu_hot_beyond}}% |
| Other land cells | {{ot_within}} | {{ot_beyond}} | {{ot_gap}} | {{ot_hot_within}}% / {{ot_hot_beyond}}% |
| All cells | {{wm_within}} | {{wm_beyond}} | {{pooled_gap}} | {{hot_within_pct}}% / {{hot_beyond_pct}}% |

Across all cells the gap is {{pooled_gap}} °C. Among built-up cells it is {{bu_gap}} °C. {{beyond_built_pct}}% of residents beyond {{access_m}} m live on built-up cells. The other-land group is small beyond {{access_m}} m, and its within group contains the vegetated cells, so its contrast is unstable. {{gap_pct}}% of all residents are both beyond {{access_m}} m and on hot cells. Within built-up cells the mean rises with distance in every band, from {{bu_band_second}} °C at 60–120 m to {{bu_band_last}} °C beyond 600 m. The nearest band, {{bu_band_first}} °C, includes the vegetated cells themselves. At 2, 4 and 5 °C, {{hot2_pct}}%, {{hot4_pct}}% and {{hot5_pct}}% of residents on cells with a heat value are hot, so the hot share depends on the threshold.

## 3.3 Robustness

Table 2 shows how the built-up gap changes with the choices. Removing one image, one calendar year or one LGA at a time are leave-one-out reruns on the same pixels. They show that no single image drives the heat values. They are not confidence intervals, and the vegetation and distance layers were held fixed. The gap is positive in every check. Its size depends mainly on the vegetation cut-off and on how near the vegetated cells the comparison starts.

**Table 2.** Built-up gap (°C) under different choices.

| Check | Built-up gap (°C) | Vegetated cells in within group |
|---|---|---|
| Main estimate (NDVI {{veg_ndvi}}, {{n_kept}} kept images) | {{bu_gap}} | in |
| Leave one image out | {{bu_gap_lo}} to {{bu_gap_hi}} | in |
| Leave one calendar year out | {{loy_gap_lo}} to {{loy_gap_hi}} | in |
| Leave one LGA out | {{lga_gap_lo}} to {{lga_gap_hi}} | in |
| All {{n_saved}} saved images, all rules off (includes cloudy-reference passes) | {{scr_bu_gap}} | in |
| NDVI cut-off 0.3 / 0.5 | {{nd03_gap}} / {{nd05_gap}} | in |
| Vegetated cells excluded | {{ex_veg_gap}} | out |
| Cells within 120 m of vegetation excluded | {{ex120_gap}} | out |
| WorldPop constrained population | {{pop_con_bu_gap}} | in |
| WorldPop constrained population, vegetated cells excluded | {{pop_con_bu_ex}} | out |
| Within {{lga_n}} of {{n_lga}} LGAs (mean weighted by the smaller group; range) | {{lga_w}} ({{lga_lo}} to {{lga_hi}}) | out |
| Low ground below 10 m / higher ground | {{low_gap}} / {{high_gap}} | out |
| Within 500 m of permanent water or sea / further | {{water_in}} / {{water_out}} | out |

Rows marked "out" leave vegetated cells out of the within group, so compare them with {{ex_veg_gap}} °C, not {{bu_gap}} °C. The LGA row covers the {{lga_n}} LGAs with more than 50,000 residents in both groups; all {{n_lga}} LGA gaps are positive.

Across the vegetation cut-offs 0.3 to 0.5, buffers of 0 to 120 m and both population layers, the gap runs from {{spec_min}} to {{spec_max}} °C. The all-cell gap moves more with the population layer: it is {{pooled_gap}} °C with the unconstrained product and {{pop_con_pooled}} °C with the constrained one. This paper therefore gives no share of the all-cell gap to land cover.

# 4. Discussion

The heat island is concentrated on built-up cells, and most residents live on them. Residents far from vegetation are on warmer ground on average. Holding land cover to built-up cells, the gap is {{bu_gap}} °C against {{pooled_gap}} °C across all cells. The remaining gap could reflect things this analysis does not measure, such as building density, tree size and position relative to the urban core. Splitting by elevation and by distance to permanent water does not remove the gap, but it is larger on low ground, and the within-LGA average is smaller than the pooled figure. The result is an association. It should not be read as an estimate of what planting trees would do, and the share beyond {{access_m}} m ({{beyond_lo_pct}}% to {{beyond_hi_pct}}% across NDVI cut-offs) needs that range in any policy statement.

# 5. Limitations

Landsat measures surface temperature on clear dry-season mornings. It is not air temperature and not measured at night. Only {{n_kept}} images were kept, all from one path and one overpass time, and the screening uses the heat values. We did not estimate the gap for single images or by month, and the kept images cover December to February only. The thermal band is about 100 m across, so heat from vegetation spills into neighbouring cells, which may inflate the near-vegetation contrast, and the gap was still falling at the widest buffer tested (120 m). Harmattan dust and haze in December to February can affect both temperature and NDVI. The countryside reference mixes several land-cover classes and {{ref_inside_pct}}% of its cells lie inside the state, so absolute UHI values and hot shares depend on how it is defined, and we did not test other definitions. Built-up status is the 10 m WorldCover label at the cell centre, a noisy way to hold land cover fixed. Cells near vegetation may be greener themselves, and we did not control for the greenness of the cell, so the built-up gap may partly restate the known link between surface temperature and NDVI. Cells within and beyond 300 m were seen on different sets of images. Population is modelled, and the unconstrained product places some people on cells that are not built up. Cells without an NDVI value are treated as not vegetated in the distance calculation; we did not check their land cover, and if many are vegetation or wetland masked as water, the share beyond 300 m is overstated. Distance is a straight-line proxy and ignores roads and access, and vegetation outside the state land mask is not counted. The 300 m distance is borrowed from green-space indicators that count areas of at least 1 ha, while a single 60 m cell counts here, and an NDVI cut-off also counts wetland and mangrove vegetation that residents may not use. WorldPop places people using covariates that include land cover and settlement, so the population weights are partly related to the built-up and vegetation structure tested here, and we did not check which census or survey base the Nigerian layer uses. Low ground is elevation below 10 m in the Copernicus 30 m elevation model, a surface model that includes buildings and trees. The datasets have different dates: WorldPop 2020, WorldCover 2021 and heat 2020–2024. We did not compare surface temperature with ground stations, test the NDVI cut-off against tree-cover maps, or re-check the accuracy of WorldCover or WorldPop.

# 6. Conclusion

In the December to February images from January 2020 to December 2024, surface urban heat in Lagos State is concentrated on built-up cells, where most residents live. Among built-up cells, the land surface where residents far from vegetation live is {{bu_gap}} °C warmer on average than where residents near it live, and the gap is positive in every check reported here. It ranges from {{spec_min}} to {{spec_max}} °C across the vegetation cut-offs, buffers of 0 to 120 m and population layers, and from {{lga_lo}} to {{lga_hi}} °C within single LGAs. In these ranges the vegetated cells are left out of the nearby group. These are cross-sectional associations. They do not show cause or trend.

# Data and code availability

Code is released under the MIT licence and derived data under CC BY 4.0, from <https://github.com/oloyededavid/Lagos-Urban-Heat-Analytics>. Source data keep their own terms: Landsat (USGS), ESA WorldCover, WorldPop and FAO GAUL.

# References

Oke, T. R. (1982). The energetic basis of the urban heat island. *Quarterly Journal of the Royal Meteorological Society*, 108(455), 1–24. https://doi.org/10.1002/qj.49710845502

Tatem, A. J. (2017). WorldPop, open data for spatial demography. *Scientific Data*, 4, 170004. https://doi.org/10.1038/sdata.2017.4

USGS. Landsat Collection 2 Level 2 surface temperature and reflectance products, accessed through Microsoft Planetary Computer.

Voogt, J. A., & Oke, T. R. (2003). Thermal remote sensing of urban climates. *Remote Sensing of Environment*, 86(3), 370–384. https://doi.org/10.1016/S0034-4257(03)00079-8

WorldPop. (2020). *Unconstrained individual countries 2000–2020 (100 m): Nigeria*. University of Southampton. https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/NGA/nga_ppp_2020.tif

Zanaga, D., Van De Kerchove, R., Daems, D., et al. (2022). *ESA WorldCover 10 m 2021 v200*. Zenodo. https://doi.org/10.5281/zenodo.7254221
