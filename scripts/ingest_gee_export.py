"""Validate the Google Earth Engine export and install it for the analysis and website.

Usage (after downloading lagos_lgas_raw.geojson from Google Drive):

    python scripts/ingest_gee_export.py ~/Downloads/lagos_lgas_raw.geojson

The export is checked (20 LGAs, required fields, physically plausible values),
boundaries are cleaned (GAUL's simplified polygons contain stray line fragments,
which break contiguity weights), names are tidied, and the result is written to
docs/data/lagos_uhi_processed.geojson. Then scripts/analyze_uhi.py is re-run so
docs/data/summary.json always matches the installed data. Nothing is written if
validation fails.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.validation import make_valid

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT = REPO_ROOT / "docs" / "data" / "lagos_uhi_processed.geojson"
EXPECTED_LGAS = 20

REQUIRED = ["lga_name", "area_km2", "population", "pop_density", "mean_lst", "modis_lst",
            "ndvi", "ndbi", "elevation", "slope"]
PROVENANCE = ["lga_code", "land_area_km2", "landsat_scenes", "s2_scenes", "modis_images",
              "period", "export_utc", "script_version", "data_status"]

# Physically plausible ranges; values outside them indicate an export problem.
RANGES = {
    "mean_lst": (15.0, 60.0),
    "modis_lst": (15.0, 60.0),
    "ndvi": (-1.0, 1.0),
    "ndbi": (-1.0, 1.0),
    "elevation": (-20.0, 300.0),
    "slope": (0.0, 45.0),
    "pop_density": (0.0, 200000.0),
    "population": (0.0, 30000000.0),
    "area_km2": (1.0, 5000.0),
}


class ValidationError(Exception):
    pass


def tidy_name(name: str) -> str:
    """Normalise GAUL spacing quirks, e.g. 'Ajeromi/ Ifelodun' -> 'Ajeromi/Ifelodun'."""
    return " ".join(str(name).replace("/ ", "/").replace(" /", "/").split())


def clean_geometry(geom: dict) -> dict:
    """Keep only the polygonal parts of a geometry and repair it."""
    g = make_valid(shape(geom))
    parts: list[Polygon] = []

    def collect(x):
        if isinstance(x, Polygon) and not x.is_empty:
            parts.append(x)
        elif isinstance(x, MultiPolygon):
            parts.extend(p for p in x.geoms if not p.is_empty)
        elif hasattr(x, "geoms"):
            for sub in x.geoms:
                collect(sub)

    collect(g)
    if not parts:
        raise ValidationError("geometry has no polygonal part")
    out = parts[0] if len(parts) == 1 else MultiPolygon(parts)
    return mapping(out)


def validate(geojson: dict) -> dict:
    feats = geojson.get("features") or []
    errors: list[str] = []
    if len(feats) != EXPECTED_LGAS:
        errors.append(f"expected {EXPECTED_LGAS} LGAs, found {len(feats)}")

    cleaned = []
    names = []
    for i, f in enumerate(feats):
        props = dict(f.get("properties") or {})
        if "lga_name" not in props and "ADM2_NAME" in props:
            props["lga_name"] = props["ADM2_NAME"]
        name = tidy_name(props.get("lga_name", f"feature {i}"))
        props["lga_name"] = name
        names.append(name)
        for key in REQUIRED:
            if props.get(key) is None:
                errors.append(f"{name}: missing '{key}'")
        for key, (lo, hi) in RANGES.items():
            v = props.get(key)
            if isinstance(v, (int, float)) and not lo <= v <= hi:
                errors.append(f"{name}: {key}={v} outside [{lo}, {hi}]")
        try:
            geom = clean_geometry(f.get("geometry") or {})
        except Exception as exc:  # noqa: BLE001 - report any geometry failure
            errors.append(f"{name}: invalid geometry ({exc})")
            continue
        keep = {k: props[k] for k in REQUIRED + PROVENANCE if k in props}
        cleaned.append({"type": "Feature", "properties": keep, "geometry": geom})

    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        errors.append(f"duplicate LGA names: {dupes}")
    if errors:
        raise ValidationError("\n".join(errors))

    cleaned.sort(key=lambda f: f["properties"]["lga_name"])
    return {"type": "FeatureCollection", "features": cleaned}


def _load_analyzer():
    spec = importlib.util.spec_from_file_location("analyze_uhi", REPO_ROOT / "scripts" / "analyze_uhi.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def ingest(raw_path: Path, output: Path = OUTPUT) -> dict:
    cleaned = validate(json.loads(Path(raw_path).read_text(encoding="utf-8")))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(cleaned) + "\n", encoding="utf-8")
    return _load_analyzer().run(output, output.parent / "summary.json")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("raw", type=Path, help="lagos_lgas_raw.geojson exported by scripts/extract_data_gee.js")
    parser.add_argument("--out", type=Path, default=OUTPUT, help="processed GeoJSON path")
    args = parser.parse_args(argv)
    try:
        summary = ingest(args.raw, args.out)
    except ValidationError as exc:
        print(f"Validation failed; nothing was installed.\n{exc}", file=sys.stderr)
        return 1
    print(f"Installed {summary['n_units']} LGAs into {args.out}. Provenance: {summary['provenance']['status']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
