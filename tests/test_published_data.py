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
