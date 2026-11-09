"""Publication maps for the study page from the rasters of scripts/pc_build_rasters.py.

One cartographic template for every map: title and subtitle, legend with units, scale bar, north
arrow, latitude/longitude graticule, LGA and state boundaries, no-data entry,
and a credit line with sources, coordinate system, author and date. Maps are drawn in the grid's
own projection, WGS 84 / UTM zone 31N (EPSG:32631), so the scale bar is exact.

    python scripts/render_maps.py            # writes docs/assets/maps/*.webp and docs/data/maps.json
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.patheffects as pe
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from matplotlib import colors as mcolors
from matplotlib.collections import LineCollection
from matplotlib.patches import Patch, Rectangle
from matplotlib.patches import Polygon as MplPolygon
from rasterio.warp import transform as tr
from rasterio.warp import transform_geom

ROOT = Path(__file__).resolve().parents[1]
RAS = ROOT / "research" / "rasters"
OUT = ROOT / "docs" / "assets" / "maps"
DATE = "9 November 2026"
AUTHOR = "D. O. Oloyede"
CRS_NOTE = "WGS 84 / UTM zone 31N (EPSG:32631)"
INK, INK2, RULE = "#111111", "#474747", "#d0cfca"
NODATA = "#e2e1dc"
WATER = "#d4e1ea"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.linewidth": 0.6})

HEAT = mcolors.LinearSegmentedColormap.from_list("heat", ["#fdeee2", "#f9a05a", "#f2711c", "#d9500b", "#a93a08", "#6b2406"])
# heat-island ramp: neutral exactly at 0 °C, blue below, orange above; shared with the explorer overlays (scripts/web_overlays.py)
SUHI_STOPS = [(-4, "#1c5cab"), (-2, "#86b6ef"), (0, "#f1eee6"), (2, "#f9a05a"), (4, "#f2711c"), (6, "#d9500b"), (8, "#a93a08"), (10, "#6b2406")]
SUHI = mcolors.LinearSegmentedColormap.from_list("suhi", [((v + 4) / 14, c) for v, c in SUHI_STOPS])
SUHI_NORM = mcolors.Normalize(-4, 10)
CHANGE = mcolors.LinearSegmentedColormap.from_list("chg", ["#1c5cab", "#86b6ef", "#f4f3ef", "#f9a05a", "#a93a08"])
GREEN = mcolors.LinearSegmentedColormap.from_list("ndvi", ["#f3efe2", "#c9e2a8", "#7fc283", "#2f8a3f", "#0b461e"])
NDBI = mcolors.LinearSegmentedColormap.from_list("ndbi", ["#2f6b4f", "#a9c9a4", "#f2f1ec", "#b9a99a", "#5c4436"])
COUNT = mcolors.LinearSegmentedColormap.from_list("cnt", ["#c9ece6", "#7fcdbb", "#2c9c8f", "#126b63", "#00393a"])   # starts darker than the no-data grey
POP = mcolors.LinearSegmentedColormap.from_list("pop", ["#f6f1f9", "#d4b9da", "#a678b8", "#6a3d9a", "#2d0f4e"])
# WorldCover 2021 v200 product validation report v2.0: overall accuracy for Africa
WC_ACC_AFRICA = 76.5
WORLDCOVER = [(10, "Tree cover", "#006400"), (20, "Shrubland", "#ffbb22"), (30, "Grassland", "#ffff4c"), (40, "Cropland", "#f096ff"),
              (50, "Built-up", "#fa0000"), (60, "Bare / sparse vegetation", "#b4b4b4"), (80, "Permanent water", "#0064c8"),
              (90, "Herbaceous wetland", "#0096a0"), (95, "Mangroves", "#00cf75")]


def load(name):
    with rasterio.open(RAS / name) as s:
        a = s.read(1).astype("float32")
        if s.nodata is not None and not np.isnan(s.nodata):
            a[a == s.nodata] = np.nan
        return a, s.transform


class Base:
    """Grid, boundaries and helpers shared by every map."""

    def __init__(self):
        self.lgas = json.loads((ROOT / "docs" / "data" / "lagos_uhi_processed.geojson").read_text())
        ids, self.t = load("lagos_land.tif")
        self.state_ids = None
        with rasterio.open(RAS / "lagos_land.tif") as s:
            self.shape, self.crs = s.shape, s.crs
        from rasterio.features import rasterize
        self.shapes = [transform_geom("EPSG:4326", "EPSG:32631", f["geometry"]) for f in self.lgas["features"]]
        self.names = [f["properties"]["lga_name"] for f in self.lgas["features"]]
        self.inside = rasterize(((s, i + 1) for i, s in enumerate(self.shapes)), out_shape=self.shape, transform=self.t, fill=0, dtype="uint8")
        self.land = np.isfinite(ids) & (ids > 0)
        wc, _ = load("worldcover_2021.tif")
        self.water = wc == 80
        xs = [x for s in self.shapes for x, _ in s["coordinates"][0]]
        ys = [y for s in self.shapes for _, y in s["coordinates"][0]]
        pad = 3000
        self.view = (min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad)
        self.extent = (self.t.c, self.t.c + self.t.a * self.shape[1], self.t.f + self.t.e * self.shape[0], self.t.f)

    # --- frame ---
    def figure(self, title, subtitle, panels=1, height=None, foot=0.86):
        w = 11.0
        aspect = (self.view[3] - self.view[2]) / (self.view[1] - self.view[0])
        mh = w * 0.92 * aspect
        top, gap = 0.95, 0.38
        h = height or (top + panels * mh + (panels - 1) * gap + 0.28 + foot)
        fig = plt.figure(figsize=(w, h), dpi=150)
        fig.text(0.04, 1 - 0.28 / h, title, fontsize=14, fontweight="bold", color=INK, va="top")
        fig.text(0.04, 1 - 0.60 / h, subtitle, fontsize=9.5, color=INK2, va="top")
        axes = []
        for i in range(panels):
            bottom = 1 - (top + (i + 1) * mh + i * gap) / h
            ax = fig.add_axes([0.04, bottom, 0.92, mh / h])
            self.frame(ax)
            axes.append(ax)
        return fig, axes, h

    def frame(self, ax):
        ax.set_xlim(self.view[0], self.view[1]); ax.set_ylim(self.view[2], self.view[3])
        ax.set_aspect("equal"); ax.set_facecolor("white")
        for s in ax.spines.values():
            s.set_color(INK2)
        self.graticule(ax)

    def graticule(self, ax):
        lons = np.arange(2.8, 4.41, 0.2); lats = np.arange(6.4, 6.71, 0.1)
        segs = []
        for lo in lons:
            la = np.linspace(6.2, 6.9, 30); x, y = tr("EPSG:4326", "EPSG:32631", [lo] * 30, list(la)); segs.append(np.c_[x, y])
        for la in lats:
            lo = np.linspace(2.5, 4.6, 60); x, y = tr("EPSG:4326", "EPSG:32631", list(lo), [la] * 60); segs.append(np.c_[x, y])
        ax.add_collection(LineCollection(segs, colors="#9a9a9a", linewidths=0.35, linestyles=(0, (2, 3)), zorder=1))
        xt = [tr("EPSG:4326", "EPSG:32631", [lo], [6.45])[0][0] for lo in lons]
        ax.set_xticks(xt); ax.set_xticklabels([f"{lo:.1f}°E" for lo in lons], fontsize=7, color=INK2)
        yt = [tr("EPSG:4326", "EPSG:32631", [3.5], [la])[1][0] for la in lats]
        ax.set_yticks(yt); ax.set_yticklabels([f"{la:.1f}°N" for la in lats], fontsize=7, color=INK2)
        ax.tick_params(length=2, width=0.5, pad=2)

    def boundaries(self, ax, lw=0.45, color="#3a3a3a", state=True):
        segs = [np.array(s["coordinates"][0]) for s in self.shapes]
        ax.add_collection(LineCollection(segs, colors=color, linewidths=lw, zorder=4))

    def raster(self, ax, arr, cmap, norm, mask_outside=True):
        a = np.where(self.inside > 0, arr, np.nan) if mask_outside else arr
        miss = (self.inside > 0) & ~np.isfinite(a)
        ax.imshow(np.where(miss & self.water, 1.0, np.nan), extent=self.extent, cmap=mcolors.ListedColormap([WATER]), interpolation="nearest", zorder=2)
        ax.imshow(np.where(miss & ~self.water, 1.0, np.nan), extent=self.extent, cmap=mcolors.ListedColormap([NODATA]), interpolation="nearest", zorder=2)
        im = ax.imshow(a, extent=self.extent, cmap=cmap, norm=norm, interpolation="nearest", zorder=3)
        return im

    def scalebar(self, ax, km=20):
        x0, x1, y0, y1 = self.view
        H = y1 - y0
        bx, by = x1 - (x1 - x0) * 0.045 - km * 1000, y1 - H * 0.12
        for i in range(2):
            ax.add_patch(Rectangle((bx + i * km * 500, by), km * 500, H * 0.018, facecolor=INK if i == 0 else "white", edgecolor=INK, lw=0.6, zorder=6))
        for i, v in enumerate((0, km // 2, km)):
            ax.text(bx + i * km * 500, by + H * 0.035, str(v), ha="center", fontsize=7, color=INK, zorder=6)
        ax.text(bx + km * 1000 + 1500, by, "km", fontsize=7, color=INK, va="bottom", zorder=6)
        nx, ny = bx - 6500, y1 - H * 0.20
        ax.add_patch(MplPolygon([[nx, ny + H * 0.09], [nx - 1500, ny], [nx, ny + H * 0.025], [nx + 1500, ny]], closed=True, facecolor=INK, zorder=6))
        ax.text(nx, ny + H * 0.10, "N", ha="center", va="bottom", fontsize=8, fontweight="bold", zorder=6)

    def labels(self, ax, names=("Alimosho", "Ikeja", "Eti-Osa", "Ikorodu", "Epe", "Badagry", "Ibeju Lekki", "Ojo", "Kosofe")):
        for f, s in zip(self.lgas["features"], self.shapes):
            n = f["properties"]["lga_name"]
            if n in names:
                from shapely.geometry import shape
                pt = shape(s).representative_point()
                ax.text(pt.x, pt.y, n, fontsize=6.3, ha="center", va="center", color=INK, zorder=7,
                        path_effects=[pe.withStroke(linewidth=2.2, foreground="white")])

    def credit(self, fig, h, source):
        fig.text(0.04, 0.06 / h, f"Source: {source}  ·  Projection: {CRS_NOTE}", fontsize=7, color=INK2, va="bottom")

    def colorbar(self, fig, im, h, label, ticks=None, extend="neither", y=0.42, nodata=True):
        cax = fig.add_axes([0.04, y / h, 0.42, 0.13 / h])
        cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend=extend, ticks=ticks)
        cb.outline.set_linewidth(0.4); cb.ax.tick_params(labelsize=7, length=2)
        cb.ax.xaxis.set_label_position("top")
        cb.set_label(label, fontsize=8, color=INK, labelpad=3)
        if nodata:
            for k, (col, txt) in enumerate(((WATER, "Water (not analysed)"), (NODATA, "No clear observation"))):
                yy = y + 0.13 - k * 0.2
                fig.patches.append(Rectangle((0.52, yy / h), 0.018, 0.13 / h, transform=fig.transFigure, facecolor=col, edgecolor="#9a9a9a", lw=0.4))
                fig.text(0.543, (yy + 0.065) / h, txt, fontsize=7, color=INK2, va="center")


def save(fig, name):
    OUT.mkdir(parents=True, exist_ok=True)
    import io

    from PIL import Image
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200, facecolor="white")  # 2200 px wide: sharp at full column width on high-density screens
    plt.close(fig)
    img = Image.open(buf).convert("RGB")
    img.save(OUT / f"{name}.webp", quality=90, method=6)   # about a third of a PNG's size, without the banding of a 256-colour palette
    return f"assets/maps/{name}.webp"


# ---------------- maps ----------------
PERIODS = ["2000-2012", "2013-2019", "2020-2025"]
LATEST = "2020-2025"
LS = "USGS Landsat Collection 2 Level 2 via Microsoft Planetary Computer"


def meta():
    return json.loads((RAS / "meta.json").read_text())


def period_note(lab):
    m = meta()["periods"][lab]
    sens = ", ".join(s.replace("landsat-", "Landsat ") for s in m["sensors"])
    return f"{lab.replace('-', '–')} · {sens} · {m['passes']} clear dry-season passes, December–March"


def map_reference(B):
    fig, (ax,), h = B.figure("Lagos State: local government areas and countryside reference",
                             "20 LGAs (FAO GAUL 2015) and the countryside reference: unbuilt land within 20 km, inside the state and around it (ESA WorldCover 2021)")
    ref, _ = load("reference_mask.tif")
    for s in B.shapes:   # LGA fill first, so the reference inside the state stays visible on top
        ax.add_patch(MplPolygon(np.array(s["coordinates"][0]), closed=True, facecolor="#f4f2ec", edgecolor="none", zorder=1.5))
    ax.imshow(np.where(ref > 0, 1.0, np.nan), extent=B.extent, cmap=mcolors.ListedColormap(["#a9cf96"]), interpolation="nearest", zorder=2)
    B.boundaries(ax, lw=0.6)
    for f, s in zip(B.lgas["features"], B.shapes):
        if f["properties"]["land_area_km2"] >= 60:
            ring = np.array(s["coordinates"][0]); ax.text(ring[:, 0].mean(), ring[:, 1].mean(), f["properties"]["lga_name"], fontsize=6.5, ha="center", va="center", color=INK, zorder=7)
    B.scalebar(ax)
    fig.patches.append(Rectangle((0.04, 0.36 / h), 0.018, 0.13 / h, transform=fig.transFigure, facecolor="#a9cf96", edgecolor="#9a9a9a", lw=0.4))
    fig.text(0.063, 0.425 / h, "Countryside reference (unbuilt land within 20 km)", fontsize=7.5, va="center")
    fig.patches.append(Rectangle((0.36, 0.36 / h), 0.018, 0.13 / h, transform=fig.transFigure, facecolor="#f4f2ec", edgecolor="#3a3a3a", lw=0.4))
    fig.text(0.383, 0.425 / h, "Built-up land and water inside the LGAs (labels: LGAs over 60 km² of land)", fontsize=7.5, va="center")
    B.credit(fig, h, "FAO GAUL 2015; ESA WorldCover 2021 v200; Natural Earth")
    return save(fig, "m01_reference")


def map_landcover(B):
    wc, _ = load("worldcover_2021.tif")
    fig, (ax,), h = B.figure("Land cover, 2021", f"ESA WorldCover 2021 v200, 10 m, shown at 60 m (majority). Overall accuracy {WC_ACC_AFRICA}% for Africa (independent validation)")
    codes = [c for c, _, _ in WORLDCOVER]
    idx = np.full(wc.shape, np.nan)
    for i, c in enumerate(codes):
        idx[wc == c] = i
    idx = np.where(B.inside > 0, idx, np.nan)
    ax.imshow(idx, extent=B.extent, cmap=mcolors.ListedColormap([c for _, _, c in WORLDCOVER]), vmin=-0.5, vmax=len(codes) - 0.5, interpolation="nearest", zorder=3)
    B.boundaries(ax, color="#222222"); B.scalebar(ax)
    tot = np.isfinite(idx).sum()
    handles = [Patch(facecolor=col, edgecolor="#9a9a9a", lw=0.3, label=f"{lab} {pct(100 * (wc[B.inside > 0] == c).sum() / tot)}") for c, lab, col in WORLDCOVER if (wc[B.inside > 0] == c).any()]
    fig.legend(handles=handles, loc="lower left", bbox_to_anchor=(0.035, 0.24 / h), ncol=5, fontsize=7, frameon=False, handlelength=1.2, columnspacing=1.2)
    B.credit(fig, h, "ESA WorldCover 2021 v200 (Zanaga et al., 2022); share of the state's area in each class")
    return save(fig, "m02_landcover")


def pct(v):
    return "<1%" if 0 < v < 0.5 else f"{v:.0f}%"


def single(B, name, title, sub, arr, cmap, norm, label, ticks=None, extend="neither", source=LS):
    fig, (ax,), h = B.figure(title, sub)
    im = B.raster(ax, arr, cmap, norm); B.boundaries(ax); B.labels(ax); B.scalebar(ax)
    B.colorbar(fig, im, h, label, ticks, extend); B.credit(fig, h, source)
    return save(fig, name)


def triple(B, name, title, sub, key, cmap, norm, label, ticks=None, extend="neither"):
    fig, axes, h = B.figure(title, sub, panels=3)
    for ax, lab in zip(axes, PERIODS):
        arr, _ = load(f"{lab}_{key}.tif")
        im = B.raster(ax, arr, cmap, norm); B.boundaries(ax)
        ax.text(0.44, 0.025, period_note(lab), transform=ax.transAxes, fontsize=8, fontweight="bold", va="bottom", color=INK, zorder=8,
                bbox=dict(facecolor="white", edgecolor="none", alpha=0.85, pad=2))
    B.scalebar(axes[0]); B.colorbar(fig, im, h, label, ticks, extend); B.credit(fig, h, LS)
    return save(fig, name)


def bivar_colors():
    """3 x 3 palette: columns NDVI tercile (low to high, toward green), rows SUHI tercile (low to high, toward orange)."""
    g = [np.array(mcolors.to_rgb(c)) for c in ("#f0efe9", "#a9cf9a", "#4f9a5c")]
    o = [np.array(mcolors.to_rgb(c)) for c in ("#f0efe9", "#f2b07a", "#d9500b")]
    return [[tuple(np.clip(g[j] * o[i] / np.array(mcolors.to_rgb("#f0efe9")), 0, 1)) for j in range(3)] for i in range(3)]


def map_hotspots(B, A):
    hs = A["hotspots"]
    with rasterio.open(RAS / f"hotspots_{LATEST}.tif") as src:
        cls = src.read(1).astype(float); t = src.transform
    ext = (t.c, t.c + t.a * cls.shape[1], t.f + t.e * cls.shape[0], t.f)
    fig, (ax,), h = B.figure("Hot and cold spots of the surface heat island, 2020–2025",
                             f"Getis-Ord Gi* on {hs['cell_m']} m cells, neighbours within {hs['neighbour_radius_m'] / 1000:.1f} km, "
                             f"false discovery rate {hs['fdr_q']}; {hs['cells']:,} cells with enough clear observations")
    cols = {1: "#2f6db5", 2: "#ecebe6", 3: "#d9500b"}
    rgba = np.zeros(cls.shape + (4,))
    for k, c in cols.items():
        rgba[cls == k] = mcolors.to_rgba(c)
    B.raster(ax, np.full(B.shape, np.nan), mcolors.ListedColormap([NODATA]), mcolors.Normalize(0, 1))   # in-state water and no-data underneath
    ax.imshow(rgba, extent=ext, interpolation="nearest", zorder=3)
    B.boundaries(ax); B.labels(ax); B.scalebar(ax)
    items = [(cols[3], f"Hot spot ({hs['hot']:,} cells)"), (cols[1], f"Cold spot ({hs['cold']:,} cells)"),
             (cols[2], f"Not significant ({hs['not_significant']:,} cells)"), (NODATA, "Too few clear observations"), (WATER, "Water")]
    for k, (c, txt) in enumerate(items):
        x = 0.04 + k * 0.19
        fig.patches.append(Rectangle((x, 0.5 / h), 0.018, 0.13 / h, transform=fig.transFigure, facecolor=c, edgecolor="#9a9a9a", lw=0.4))
        fig.text(x + 0.023, 0.565 / h, txt, fontsize=7.5, va="center")
    fig.text(0.04, 0.30 / h, hs["note"], fontsize=7, color=INK2)
    B.credit(fig, h, LS)
    return save(fig, "m13_hotspots")


def map_bivariate(B, A):
    bv = A["bivariate"]
    arr, _ = load(f"bivariate_{LATEST}.tif")
    arr = np.nan_to_num(arr)   # 0 (no class) is stored as nodata
    pal = bivar_colors()
    rgba = np.zeros(arr.shape + (4,))
    for i in range(3):
        for j in range(3):
            rgba[arr == 1 + i * 3 + j] = (*pal[i][j], 1)
    rgba[B.inside == 0] = 0
    fig, (ax,), h = B.figure("Vegetation and heat together, 2020–2025",
                             "Each 60 m cell classed by its NDVI tercile and its surface-heat-island tercile across Lagos (cells with at least 3 clear passes)", foot=1.25)
    miss = (B.inside > 0) & (arr == 0)
    ax.imshow(np.where(miss & B.water, 1.0, np.nan), extent=B.extent, cmap=mcolors.ListedColormap([WATER]), interpolation="nearest", zorder=2)
    ax.imshow(np.where(miss & ~B.water, 1.0, np.nan), extent=B.extent, cmap=mcolors.ListedColormap([NODATA]), interpolation="nearest", zorder=2)
    ax.imshow(rgba, extent=B.extent, interpolation="nearest", zorder=3)
    B.boundaries(ax); B.labels(ax); B.scalebar(ax)
    lh = 0.78                                           # legend square, inches
    lax = fig.add_axes([0.075, 0.42 / h, lh / 11, lh / h])
    lax.imshow(np.array(pal), origin="lower", extent=(0, 3, 0, 3))
    lax.set_xticks([]); lax.set_yticks([])
    for sp in lax.spines.values():
        sp.set_visible(False)
    lax.set_xlabel("greener →", fontsize=7, labelpad=2); lax.set_ylabel("hotter →", fontsize=7, labelpad=2)
    ly = 0.42
    nt, st = bv["ndvi_terciles"], bv["suhi_terciles"]
    fig.text(0.16, (ly + 0.60) / h, f"NDVI terciles: below {nt[0]:.2f} · {nt[0]:.2f}–{nt[1]:.2f} · above {nt[1]:.2f}", fontsize=7.5)
    fig.text(0.16, (ly + 0.38) / h, f"Heat island terciles: below {st[0]:.1f} °C · {st[0]:.1f}–{st[1]:.1f} °C · above {st[1]:.1f} °C", fontsize=7.5)
    hot_bare = bv["share_by_class"]["20"] * 100; cool_green = bv["share_by_class"]["02"] * 100
    for k, (col, txt) in enumerate(((WATER, "Water (not analysed)"), (NODATA, "No clear observation"))):
        fig.patches.append(Rectangle((0.74, (ly + 0.5 - k * 0.22) / h), 0.018, 0.13 / h, transform=fig.transFigure, facecolor=col, edgecolor="#9a9a9a", lw=0.4))
        fig.text(0.763, (ly + 0.565 - k * 0.22) / h, txt, fontsize=7, color=INK2, va="center")
    fig.text(0.16, (ly + 0.16) / h, f"Least green and hottest: {hot_bare:.0f}% of cells; greenest and coolest: {cool_green:.0f}%. "
             f"Rank correlation across cells {bv['spearman_ndvi_suhi_cells']:.2f} (cells are not independent).", fontsize=7.5, color=INK2)
    B.credit(fig, h, LS)
    return save(fig, "m14_ndvi_heat")


def chart_exposure(A):
    ex = A["exposure"]
    labs = ex["classes_c"]
    cols = ["#2f6db5", "#f3d9c2", "#f2a066", "#d9500b", "#7a2a06"]
    rows = sorted(ex["lga"], key=lambda r: -sum(r[l] for l in labs[3:]) / max(r["population"], 1))
    fig = plt.figure(figsize=(11, 6.4), dpi=150)
    h = 6.4
    fig.text(0.04, 1 - 0.28 / h, "Who lives in the warmest areas, 2020–2025", fontsize=14, fontweight="bold", va="top")
    fig.text(0.04, 1 - 0.60 / h, "Share of each LGA's residents (WorldPop 2020) by the surface heat island of the 60 m cell they live in; sorted by share at 4 °C or more",
             fontsize=9.5, color=INK2, va="top")
    ax = fig.add_axes([0.17, 0.2, 0.78, 0.66])
    y = np.arange(len(rows))
    left = np.zeros(len(rows))
    for l, c in zip(labs + ["unobserved"], cols + [NODATA]):
        v = np.array([r[l] / r["population"] * 100 for r in rows])
        ax.barh(y, v, left=left, color=c, edgecolor="white", lw=0.4, label=(l + " °C") if l != "unobserved" else "Not observed (water or cloud)")
        left += v
    ax.set_yticks(y); ax.set_yticklabels([f"{r['lga_name']}  ({r['population'] / 1e6:.2f} M)" for r in rows], fontsize=7.5)
    ax.invert_yaxis(); ax.set_xlim(0, 100); ax.set_xlabel("% of residents", fontsize=8)
    ax.tick_params(labelsize=7.5, length=2)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    fig.legend(*ax.get_legend_handles_labels(), ncol=6, fontsize=7.5, frameon=False, loc="lower left", bbox_to_anchor=(0.035, 0.075), handlelength=1.2)
    st = ex["state"]; tot = ex["population_on_land"]
    fig.text(0.04, 0.045, f"Lagos State: {(st['4 to 6'] + st['6 or more']) / tot * 100:.0f}% of {tot / 1e6:.1f} million modelled residents live in cells at least 4 °C warmer than the countryside. "
             "Surface temperature, not air temperature.", fontsize=7.5, color=INK2)
    fig.text(0.04, 0.012, "Source: Landsat Collection 2 Level 2 (Planetary Computer); WorldPop 2020 (unconstrained, modelled)", fontsize=7, color=INK2)
    return save(fig, "m15_exposure")


def load_int(name):
    with rasterio.open(RAS / name) as s:
        a = s.read(1).astype("float32")
        a[a == 255] = np.nan
        return a


def map_access_gap(B, X):
    cls = load_int("access_heat_class.tif")
    cmap = mcolors.ListedColormap(["#e9f2e4", "#f2b98a", "#a93a08"])
    share = X["gap_beyond_300m_and_hot"]["share_of_total"] * 100
    return single(B, "m20_access_gap", "Green-space gap and heat, 2020–2025",
                  f"Residents more than 300 m from vegetation who also live on cells at least 4 °C warmer than the countryside: {share:.0f}% of the 2020 population",
                  np.where(B.inside > 0, cls, np.nan), cmap, mcolors.Normalize(-0.5, 2.5),
                  "0 = within 300 m of vegetation; 1 = beyond 300 m, under 4 °C; 2 = beyond 300 m, 4 °C or more",
                  [0, 1, 2], "neither", source="Landsat NDVI and surface heat 2020–2025; WorldPop 2020 (modelled)")


def lga_values_map(B, name, title, sub, values, cmap, norm, label, ticks, extend="neither"):
    """Fill each LGA on the grid with its value (LGA index raster written by scripts/extra_analysis.py)."""
    idx = load_int("lga_index.tif")
    order = EXTRA["lga_order"]
    arr = np.full(idx.shape, np.nan, "float32")
    for i, n in enumerate(order, start=1):
        if n in values:
            arr[idx == i] = values[n]
    return single(B, name, title, sub, arr, cmap, norm, label, ticks, extend,
                  source="LGA boundaries (FAO GAUL 2015); Landsat surface heat 2020–2025; WorldPop 2020 (modelled)")


def chart_bars(name, title, sub, labels, series, xlabel, foot):
    """Horizontal bar chart; series = list of (values, colour, legend label)."""
    fig = plt.figure(figsize=(11, 6.4), dpi=150)
    h = 6.4
    fig.text(0.04, 1 - 0.28 / h, title, fontsize=14, fontweight="bold", va="top")
    fig.text(0.04, 1 - 0.60 / h, sub, fontsize=9.5, color=INK2, va="top")
    ax = fig.add_axes([0.24, 0.2, 0.72, 0.66])
    y = np.arange(len(labels)); bh = 0.8 / len(series)
    for k, (vals, col, lab) in enumerate(series):
        ax.barh(y + (k - (len(series) - 1) / 2) * bh, vals, height=bh, color=col, label=lab)
    ax.set_yticks(y); ax.set_yticklabels(labels, fontsize=8); ax.invert_yaxis()
    ax.set_xlabel(xlabel, fontsize=8.5); ax.tick_params(labelsize=7.5, length=2)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.grid(axis="x", color="#e2e1dc", lw=0.5); ax.set_axisbelow(True)
    if len(series) > 1:
        fig.legend(*ax.get_legend_handles_labels(), ncol=len(series), fontsize=7.5, frameon=False, loc="lower left", bbox_to_anchor=(0.04, 0.075))
    fig.text(0.04, 0.012, foot, fontsize=7, color=INK2)
    return save(fig, name)


def map_landcover_heat(X):
    rows = [(v["name"], v) for k, v in sorted(X["landcover"].items(), key=lambda kv: -kv[1]["population_share"]) if v["population_share"] > 0.0005]
    labels = [f"{n}  ({v['area_share'] * 100:.0f}% of area, {v['population_share'] * 100:.0f}% of people)" for n, v in rows]
    return chart_bars("m21_landcover_heat", "Heat island by land cover, 2020–2025",
                      "Median surface heat island of each cell, by ESA WorldCover 2021 class; cells with at least 3 clear passes",
                      labels, [([v["median_suhi_c"] for _, v in rows], "#d9500b", "Median heat island, °C")],
                      "°C warmer than the countryside (median cell)",
                      "Source: ESA WorldCover 2021; Landsat Collection 2 Level 2 (Planetary Computer). Associations only: land cover and built-up density are not separated.")


def chart_distance_bands(X):
    bands = list(X["distance_bands"].items())
    labels = [f"{k}  ({v['population_share'] * 100:.0f}% of people)" for k, v in bands]
    return chart_bars("m22_distance_heat", "Heat along the green-space gradient, 2020–2025",
                      "Population-weighted mean heat island by distance from each cell to the nearest vegetated cell (NDVI ≥ 0.4)",
                      labels, [([v["pop_weighted_mean_suhi_c"] for _, v in bands], "#a93a08", "Population-weighted mean heat island, °C")],
                      "°C warmer than the countryside (population-weighted)",
                      "Source: Landsat Collection 2 Level 2 (Planetary Computer); WorldPop 2020 (modelled). Distance bands are not a walking network.")


def map_lga_beyond(B, X):
    vals = {n: v["population_beyond_300m_share"] * 100 for n, v in X["lga"].items()}
    return lga_values_map(B, "m23_lga_beyond300", "Share of residents beyond 300 m from green space, by LGA",
                          "WorldPop 2020 residents of each LGA whose cell is more than 300 m from vegetated land (NDVI ≥ 0.4)",
                          vals, HEAT, mcolors.Normalize(0, 100),
                          "% of LGA residents more than 300 m from green space", [0, 25, 50, 75, 100])


def map_lga_heat(B, X):
    vals = {n: v["pop_weighted_mean_suhi_c"] for n, v in X["lga"].items() if v["pop_weighted_mean_suhi_c"] is not None}
    return lga_values_map(B, "m24_lga_heat", "Population-weighted heat island by LGA, 2020–2025",
                          "Mean surface heat island of the cells where each LGA's residents live (WorldPop 2020 weights)",
                          vals, SUHI, SUHI_NORM, "°C warmer than the countryside (population-weighted)", [-4, -2, 0, 2, 4, 6, 8, 10], "both")


def map_veg_sensitivity(B, thr, name):
    d, _ = load(f"veg_distance_{thr}_m.tif")
    d = np.where(d < 0, np.nan, d)
    return single(B, name, f"Walking distance to green space at NDVI ≥ {thr}, 2020–2025",
                  f"Sensitivity check: the same analysis with a vegetation cut-off of {thr} instead of 0.4",
                  np.where(B.inside > 0, np.minimum(d, 1000), np.nan),
                  mcolors.LinearSegmentedColormap.from_list("dist", ["#0b461e", "#7fc283", "#f3efe2", "#d9a26b", "#8a4a1c"]),
                  mcolors.Normalize(0, 1000), "Distance to vegetation, m (1000 m and above as one class)", [0, 300, 600, 1000], "max",
                  source="USGS Landsat NDVI median 2020–2025")


def main():
    B = Base()
    built = {}
    built["m01_reference"] = map_reference(B)
    built["m02_landcover"] = map_landcover(B)
    lst, _ = load(f"{LATEST}_lst_median.tif"); suhi, _ = load(f"{LATEST}_suhi_median.tif")
    ndvi, _ = load(f"{LATEST}_ndvi_median.tif"); ndbi, _ = load(f"{LATEST}_ndbi_median.tif")
    lo, hi = np.nanpercentile(lst[B.inside > 0], [2, 98])
    built["m03_lst"] = single(B, "m03_lst", "Land surface temperature, dry season 2020–2025", period_note(LATEST) + " · median per 60 m cell",
                              lst, HEAT, mcolors.Normalize(np.floor(lo), np.ceil(hi)), "Land surface temperature, °C (median of clear mornings)", extend="both")
    built["m04_suhi"] = single(B, "m04_suhi", "Surface heat island, dry season 2020–2025", period_note(LATEST) + " · each pass minus its own countryside reference",
                               suhi, SUHI, SUHI_NORM, "°C warmer (orange) or cooler (blue) than the countryside on the same morning",
                               ticks=[-4, -2, 0, 2, 4, 6, 8, 10], extend="both")
    built["m05_ndvi"] = single(B, "m05_ndvi", "Vegetation index (NDVI), dry season 2020–2025", period_note(LATEST) + " · Landsat surface reflectance, same passes as the temperature",
                               ndvi, GREEN, mcolors.Normalize(0, 0.7), "NDVI (higher = more green vegetation; water masked)", ticks=[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], extend="both")
    built["m06_ndbi"] = single(B, "m06_ndbi", "Built-up index (NDBI), dry season 2020–2025", period_note(LATEST) + " · a spectral index, not a mapped built-up area",
                               ndbi, NDBI, mcolors.TwoSlopeNorm(vmin=-0.4, vcenter=0, vmax=0.3), "NDBI (above 0: surfaces reflecting like roofs, roads and bare soil; below 0: vegetation)",
                               ticks=[-0.4, -0.2, 0, 0.1, 0.2, 0.3], extend="both")
    built["m07_suhi_periods"] = triple(B, "m07_suhi_periods", "Surface heat island in three periods, 2000–2025",
                                       "Same scale and extent in every panel; each period is one satellite generation, so differences between panels include sensor differences",
                                       "suhi_median", SUHI, SUHI_NORM, "°C relative to the countryside on the same morning", [-4, -2, 0, 2, 4, 6, 8, 10], "both")
    built["m08_ndvi_periods"] = triple(B, "m08_ndvi_periods", "Vegetation index (NDVI) in three periods, 2000–2025",
                                       "Same scale in every panel; Landsat 7 (ETM+) and Landsat 8/9 (OLI) red and near-infrared bands differ slightly", "ndvi_median",
                                       GREEN, mcolors.Normalize(0, 0.7), "NDVI", [0, 0.2, 0.4, 0.6], "both")
    built["m09_coverage"] = triple(B, "m09_coverage", "Observation coverage: clear passes per 60 m cell",
                                   "How many clear dry-season mornings each value rests on; Landsat 7 scan-line gaps show as stripes after 2003", "count",
                                   COUNT, mcolors.Normalize(0, 12), "Number of clear passes in the period", [0, 3, 6, 9, 12], "max")
    a, _ = load(f"{PERIODS[0]}_suhi_median.tif"); b, _ = load(f"{LATEST}_suhi_median.tif")
    ca, _ = load(f"{PERIODS[0]}_count.tif"); cb, _ = load(f"{LATEST}_count.tif")
    diff = np.where((ca >= 3) & (cb >= 3), b - a, np.nan)
    built["m10_change"] = single(B, "m10_change", "Change in the surface heat island, 2000–2012 to 2020–2025",
                                 "Difference of period medians, only where both periods have at least 3 clear passes; includes the Landsat 7 to Landsat 8/9 sensor difference",
                                 diff, CHANGE, mcolors.TwoSlopeNorm(vmin=-4, vcenter=0, vmax=4), "Change in °C (orange: warmer relative to the countryside)", [-4, -2, 0, 2, 4], "both")
    iqr, _ = load(f"{LATEST}_suhi_iqr.tif")
    built["m11_uncertainty"] = single(B, "m11_uncertainty", "Uncertainty of the heat island, 2020–2025",
                                      "Interquartile range across clear passes per cell (cells with at least 3 passes); larger means less stable from one morning to the next",
                                      iqr, COUNT, mcolors.Normalize(0, 4), "Interquartile range, °C", [0, 1, 2, 3, 4], "max")
    pop, _ = load("population_2020.tif")
    dens = pop / 0.0036
    built["m12_population"] = single(B, "m12_population", "Population density, 2020", "WorldPop 2020, 100 m, people per km² (log scale); a modelled estimate, not a census count",
                                     np.where(dens > 0, dens, np.nan), POP, mcolors.LogNorm(100, 100000), "People per km²", [100, 1000, 10000, 100000], "both",
                                     source="WorldPop 2020 (unconstrained, 100 m)")
    nd_a, _ = load(f"{PERIODS[0]}_ndvi_median.tif"); nd_b, _ = load(f"{LATEST}_ndvi_median.tif")
    built["m16_ndvi_change"] = single(B, "m16_ndvi_change", "Change in vegetation index (NDVI), 2000–2012 to 2020–2025",
                                      "Difference of period medians where both periods have at least 3 clear passes; includes the Landsat 7 to Landsat 8/9 band difference",
                                      np.where((ca >= 3) & (cb >= 3), nd_b - nd_a, np.nan), mcolors.LinearSegmentedColormap.from_list("dn", ["#8a4a1c", "#d9a26b", "#f4f3ef", "#8cc48f", "#1f6b33"]),
                                      mcolors.TwoSlopeNorm(vmin=-0.4, vcenter=0, vmax=0.4), "Change in NDVI (brown: less vegetation; green: more)", [-0.4, -0.2, 0, 0.2, 0.4], "both")
    A = json.loads((ROOT / "docs" / "data" / "map_analysis.json").read_text())
    built["m13_hotspots"] = map_hotspots(B, A)
    built["m14_ndvi_heat"] = map_bivariate(B, A)
    built["m15_exposure"] = chart_exposure(A)
    # access and low-ground maps (scripts/access_analysis.py writes the rasters and docs/data/access.json)
    X = json.loads((ROOT / "docs" / "data" / "access.json").read_text())
    dist, _ = load("veg_distance_m.tif")
    built["m17_green_access"] = single(B, "m17_green_access", "Walking distance to green space, 2020–2025",
                                       f"Distance to the nearest vegetated 60 m cell (dry-season NDVI ≥ {X['veg_ndvi_threshold']}); "
                                       f"{X['population_beyond_300m_share'] * 100:.0f}% of the 2020 population lives more than {X['access_m']:.0f} m from one "
                                       f"({X['population_beyond_300m_ndvi_sensitivity']['0.3']['population_beyond_300m_share'] * 100:.0f}–"
                                       f"{X['population_beyond_300m_ndvi_sensitivity']['0.5']['population_beyond_300m_share'] * 100:.0f}% for NDVI 0.3–0.5)",
                                       np.where(B.inside > 0, np.minimum(dist, 1000), np.nan),
                                       mcolors.LinearSegmentedColormap.from_list("dist", ["#0b461e", "#7fc283", "#f3efe2", "#d9a26b", "#8a4a1c"]),
                                       mcolors.Normalize(0, 1000), "Distance to vegetation, m (straight line; 1000 m and above shown as one class)",
                                       [0, 300, 600, 1000], "max", source="USGS Landsat NDVI median 2020–2025; WorldPop 2020 (modelled)")
    low, _ = load("low_ground_10m.tif")
    built["m18_low_ground"] = single(B, "m18_low_ground", "Low ground below 10 m, Lagos",
                                     f"Copernicus DEM GLO-30 elevation proxy for flood-prone ground, not a flood map; "
                                     f"{X['low_ground_area_share'] * 100:.0f}% of the study area and {X['low_ground_population_share'] * 100:.0f}% of the 2020 population are below 10 m",
                                     np.where(low == 1, 1.0, np.where(low == 0, 0.0, np.nan)),
                                     mcolors.ListedColormap(["#f3efe2", "#1c5cab"]), mcolors.Normalize(0, 1),
                                     "0 = at or above 10 m (light); 1 = below 10 m (blue)", [0, 1], "neither", source="Copernicus DEM GLO-30 (Planetary Computer)")
    built["m19_low_ground_heat"] = single(B, "m19_low_ground_heat", "Surface heat island on low ground, 2020–2025",
                                          f"Only cells below 10 m; cell median {X['heat_low_minus_other_median_c']:+.1f} °C against higher ground; "
                                          f"descriptive, no interval (cells are spatially dependent)",
                                          np.where((low == 1) & np.isfinite(suhi), suhi, np.nan), SUHI, SUHI_NORM,
                                          "°C warmer (orange) or cooler (blue) than the countryside", [-4, -2, 0, 2, 4, 6, 8, 10], "both")
    # extra analysis maps (scripts/extra_analysis.py writes the class rasters and docs/data/extra_analysis.json)
    global EXTRA
    EXTRA = json.loads((ROOT / "docs" / "data" / "extra_analysis.json").read_text())
    built["m20_access_gap"] = map_access_gap(B, EXTRA)
    built["m21_landcover_heat"] = map_landcover_heat(EXTRA)
    built["m22_distance_heat"] = chart_distance_bands(EXTRA)
    built["m23_lga_beyond300"] = map_lga_beyond(B, EXTRA)
    built["m24_lga_heat"] = map_lga_heat(B, EXTRA)
    built["m25_veg_ndvi03"] = map_veg_sensitivity(B, 0.3, "m25_veg_ndvi03")
    built["m26_veg_ndvi05"] = map_veg_sensitivity(B, 0.5, "m26_veg_ndvi05")
    (OUT.parent.parent / "data").mkdir(exist_ok=True)
    (ROOT / "docs" / "data" / "maps.json").write_text(json.dumps({"built": DATE, "maps": built, "rasters": meta(), "worldcover_accuracy_africa_pct": WC_ACC_AFRICA}, indent=1) + "\n")
    print(json.dumps(built, indent=1))


if __name__ == "__main__":
    main()
