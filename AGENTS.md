# Working on this repository

Static research site (GitHub Pages, `docs/`) on the surface urban heat island of Lagos State,
2000–2025, with the Python scripts that produce every number and map on it.

## Rules

- Every number on `docs/index.html` and `docs/explore.html` is read from a file in `docs/data/`
  that a script in `scripts/` writes. Never type a result into HTML or JavaScript. The page fills
  numbers through `data-v` spans in `docs/assets/app.js`.
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
| Printed maps | `python scripts/render_maps.py` | `docs/assets/maps/*.png`, `docs/data/maps.json` |
| Explorer overlays | `python scripts/web_overlays.py` | `docs/data/maps/suhi_*.png`, `docs/data/overlays.json` |
| Tests | `pytest` | |

`research/rasters/` is not committed (about 30 MB); rebuild it with the commands above.
Install with `pip install -r requirements-maps.txt` for the raster steps.

## Where things are

- `research/data-dictionary.md`: every published file and field.
- `research/provenance.md`: sources, versions, licences, and the map registry.
- `research/upgrade-audit.md`: review findings and what remains open.
- `research/state-machines.md`: explorer state and URL parameters.
