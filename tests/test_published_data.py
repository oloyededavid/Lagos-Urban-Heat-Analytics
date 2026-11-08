"""The published website data must be exactly what the scripts produce."""
import json
import shutil
from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parents[1] / "docs" / "data"


@pytest.mark.skipif(not (DATA / "summary.json").exists(), reason="no published data")
def test_summary_matches_published_data(analyze, tmp_path):
    shutil.copy(DATA / "lagos_uhi_processed.geojson", tmp_path / "g.geojson")
    fresh = analyze.run(tmp_path / "g.geojson", tmp_path / "s.json")
    published = json.loads((DATA / "summary.json").read_text())
    assert json.loads(json.dumps(fresh)) == published
    assert published["provenance"]["is_verified_export"]
    assert published["n_units"] == 20


@pytest.mark.skipif(not (DATA / "change_summary.json").exists(), reason="no published change data")
def test_change_summary_matches_published_data(tmp_path):
    from conftest import load
    change = load("analyze_change")
    fresh = change.run(DATA, tmp_path / "c.json")
    published = json.loads((DATA / "change_summary.json").read_text())
    assert json.loads(json.dumps(fresh)) == published
    assert len(published["lgas"]) == 20
    for p in published["periods"]:
        if p.get("file"):
            assert (DATA / p["file"]).exists()


@pytest.mark.skipif(not (DATA / "change_summary_2000_2025.json").exists(), reason="no 2000-2025 change data")
def test_change_summary_2000_2025_matches_its_script(tmp_path):
    from conftest import load
    mod = load("analyze_change_2000_2025")
    fresh = mod.run(DATA, tmp_path / "c.json")
    published = json.loads((DATA / "change_summary_2000_2025.json").read_text())
    assert json.loads(json.dumps(fresh)) == published
    assert published["study_period"] == [2000, 2025]
    assert [p["label"] for p in published["periods"]] == ["2000-2012", "2013-2019", "2020-2025"]
    # only passes from dry seasons 2000-2025 are counted
    assert published["scenes"]["considered"] == sum(
        1 for line in (DATA / "lagos_change_scenes.csv").read_text().splitlines()[1:] if 2000 <= int(line.split(",")[2]) <= 2025)
