# Feature inventory: study page and explorer

Audit of 8 November 2026. Read-only, apart from this file and `state-machines.md`.

**Code version tested.** `docs/explore.html` is unchanged since commit d00e481. `docs/index.html` and `docs/assets/app.js` changed during the audit: commit a934ce5, "Reframe the study page to 2000-2025", landed at 17:41. It was not made by this audit. The study page was tested again after that commit, and the rows below describe a934ce5. Line numbers refer to the files as they stand at a934ce5.

**How it was tested.** Playwright (Chromium, headless) against `python -m http.server` on port 8123, at 1440×900, 1280×900 and 375/390 px (touch emulation). The scripts clicked, hovered, typed and dragged, then read the DOM, `location.hash`, the Chart.js instances, downloads and page errors.

**Blocked in this sandbox.** Esri basemap tiles from `server.arcgisonline.com` fail with `ERR_TUNNEL_CONNECTION_FAILED`, producing about 150 console errors per explorer session. Requests to `api.fontshare.com` and `cdn.fontshare.com` were sent, and no failure event was recorded for them. Whether Satoshi and Zodiak actually rendered was not verified.

**State key.** works = behaved as intended in the test. partial = works, with a defect that was reproduced. broken = does not do its job. "not tested" is stated where it applies.

## 1. Study page (`docs/index.html`, `docs/assets/app.js`)

| Feature | Page | Implementation | Data it depends on | Current state (evidence) | Risk if changed |
|---|---|---|---|---|---|
| Section links (header TOC) | index | index.html:31-38; active link `chrome()` app.js:219-243 | none | works: clicking Results set `#results` and `aria-current` on "Results". The TOC is `display:none` at 375 px, so phones get only the Explorer link (index.html:39) | Low. The `targets` list is built from `.toc a[href^="#"]`, so renaming a section id silently breaks the highlight |
| Skip link | index | index.html:26 | none | works: the target `#abstract` exists | Low |
| Reading progress bar | index | `chrome().update` app.js:222-229 | none | works: 25% at Results, 100% at the bottom. It still works in the error state | Low |
| Back-to-top button | index | index.html:228; app.js:232 | none | works: hidden at the top, shown after 1.5 viewports; click scrolls to 0 and focuses `.site-id` | Low |
| Section reveal | index | app.js:238-242 (IntersectionObserver, `.reveal`, `[data-reveal]`) | none | works: every item had class `in` after scrolling. With reduced motion, all items are shown at once | Medium. If JS fails before `chrome()`, the `js-reveal` content stays hidden. `chrome()` is also called in `.catch` |
| Numbers in text (`data-v`) | index | `fill()` app.js:22-55 | summary.json `lst`, `heat_exposure.top5`, `sensor_agreement.mean_difference_c`; change_summary_2000_2025.json `periods`, `lgas.*.periods.*.enough`, `lgas.*.change`, `state.*.all_observed`, `state_change`, `scenes`, `urbanisation.without_most_built`, `method.reference_buffer_m`; geojson `land_area_km2`, `hei` | works: no `data-v` element left at "—". Example: dState +0.8, dCi −2.1 to +3.3, nCommon 10, ikoDelta +1.4 | High. `L.Ikorodu` (app.js:34) throws if Ikorodu is missing from the file, which blanks every figure |
| Fig 1 study-area map, locator inset, labels | index | `lgaMap({id:'map-area'})` app.js:252; `locator()` app.js:160-177; `centroid()` | geojson geometry, `land_area_km2`, `population`; context_countries.geojson | works: 20 paths; a click shows "Alimosho · 147 km² of land · 2,013,579 people (2020)" | Medium. Inset bounds and label coordinates are hard-coded |
| Fig 2 LST map and readout | index | app.js:254; `lgaMap` app.js:112-158 | geojson `mean_lst` | works: hover and click show the value; clicking pins the readout | Medium. `lgaMap` is shared by 7 maps |
| Fig 3 NDVI and NDBI maps | index | app.js:255-256 | geojson `ndvi`, `ndbi` | works | Medium |
| Fig 3b LST against NDVI scatter | index | `ndviChart()` app.js:180-195 | geojson `ndvi`, `mean_lst`; summary.json `regression.lst_on_ndvi.coefficients`, `lst.hottest/coolest` | works: 20 dots and a fitted line | Low |
| Fig 4 Gi* map | index | app.js:257-258 | geojson `gi_zscore_k5` | works: the keyboard ArrowRight then Enter pins the readout "Ajeromi/Ifelodun z = +0.58" | Medium. The fixed domain [−2, 2] differs from the explorer, which scales to the data |
| Fig 5 exposure map | index | app.js:259-260 | geojson `hei`, `mean_lst`, `pop_density` | works | Low |
| Fig 6 period chart (replaced the three period maps in a934ce5) | index | `periodChart()` app.js:198-215 | change_summary_2000_2025.json `periods[].label`, `periods[].sensors`, `state[label].weighted_suhi`, `ci95`, `passes` | works: 3 points; aria-label "2000-2012: +5.7 °C, interval +4.0 to +7.6; …" | Medium. The period maps (`data/maps/*.png`) are no longer shown on this page |
| Fig 7 change map | index | app.js:261-264; `changeState` app.js:250-251 | change_summary_2000_2025.json `lgas.*.change.{delta,ci95,verdict}` | works: Warmed is shaded, "Too few clear days" is hatched, the rest neutral | Medium. The domain [0, 3.5] is fixed, but the only Warmed delta is 1.37 |
| Map keyboard navigation | index | `lgaMap` keydown app.js:139-143 | none | works: arrows move focus and readout; Enter/Space pins | Low |
| Copy citation | index | app.js:233-237; `#cite-text` index.html:201 | none | works: clipboard holds the citation and a "Citation copied" snack appears. Without permission it falls back to `prompt()` (tested) | Low. The citation title is typed by hand, separately from `<title>` |
| Downloads list | index | index.html:193-198 | data files | works: links point to existing files. A HTTP 200 was checked for the explorer list; `change_summary_2000_2025.json` was not fetched separately | Low |
| Data-load error message | index | app.js:268 | all 4 files | partial: if any one file returns 404 (each of the 4 tested), every figure is missing and one generic alert is shown. Progress and back-to-top keep working | Medium. All-or-nothing loading |
| Explorer card | index | index.html:179-189 | `assets/explorer-preview.png` | works (link). The text "play the heat island through the three periods" describes the explorer's 1985–2026 periods, not this page's | Low |
| Phone layout | index | style.css | none | works: no horizontal overflow at 375 px | Low |

## 2. Explorer (`docs/explore.html`, script at lines 1334-2236)

| Feature | Page | Implementation | Data it depends on | Current state (evidence) | Risk if changed |
|---|---|---|---|---|---|
| Data loading | explore | 2204-2235 | lagos_uhi_processed.geojson (required); summary.json, change_summary.json (optional) | works. Note that the explorer still loads **change_summary.json (1985–2026)**, while the study page now uses change_summary_2000_2025.json | High. The two pages report conflicting change findings (+1.7 °C and significant here; +0.8 °C, not significant, on the paper) |
| Error state | explore | `fail()` 2205; `#map-error` 1020-1024 | geojson | partial: 404, an empty FeatureCollection and bad JSON each show the error card with chip "Data unavailable". Controls stay live: clicking "Heat over time" wrote `#layer=suhi&period=null`. The intro stays at "loading…" | Medium |
| Data chip and provenance banner | explore | `renderProvenance()` 2172-2181 | summary.json `provenance.is_verified_export`, `gee_script_version`, `gee_export_utc` | works: "Earth Engine export v2.0.0" with a tooltip of the export time. With summary.json missing, it reads "Unverified data" and the banner shows | Low |
| Map initialisation and fit | explore | 1376-1378, `buildMap()` 1414-1433, `fitAll()` 1442-1448, `mapPadding()` 1435-1441 | geojson geometry | works: 20 paths; the ResizeObserver refits when the state is "ALL" | Medium. Padding is read from live DOM positions of the floating panels |
| Layer: Temperature | explore | `LAYERS.lst` 1393; `styleMap()` 1451-1490; `colorFor()` 1406 | `mean_lst` | works: legend 31.8 / 36.0 / 40.1 °C, 5 fill classes | Medium. Fills are stepped (5 classes), but the legend bar is a continuous gradient |
| Layer: Hot & cold spots | explore | `LAYERS.hotspot` 1394 | `gi_zscore`, `fdr_significant`, `hotspot_category` | works: ±0.95 scale; note "No single LGA is significant…" | Medium. The symmetric scale is taken from the data (±0.95), while the paper uses a fixed ±2. Same z, different colours |
| Layer: Heat exposure | explore | 1395 | `hei` | works | Low |
| Layer: Vegetation | explore | 1396 | `ndvi` | works | Low |
| Layer: Population | explore | 1397 (log scale) | `pop_density` | works: 335 / 5,465 / 89,129 | Low |
| Layer: Heat over time (raster) | explore | 1398; `overlay()` 1522; `updateRaster()` 1528-1544 | change_summary.json `periods[].file`, `map.bounds`, `map.stops`; `data/maps/suhi_*.png` | works: `suhi_2014-2026.png` is added and the legend is −2 / +4 / +10 °C. **The 2000–2025 file has no `map` or `file` keys**, so this layer cannot be switched to the new periods without new PNGs | High |
| Map tooltips | explore | 1420, 1462-1464 | layer value; `lgaChange()` | works: "Eti-Osa / Surface temperature (°C): 36.7 °C / Click to open this LGA" | Low |
| LGA labels on the map | explore | `drawLabels()` 1493-1517 | layer value | works: 7 to 8 labels without overlap; names only while swiping | Low. Swipe mode is read from the DOM (`#swipe-line.hidden`, 1504) |
| Basemap switch | explore | `setBasemap()` 1382-1388; `#basemap-select` 987-994 | Esri tiles | not verifiable here: tiles are blocked. The code swapped the layers (2 tile layers for Canvas; requests went to the right services). Hidden below 640 px | Low |
| Period slider | explore | 1564, `setPeriod()` 1560 | `periods` | works: 0/1/2 change the image, legend source ("median of 6 satellite passes"), ticks and hash `period=…`. Arrow keys work | Medium |
| Play/pause | explore | 1566-1578 | `periods` | works: starts from period 0 when at the end, steps every 1.5 s, stops at the last period. Moving the slider, switching layer or ticking swipe stops it | Medium. See state-machines.md D7 and D8 |
| Swipe compare | explore | 1565, `clipSwipe()` 1545-1558, drag 1579-1587 | `periods[0]`, current period | partial: alignment is exact after load, pan, zoomend, resize and fly-to (line = clip edge = 440 px). **Mid-zoom the clip edge sat at 54 px while the line was at 440 px.** At period 0 the box stays ticked but nothing is shown | Medium |
| LGA search | explore | `tryFind()` 1607-1615 | `lga_name` | works: "mush" finds Mushin, "IKEJA" finds Ikeja, "a" finds Agege (the first substring match). "zzz" does nothing and gives no feedback | Low |
| Whole state | explore | 1615 | none | works: clears the selection, flies to the state, drops `lga` from the hash | Low |
| Map click to open an LGA | explore | 1423 | none | works: selects the LGA and switches to the LGA tab | Low |
| LGA tab: list and detail | explore | `renderLgaList()` 1770-1775; `renderLga()` 1776-1799 | geojson; change_summary.json `lgas.*.change`, `trend` | partial: **Epe, Ibeju Lekki and Kosofe ("Too few clear days") are described as "has not changed by more than the uncertainty"**, and their tile reads "95% interval — to —" (reproduced for Epe) | Medium |
| Tabs, mouse and keyboard | explore | `setTab()` 1618-1634 | none | works: every panel shows; ArrowRight from Rankings wraps to Overview; Home and End work; hash `tab=…` | Medium. `setTab` also builds charts |
| Overview tab | explore | `renderOverview()` 1660-1682; `findingText()` 1647-1658; `changeSentence()` 1684-1688 | summary.json `key_findings`, `lst`, `sensor_agreement`; change `state_change`, `key_findings.lgas.top5` | works: 4 tiles, 6 findings, short answer. With summary.json missing, the short answer stays at "loading…" | Medium. "(1985–2003)" is hard-coded at 1687 |
| Change since 1985 tab | explore | `renderChange()` 1705-1735; `buildChangeCharts()` 1736-1766 | change_summary.json `state`, `state_change`, `key_findings`, `lgas`, `urbanisation`, `periods.ref_lst_median` | partial: it renders (4 tiles, 4 findings, 20-row strip, 2 charts) and strip rows open the LGA. The strip shows "ns" changes for untestable LGAs (Kosofe +2.1 ns). The findings contradict the current paper | High |
| State chart with the selected LGA line | explore | 1740-1762 | `state[].ci95`, `lgas[sel].periods` | works: a dataset is added for the selected LGA (Apapa) | Low |
| What explains it: coefficients and 3 scatters | explore | `buildCharts()` 1842-1887; `scatter()` 1804-1836 | summary.json `regression.*`, `sensor_agreement`; geojson `ndvi`, `ndbi`, `mean_lst`, `modis_lst` | partial: 4 charts render. **Every click on a scatter point throws "Cannot read properties of undefined (reading 'handleEvent')"** (ndvi, sensors and urban all reproduced). The selection still happens | Medium |
| Statistics tab | explore | `renderStats()` 1902-1923 | summary.json `spatial_autocorrelation`, `regression`, `sensor_agreement`, `heat_exposure`, `provenance`; geojson Gi* fields | works: 4 / 20 / 4 / 5 rows; clicking a Gi* row opens the LGA | Low |
| Rankings sort | explore | `RANK` 1926-1932; `renderRanking()` 1933-1940; 1941-1945 | geojson fields; derived `suhi_change` | partial: all 5 sorts work and rows open the LGA. "Heat island growth" ranks Epe, Ibeju Lekki and Kosofe on untested deltas. The sort is not in the URL | Medium |
| Two-LGA comparison | explore | `renderCompare()` 1946-1964; 1965-1966 | geojson; derived `suhi_now`, `suhi_change` | partial: works for distinct LGAs. **Selecting the LGA that is in B sets A to the same LGA** (Epe vs Epe; Ikeja vs Ikeja, every difference +0.0). Not in the URL | Low |
| Share: copy link | explore | 2061-2065 | `location.href` | works: clipboard got `explore.html#lga=Amuwo+Odofin&layer=suhi&tab=rank&period=2004-2013`, with snack "Link copied" | Low |
| Share: native share | explore | 2066-2067 | `navigator.share` | not tested: hidden in desktop Chromium | Low |
| URL state restore | explore | `writeHash()` 2184-2192; `readHash()` 2193-2202 | none | partial: lga, layer, tab and period restore. Comparison B, rank key, swipe and basemap do not. `hashchange` is not handled. `lga` matching is case-sensitive. A bad hash falls back silently | Medium |
| Print | explore | 2068-2069; `@media print` 836-850 | none | works: `print()` was called once; print CSS shows only the current tab. The play and slider controls still print, because the CSS hides `.timeline`, which no element uses | Low |
| Download: LGA CSV | explore | 2021-2027 | geojson properties (18 columns) | works: `lagos_urban_heat_lgas.csv`, 21 lines plus a trailing newline. Change fields are not included | Low |
| Download: static files | explore | 937-942 | data files | works: all 5 returned HTTP 200. "Heat island over time" is the 1985–2026 file | Low |
| Download: map PNG | explore | 1983-2018 | current layer; overlay image | partial: works (986 kB for suhi 2004–2013). **If the period PNG has not finished loading, the PNG has the heat-island title and legend but no raster** (reproduced with a 3 s image delay) | Low |
| Download: charts PNG | explore | 1889-1899 | `charts` objects | partial: works (1.26 MB). **With summary.json missing it throws "reading 'canvas'" and nothing downloads** | Low |
| Methods dialog | explore | 1242-1268; `openDialog` 2072 | none (text is hard-coded) | works: opens from the button, the intro button and the note link (the link adds no `#`). Escape and backdrop close it | Low |
| About dialog | explore | 1270-1293 | none | works. Its "Open the glossary" button stacks a second modal on top (both open), and closing the glossary returns to About | Low |
| Glossary dialog and inline terms | explore | `GLOSSARY` 2030-2052; `initGlossary()` 2053-2057; tips 2075-2097 | none | partial: 21 entries, and every `data-term` has a definition. Hovering a term or "i" shows the tip. **Clicking "i" after hovering hides it. Tapping "i" on an emulated touch phone shows nothing** | Low |
| Guided tour | explore | `TOUR` 2100-2111; 2112-2169 | `CH()` for step 4 | partial: 10 steps; step 4 switches to Heat over time and step 5 switches back; focus is trapped; Escape and arrows work; the layer is restored. On exit it always switches to Overview (it was Statistics before). Started while playing, playback continues. **With change data missing, step 5 opens the hidden Change tab** (empty "—" panel, hash `#tab=change`) | Medium |
| Tour invitation toast | explore | 1326-1332; 2158 | localStorage `lagos_tour_seen` | broken / unreachable: nothing ever un-hides `#tour-toast`; the localStorage key is written but never read | Low |
| Menus (Data, Share) | explore | `<details>` 931-957; 2093, 2097 | none | works: opening one closes the other; an outside click and Escape close both | Low |
| Phone layout | explore | @media 799-834 | none | works: no horizontal overflow at 390 px; the legend with time controls does not overlap the layer bar | Low |

**Counts.**

| Page | works | partial | broken / unreachable | not tested |
|---|---|---|---|---|
| Study page (20 rows) | 19 | 1 | 0 | 0 |
| Explorer (43 rows) | 28 | 12 | 1 (tour toast) | 2 (basemap visuals, native share) |

## 3. Duplicated logic

- **Formatters**, defined in both pages:
  - app.js:13-17 has `f`, `sf`, `pct`, `int`.
  - explore.html:1343-1345 and 1691 have `fmt`, `fmtSigned`, `fmtInt`, `pct`.
  - They disagree on negative numbers: app.js:13 writes "−", but `fmt` writes "-". Example: the explorer's compare table shows NDBI "-0.15".
- **`snack()`** is written twice: app.js:218 (2.0 s) and explore.html:2060 (2.2 s).
- **Clipboard copy with a prompt fallback**: app.js:234-236 and explore.html:2063-2064.
- **Colour interpolation**: `interp()` app.js:65 and `suhiColor()` explore.html:1358.
- **Heat-island gradient** built from `map.stops`: explore.html:1472 and 2010.
- **Heat ramp hex values** are repeated: app.js:56-60 (`RAMPS.heat`, `DIV`) and explore.html:49-52 (CSS tokens).
- **Projection code**: `frame()` app.js:82; map PNG `proj` explore.html:1989-1994; `pathOf` app.js:89.
- **"Select LGA, then switch to the LGA tab" row handler**, repeated 4 times: explore.html:1423, 1729, 1909, 1939.
- **Chart tooltip and axis option blocks**, repeated: explore.html:1753, 1822-1826, 1872-1874.
- **Values derived in two places:**
  - Heat-island change per LGA: `p.suhi_change` (2222) and `lgaChange(name).change.delta` (1787, 1797, 1463).
  - Current period value: `p.suhi_now` (2222) and `suhiOf(name, last)` (1722).
  - Most heat-exposed LGA: a sort of `props()` (1665) and `summary.heat_exposure.top5` (1655).
  - The "testable/common" LGA sets: app.js:25-26, 38, and analyze_change.py.
- **"Too few clear days" handling differs** between app.js:250 (hatched, no value) and explore.html:1787, 1797, 1726, 1931 (treated as a value).

## 4. Hard-coded values that should come from data

**explore.html**
- :920 "20 LGAs · dry seasons 1985–2026"; :937, 1052, 1139, 1147, 1151, 1155, 1201, 1252, 1279, 2031, 2043, 2101 "20".
- :1227 "Version 2.0" (summary.json has `gee_script_version` 2.0.0).
- :1350 `compA:'Mushin', compB:'Epe'`.
- :1368 `suhiInk` threshold 6.35 °C.
- :1378 `setView([6.55, 3.6], 10)`.
- :1393 "dry-season median 2022–2024" (from `provenance.period`).
- :1394, 1785 "5 nearest neighbours".
- :1651 "With only 20 large LGAs".
- :1687 "(1985–2003)".
- :1696 "on the edges of the city", "The dense core was already hot in the 1980s and 1990s".
- :1697 "as the city spread east along Lekki and north towards Ikorodu".
- :1709 "gap in the 1990s".
- :1713, 2034 "2,000 times".
- :1714 "+3 °C" (`hot_area.threshold_c`).
- :1895 "20 LGAs · dry seasons 2022–2024".
- :1264 methods text: 70% cloud, 20 km, 5%, 3 °C, 3,000 pixels, "GHSL (1995 to 2020)", "1992 to 1998". These are in `change.method` and `urbanisation.ghsl_years`.
- :2033 "20 km".
- :2037 "about 10:30".
- :2104 tour text "watch 1985 to 2026".
- :1005 `max="5"` (overwritten at load).
- :2210 data file name `change_summary.json`.

**app.js**
- :18 `WORDS` stops at "ten".
- :34 `L.Ikorodu`.
- :44 `'Alimosho'`.
- :99 25 km scale bar.
- :147 label threshold 100 km².
- :161-175 locator bounds and label coordinates.
- :257 Gi* domain [−2, 2].
- :261 change domain [0, 3.5] (the current maximum Warmed delta is 1.37).

**index.html**
- :69 names "Ajeromi/Ifelodun" and "Epe" (the km² values are computed).
- :131 "Alimosho has the most people".
- :149 "only … shows" (assumes one Warmed LGA) and "among them Eti-Osa, Apapa and Lagos Island".
- :153 "2000–2012 to 2020–2025".
- :158 "two passes from 1985 and 1991".
- :165 "70% cloud", "dry seasons 2021 to 2023 have no usable pass".
- :167 the sensor list.
- :176 "Ikorodu is the one LGA".
- :185 "three periods".
- :201 citation title.
- :232 "Last updated 8 November 2026".

**Elsewhere**
- README.md still presents the 1985–2026 change as the result (it is not a web page, but it contradicts a934ce5).

## 5. Features in code that are never reachable

- **Tour toast** `#tour-toast` (explore.html:1326-1332), its "Not now" handler (2158), and the `lagos_tour_seen` writes (2152, 2158). Nothing shows the toast, and nothing reads the key.
- **`repaint()`** (explore.html:1373) is never called.
- **`'Cooled'` branch** (explore.html:1787): no LGA in change_summary.json has this verdict.
- **Hot or cold spot sentence** (explore.html:1651), the branch for `n_hot + n_cold > 0`, and the urbanisation "not clear" branch (1700): neither can be reached with the current summary.json or change_summary.json.
- **`#share-native`** (954, 2066-2067) is reachable only where `navigator.share` exists. Not tested.

## 6. Dead code

- **app.js `fill()` keys never used by index.html:** `exclList`, `exclShare`, `fewList`, `nWarmedWord`, `pass1`. `pass1` reads `P[0].n_scenes`, which the 2000–2025 file does not have; it evaluates to "undefined" and is not shown.
- **style.css:735-747** `.pt-head`, `.pscroll`, `.pstack`, `.pinner`: period-map styles, unused since a934ce5.
- **explore.html CSS classes no element or script uses:** `.timeline*` (700-716, 795, 825, 830-831, 843), `.place-label` (718-737), `.coverage`, `.pill` (509-522), `.multiples`, `.multiple*` (524-530), `details.table-view` (532-533, 844), `.swatch`, `.swatch-unreliable` (283-284), `.tile.is-flagged` (423), `.play` (716), and `.card` in print (848).
- **`btn-primary:hover`** (645) uses an orange (#9a3412), left over from an earlier palette.
- **`GLOSSARY` keys used only in the dialog list**, never by an inline term: lga, reference, bootstrap, theilsen, ghsl, hei, rho, vif. They are not dead, because the glossary dialog lists them.
