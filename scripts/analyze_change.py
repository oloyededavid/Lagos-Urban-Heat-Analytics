"""Four decades of the Lagos surface urban heat island: statistics for the website.

Reads the outputs of scripts/extract_change_gee.py (docs/data/lagos_change_*.csv,
lagos_ghsl.csv, change_meta.json) and writes docs/data/change_summary.json:

- per LGA and period: median SUHI across scenes, with a bootstrap 95% interval
- per LGA: change from the first to the last period (bootstrap 95% interval), and
  a Theil-Sen trend across dry seasons with a Mann-Kendall test, FDR-corrected
- Lagos State: land-area-weighted SUHI per period and the share of land running hot
- urbanisation test: across LGAs, SUHI change against GHSL built-up change
- key findings with plain verdicts

    python scripts/analyze_change.py
"""
from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy import stats

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA = REPO_ROOT / "docs" / "data"
B = 2000
SEED = 20240301
ALPHA = 0.05
MIN_N = 3          # fewer clear passes than this: value shown, but no interval or verdict


def benjamini_hochberg(p, alpha=ALPHA):
    p = np.asarray(p, dtype=float)
    n = len(p)
    order = np.argsort(p)
    passed = np.where(p[order] <= (np.arange(1, n + 1) / n) * alpha)[0]
    return p <= p[order][passed[-1]] if len(passed) else np.zeros(n, dtype=bool)


def boot_median(values, rng, b=B):
    v = np.asarray(values, dtype=float)
    idx = rng.integers(0, len(v), size=(b, len(v)))
    return np.median(v[idx], axis=1)


def r(x, d=2):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), d)


def load(data_dir: Path):
    rows = list(csv.DictReader(open(data_dir / "lagos_change_lga.csv", encoding="utf-8")))
    scenes = list(csv.DictReader(open(data_dir / "lagos_change_scenes.csv", encoding="utf-8")))
    ghsl = list(csv.DictReader(open(data_dir / "lagos_ghsl.csv", encoding="utf-8")))
    meta = json.loads((data_dir / "change_meta.json").read_text(encoding="utf-8"))
    return rows, scenes, ghsl, meta


def run(data_dir: Path = DATA, out_path: Path | None = None) -> dict:
    rows, scenes, ghsl, meta = load(data_dir)
    out_path = out_path or data_dir / "change_summary.json"
    rng = np.random.default_rng(SEED)
    periods = meta["periods"]
    period_of = {s: p["label"] for p in periods for s in p["seasons"]}
    labels = [p["label"] for p in periods]
    first, last = labels[0], labels[-1]

    by = defaultdict(lambda: defaultdict(list))       # lga -> period -> [suhi]
    by_season = defaultdict(lambda: defaultdict(list))  # lga -> season -> [suhi]
    by_pass = defaultdict(lambda: defaultdict(dict))  # period -> pass -> {lga: suhi}
    for row in rows:
        season, v = int(row["season"]), float(row["suhi"])
        by_season[row["lga_name"]][season].append(v)
        if season in period_of:
            by[row["lga_name"]][period_of[season]].append(v)
            by_pass[period_of[season]][row["pass_id"]][row["lga_name"]] = v

    built = defaultdict(dict)
    land = {}
    for g in ghsl:
        built[g["lga_name"]][int(g["year"])] = float(g["built_share"])
        land[g["lga_name"]] = float(g["land_km2"])
    first_year, last_year = periods[0]["ghsl_year"], periods[-1]["ghsl_year"]

    lgas, boots = {}, {}
    for name in sorted(by_season):
        per, boots[name] = {}, {}
        for lab in labels:
            v = by[name].get(lab, [])
            if len(v) >= MIN_N:
                bm = boot_median(v, rng)
                boots[name][lab] = bm
                per[lab] = {"median": r(np.median(v)), "ci95": [r(np.percentile(bm, 2.5)), r(np.percentile(bm, 97.5))],
                            "n": len(v), "enough": True}
            elif v:
                per[lab] = {"median": r(np.median(v)), "ci95": [None, None], "n": len(v), "enough": False}
            else:
                per[lab] = {"median": None, "ci95": [None, None], "n": 0, "enough": False}
        change = None
        if first in boots[name] and last in boots[name]:
            d = boots[name][last] - boots[name][first]
            lo, hi = np.percentile(d, [2.5, 97.5])
            delta = per[last]["median"] - per[first]["median"]
            change = {"delta": r(delta), "ci95": [r(lo), r(hi)],
                      "verdict": "Warmed" if lo > 0 else "Cooled" if hi < 0 else "No clear change"}
        elif per[first]["median"] is not None and per[last]["median"] is not None:
            change = {"delta": r(per[last]["median"] - per[first]["median"]), "ci95": [None, None],
                      "verdict": "Too few clear days"}
        seasons_sorted = sorted(by_season[name])
        med = [float(np.median(by_season[name][s])) for s in seasons_sorted]
        trend = None
        if len(seasons_sorted) >= 8:
            ts = stats.theilslopes(med, seasons_sorted, alpha=0.95)
            tau, p = stats.kendalltau(seasons_sorted, med)
            trend = {"slope_per_decade": r(ts.slope * 10), "ci95": [r(ts.low_slope * 10), r(ts.high_slope * 10)],
                     "kendall_tau": r(tau, 3), "p_value": float(p), "n_seasons": len(seasons_sorted)}
        lgas[name] = {"periods": per, "change": change, "trend": trend,
                      "seasons": {str(s): r(m) for s, m in zip(seasons_sorted, med)},
                      "built_share": {str(y): r(v, 4) for y, v in sorted(built[name].items())},
                      "built_change": r(built[name][last_year] - built[name][first_year], 4),
                      "land_km2": r(land[name], 2)}

    names = [n for n in lgas if lgas[n]["trend"]]
    fdr = benjamini_hochberg([lgas[n]["trend"]["p_value"] for n in names])
    for n, sig in zip(names, fdr):
        t = lgas[n]["trend"]
        t["fdr_significant"] = bool(sig)
        t["p_value"] = r(t["p_value"], 6)

    # Lagos State: land-area-weighted SUHI per period. The interval resamples whole passes
    # (a cluster bootstrap), because one clear morning covers many LGAs at once.
    def weighted(passes, members):
        vals = defaultdict(list)
        for pid in passes:
            for n, v in by_pass[lab][pid].items():
                if n in members:
                    vals[n].append(v)
        have = [n for n in members if vals[n]]
        if not have:
            return np.nan
        w = np.array([land[n] for n in have])
        return float(np.sum([np.median(vals[n]) * wi for n, wi in zip(have, w)]) / w.sum())

both = [
        n for n in lgas
        if all(lgas[n]["periods"][p]["enough"] for p in periods)
    ]
    state, draws_for = {}, {}
    for lab in labels:
        pids = sorted(by_pass[lab])
        members = [n for n in lgas if lgas[n]["periods"][lab]["n"]]
        point = weighted(pids, members)
        draws = np.array([weighted(list(rng.choice(pids, len(pids))), members) for _ in range(B)]) if pids else np.array([np.nan])
        same = np.array([weighted(list(rng.choice(pids, len(pids))), both) for _ in range(B)]) if pids else np.array([np.nan])
        draws_for[lab] = same
        # "common": the same LGAs in every period (those with enough passes first and last),
        # so a large LGA missing from one period cannot shift the average.
        state[lab] = {"weighted_suhi": r(weighted(pids, both)),
                      "ci95": [r(np.nanpercentile(same, 2.5)), r(np.nanpercentile(same, 97.5))],
                      "lgas": len(both), "passes": len(pids),
                      "all_observed": {"weighted_suhi": r(point), "lgas": len(members),
                                       "ci95": [r(np.nanpercentile(draws, 2.5)), r(np.nanpercentile(draws, 97.5))]}}
    sd = draws_for[last] - draws_for[first]
    s_delta = state[last]["weighted_suhi"] - state[first]["weighted_suhi"]
    state_change = {"delta": r(s_delta), "ci95": [r(np.nanpercentile(sd, 2.5)), r(np.nanpercentile(sd, 97.5))],
                    "lgas": len(both), "note": "LGAs with enough clear passes in both the first and last period"}

    # Urbanisation test across LGAs
    full = both
    x = np.array([lgas[n]["built_change"] for n in full]) * 100   # percentage points of land built up
    y = np.array([lgas[n]["change"]["delta"] for n in full])
    lr = stats.linregress(x, y)
    tcrit = stats.t.ppf(0.975, len(x) - 2)
    rho, rho_p = stats.spearmanr(x, y)
    urban = {"n": len(full), "slope_c_per_10pp": r(lr.slope * 10, 3),
             "ci95": [r((lr.slope - tcrit * lr.stderr) * 10, 3), r((lr.slope + tcrit * lr.stderr) * 10, 3)],
             "r2": r(lr.rvalue ** 2, 3), "p_value": r(lr.pvalue, 6), "spearman_rho": r(rho, 3),
             "spearman_p": r(rho_p, 6), "ghsl_years": [first_year, last_year],
             "points": [{"lga": n, "built_change_pp": r(xi, 2), "suhi_change": r(yi)} for n, xi, yi in zip(full, x, y)]}

    used = [s for s in scenes if s["used"] == "yes"]
    ref_by_period = defaultdict(list)
    for s in used:
        if int(s["season"]) in period_of:
            ref_by_period[period_of[int(s["season"])]].append(float(s["ref_lst"]))
    for p in periods:
        p["ref_lst_median"] = r(np.median(ref_by_period[p["label"]])) if ref_by_period[p["label"]] else None

    warmers = sorted((n for n in lgas if lgas[n]["change"] and lgas[n]["change"]["verdict"] != "Too few clear days"),
                     key=lambda n: -lgas[n]["change"]["delta"])
    n_warmed = sum(1 for n in lgas if lgas[n]["change"] and lgas[n]["change"]["verdict"] == "Warmed")
    n_testable = sum(1 for n in lgas if lgas[n]["change"] and lgas[n]["change"]["verdict"] != "Too few clear days")
    n_trend = sum(1 for n in names if lgas[n]["trend"]["fdr_significant"] and lgas[n]["trend"]["slope_per_decade"] > 0)
    hot_first = next((p.get("share_above_3c") for p in periods if p["label"] == first), None)
    hot_last = next((p.get("share_above_3c") for p in periods if p["label"] == last), None)
    findings = [
        {"id": "state", "title": "Lagos's heat island has grown",
         "verdict": "Significant" if state_change["ci95"][0] > 0 else "Not robust",
         "stats": {"delta": state_change["delta"], "ci95": state_change["ci95"], "from": first, "to": last,
                   "first": state[first]["weighted_suhi"], "last": state[last]["weighted_suhi"]}},
        {"id": "lgas", "title": "Where the heat island grew",
         "verdict": "Significant" if n_trend else "Not robust",
         "stats": {"n_warmed": n_warmed, "n_testable": n_testable, "n_trend_fdr": n_trend, "n": len(lgas),
                   "top5": warmers[:5]}},
        {"id": "hot_area", "title": "More of Lagos now runs hot", "verdict": "Ranking",
         "stats": {"share_first": hot_first, "share_last": hot_last, "threshold_c": 3}},
        {"id": "urbanisation", "title": "LGAs that urbanised most warmed most",
         "verdict": "Significant" if urban["ci95"][0] > 0 else "Not robust",
         "stats": {k: urban[k] for k in ("slope_c_per_10pp", "ci95", "r2", "p_value", "spearman_rho", "n")}},
    ]
    summary = {"script": "scripts/analyze_change.py", "source": meta.get("script"),
               "source_version": meta.get("script_version"), "export_utc": meta.get("export_utc"),
               "method": meta.get("method"), "map": meta.get("map"), "periods": periods,
               "scenes": {"considered": len(scenes), "used": len(used),
                          "rejected": {k: sum(1 for s in scenes if s["reason"] == k)
                                       for k in sorted({s["reason"] for s in scenes if s["reason"]})}},
               "state": state, "state_change": state_change, "urbanisation": urban, "lgas": lgas,
               "key_findings": findings}
    out_path.write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    return summary


if __name__ == "__main__":
    run(*(Path(a) for a in sys.argv[1:3]))
