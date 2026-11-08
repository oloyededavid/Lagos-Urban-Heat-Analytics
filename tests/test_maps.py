"""Published map products must be complete and internally consistent."""
import json
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data"


def _load(name):
    return json.loads((DATA / name).read_text())


@pytest.mark.skipif(not (DATA / "maps.json").exists(), reason="maps not rendered")
def test_every_listed_map_exists():
    maps = _load("maps.json")["maps"]
    assert maps, "no maps listed"
    for path in maps.values():
        assert (ROOT / "docs" / path).exists(), path


@pytest.mark.skipif(not (DATA / "overlays.json").exists(), reason="no explorer overlays")
def test_overlays_are_complete():
    ov = _load("overlays.json")
    (lat0, lon0), (lat1, lon1) = ov["bounds"]
    assert 6.2 < lat0 < lat1 < 6.9 and 2.5 < lon0 < lon1 < 4.6     # Lagos State
    vals = [v for v, _ in ov["stops"]]
    assert vals == sorted(vals) and 0 in vals
    for p in ov["periods"]:
        assert (DATA / p["file"]).exists(), p["file"]
        assert p["passes"] >= 3


@pytest.mark.skipif(not (DATA / "map_analysis.json").exists(), reason="no map analysis")
def test_exposure_adds_up():
    ex = _load("map_analysis.json")["exposure"]
    total = sum(ex["state"].values()) + ex["unobserved"]
    assert abs(total - ex["population_on_land"]) <= 0.001 * ex["population_on_land"] + 10
    for row in ex["lga"]:
        parts = sum(row[k] for k in ex["classes_c"]) + row["unobserved"]
        assert abs(parts - row["population"]) <= 0.001 * row["population"] + 10, row["lga_name"]
    assert abs(sum(r["population"] for r in ex["lga"]) - ex["population_on_land"]) <= 0.001 * ex["population_on_land"] + 20


@pytest.mark.skipif(not (DATA / "map_analysis.json").exists(), reason="no map analysis")
def test_hotspot_and_bivariate_counts():
    a = _load("map_analysis.json")
    hs = a["hotspots"]
    assert hs["hot"] + hs["cold"] + hs["not_significant"] == hs["cells"]
    shares = a["bivariate"]["share_by_class"]
    assert len(shares) == 9 and abs(sum(shares.values()) - 1) < 0.002


def test_benjamini_hochberg():
    from conftest import load
    bh = load("map_analysis").bh
    p = np.array([0.01, 0.04, 0.03, 0.5])
    # hand-computed: sorted 0.01,0.03,0.04,0.5 -> 0.04,0.053,0.053,0.5
    assert np.allclose(bh(p), [0.04, 0.0533333, 0.0533333, 0.5], atol=1e-6)
