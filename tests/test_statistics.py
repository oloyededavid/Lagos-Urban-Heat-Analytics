import numpy as np


def test_benjamini_hochberg_matches_hand_computation(analyze):
    p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216]
    # thresholds 0.005, 0.010, ... ; the largest passing rank is 2
    assert analyze.benjamini_hochberg(p, 0.05).tolist() == [True, True] + [False] * 8


def test_benjamini_hochberg_none_pass(analyze):
    assert not analyze.benjamini_hochberg([0.5, 0.7, 0.9]).any()


def test_ols_recovers_known_coefficients(analyze):
    rng = np.random.default_rng(1)
    x1, x2 = rng.normal(size=200), rng.normal(size=200)
    y = 3.0 + 2.0 * x1 - 1.5 * x2 + rng.normal(scale=0.1, size=200)
    m = analyze.ols(y, {"a": x1, "b": x2})
    c = m["coefficients"]
    assert abs(c["intercept"]["beta"] - 3.0) < 0.05
    assert abs(c["a"]["beta"] - 2.0) < 0.05 and abs(c["b"]["beta"] + 1.5) < 0.05
    for term in ("a", "b"):
        lo, hi = c[term]["ci95"]
        assert lo < c[term]["beta"] < hi and hi - lo < 0.1
    assert m["r2"] > 0.99


def test_knn_weights_neighbour_count(analyze):
    pts = np.array([[0, 0], [1, 0], [0, 1], [5, 5], [6, 5]], dtype=float)
    w = analyze.knn_weights(pts, 2)
    assert all(len(v) == 2 for v in w.neighbors.values())
