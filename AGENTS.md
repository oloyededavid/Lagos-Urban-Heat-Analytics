# Working on this repository

Static research site (GitHub Pages, `docs/`) on the urban heat island of Lagos State, 2020–2024
(a short research note and one interactive page), with the Python scripts that produce every number and map on it.

## Rules

- Every number in `paper/paper.md` and `docs/index.html` is read from a file in `docs/data/` (or
  `research/pass_stack.csv`) that a script in `scripts/` writes. Never type a result into the template, HTML or
  JavaScript. `scripts/build_paper.py` fills `paper/template.md`; `scripts/build_page.py` builds the page from the
  paper; `docs/assets/explore.js` reads `docs/data/extra_analysis.json` for the interactive map.
- Every map image in `docs/assets/maps/` is written by `scripts/render_maps.py`. Do not edit
  images by hand; change the script and re-run it.
- Satellite land surface temperature is not air temperature, WorldPop is a model, not a census,
  and WorldCover has a stated accuracy (76.5% overall for Africa). Say so wherever they are used.
- Associations across LGAs or cells are not causes. Report intervals, not only point values.
- Design: light only, Satoshi and Zodiak fonts, blue for the interface, orange and blue for heat
  data, green for vegetation. No emojis or decorative icons.

## Pipeline

| Step | Command | Writes |
| :--- | :--- | :--- |
| LGA statistics (Earth Engine export) | `python scripts/ingest_gee_export.py FILE` | `docs/data/lagos_uhi_processed.geojson`, `docs/data/summary.json` |
| Per-pass heat island, 2000–2025 (published passes) | `python scripts/analyze_change_2000_2025.py` | `docs/data/change_summary_2000_2025.json` |
| Period scheme check | `python scripts/epoch_framework.py` | `research/epoch_framework.json` |
| Pixel rasters (Planetary Computer, about 2 hours) | `python scripts/pc_build_rasters.py --workers 8` | `research/rasters/*.tif`, `research/pc_passes.csv`, `research/pc_lga_suhi.csv` |
| Population on the raster grid | `python scripts/pc_population.py [nga_ppp_2020.tif]` | `research/rasters/population_2020.tif` |
| Hot spots, bivariate classes, exposure, sensor offset | `python scripts/map_analysis.py` | `research/rasters/hotspots_*.tif`, `research/rasters/bivariate_*.tif`, `docs/data/map_analysis.json` |
| Distance to vegetation, low ground | `python scripts/access_analysis.py` | `docs/data/access.json`, `research/rasters/veg_distance_m.tif`, `low_ground_10m.tif` |
| Population, land cover, LGA values, stratified results | `python scripts/extra_analysis.py` (after the step above) | `docs/data/extra_analysis.json`, class rasters |
| Per-pass heat rasters, 2020–2025 (about 40 min) | `python scripts/pass_stack.py` | `research/rasters/passes/`, `research/pass_stack.csv` |
| Pass leave-one-out and screening checks | `python scripts/pass_sensitivity.py` | `docs/data/sensitivity_passes.json` |
| Population sensitivity (download the constrained file first, see the script) | `python scripts/population_sensitivity.py` | `docs/data/sensitivity_population.json` |
| NDVI cut-off and crossed gap specifications | `python scripts/ndvi_cutoff_sensitivity.py` and `python scripts/gap_specifications.py` (run from `scripts/`) | `docs/data/sensitivity_ndvi.json`, `docs/data/gap_specifications.json` |
| Printed maps | `python scripts/render_maps.py` | `docs/assets/maps/*.webp`, `docs/data/maps.json` |
| Paper and page | `python scripts/build_paper.py && pandoc paper/paper.md -o paper/paper.docx --resource-path=. && python scripts/build_page.py` | `paper/paper.md`, `paper/paper.docx`, `docs/index.html` |
| Tests | `pytest` | |

`research/rasters/` is not committed (about 30 MB); rebuild it with the commands above.
Install with `pip install -r requirements-maps.txt` for the raster steps.

## Where things are

- `research/data-dictionary.md`: every published file and field.
- `research/provenance.md`: sources, versions, licences, and the map registry.
- `research/upgrade-audit.md`: review findings and what remains open.
- `research/state-machines.md`: explorer state and URL parameters.
