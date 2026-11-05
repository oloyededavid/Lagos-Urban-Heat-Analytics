import pytest


def _square(x, y, s=0.1):
    return [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]]


def _feature(i, **over):
    props = {"lga_name": f"LGA {i}", "area_km2": 10.0, "population": 1000.0, "pop_density": 100.0,
             "mean_lst": 35.0, "modis_lst": 30.0, "ndvi": 0.3, "ndbi": 0.0, "elevation": 10.0, "slope": 1.0}
    props.update(over)
    return {"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": _square(i * 0.1, 0)}}


def test_tidy_name(ingest):
    assert ingest.tidy_name("Ajeromi/ Ifelodun") == "Ajeromi/Ifelodun"
    assert ingest.tidy_name("  Ifako /Ijaye ") == "Ifako/Ijaye"


def test_validate_rejects_wrong_count_and_bad_values(ingest):
    feats = [_feature(i) for i in range(19)] + [_feature(19, mean_lst=90.0)]
    with pytest.raises(ingest.ValidationError) as err:
        ingest.validate({"features": feats[:-1]})
    assert "expected 20" in str(err.value)
    with pytest.raises(ingest.ValidationError) as err:
        ingest.validate({"features": feats})
    assert "mean_lst=90.0" in str(err.value)


def test_clean_geometry_drops_line_fragments(ingest):
    geom = {"type": "GeometryCollection", "geometries": [
        {"type": "Polygon", "coordinates": _square(0, 0)},
        {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}]}
    assert ingest.clean_geometry(geom)["type"] == "Polygon"
