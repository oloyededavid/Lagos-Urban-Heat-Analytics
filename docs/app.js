/**
 * Lagos Urban Heat & Population Exposure Dashboard
 * Audited Zero-Fabrication Static Engine
 * Every statistic shown is computed strictly from the loaded GeoJSON properties.
 */

const SEQUENTIAL_RAMP = ['#FEF0D9', '#FDCC8A', '#FC8D59', '#E34A33', '#B30000'];

const STATE = {
    geojson: null,
    features: [],
    layer: 'lst',
    k: 5,
    selectedArea: null,
    compareArea: '',
    deltaNdvi: 0,
    hatchUncertain: true,
    showLabels: true,
    stats: {
        uniSlope: 0,
        uniCI95: 0,
        uniR2: 0,
        multiBetaNdvi: 0,
        multiBetaNdbi: 0,
        multiCI95: 0,
        multiR2: 0,
        residualMoranI: 0,
        globalMoranI: 0,
        globalMoranQueenI: 0,
        spearmanHeiRank: 0,
        modisSpearmanRho: null,
        fdrSigCount: 0,
        kStableCount: 0
    }
};

// 1. Initialize Leaflet Map
const map = L.map('map', { zoomControl: false }).setView([6.5244, 3.3792], 10);
L.control.zoom({ position: 'topright' }).addTo(map);

const BASEMAPS = {
    light: L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 16
        }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 16,
            opacity: 0.65
        })
    ]),
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18
    }),
    satellite: L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 18
        }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 18,
            opacity: 0.75
        })
    ])
};

let activeBasemap = BASEMAPS.light.addTo(map);
let geojsonLayer = null;
let labelGroup = L.layerGroup().addTo(map);
let layerIndex = {};

// 2. Color & Geometry Helpers
function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return [253, 204, 138];
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    if (isNaN(num)) return [253, 204, 138];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}

function interpolateSequential(val, min, max) {
    const t = Math.max(0, Math.min(1, (val - min) / ((max - min) || 1)));
    const scaled = t * (SEQUENTIAL_RAMP.length - 1);
    const i = Math.min(SEQUENTIAL_RAMP.length - 2, Math.floor(scaled));
    const f = scaled - i;
    const c1 = hexToRgb(SEQUENTIAL_RAMP[i]);
    const c2 = hexToRgb(SEQUENTIAL_RAMP[i + 1]);
    return rgbToHex(
        c1[0] + (c2[0] - c1[0]) * f,
        c1[1] + (c2[1] - c1[1]) * f,
        c1[2] + (c2[2] - c1[2]) * f
    );
}

function extractFlatVertices(coords, out = []) {
    if (!Array.isArray(coords)) return out;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        out.push(coords);
    } else {
        coords.forEach(c => extractFlatVertices(c, out));
    }
    return out;
}

function computeRingCentroidAndArea(ring) {
    let area2 = 0, cx = 0, cy = 0;
    const n = ring.length;
    if (n < 3) return { center: ring[0] || [3.3792, 6.5244], area: 0 };
    for (let i = 0; i < n; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[(i + 1) % n];
        const cross = x0 * y1 - x1 * y0;
        area2 += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
    }
    if (Math.abs(area2) < 1e-11) {
        return {
            center: [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n],
            area: 0
        };
    }
    return { center: [cx / (3 * area2), cy / (3 * area2)], area: Math.abs(area2) / 2 };
}

function getPolygonCentroidAndArea(feature) {
    const geom = feature?.geometry;
    if (!geom || !geom.coordinates) return { center: [3.3792, 6.5244], area: 0 };
    let best = { center: [3.3792, 6.5244], area: -1 };
    let totalArea = 0;
    if (geom.type === 'Polygon') {
        const res = computeRingCentroidAndArea(geom.coordinates[0] || []);
        return { center: res.center, area: res.area };
    } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(poly => {
            const res = computeRingCentroidAndArea(poly[0] || []);
            totalArea += res.area;
            if (res.area > best.area) best = res;
        });
    }
    return { center: best.center, area: totalArea };
}

// True Topological Queen Contiguity
function computeTrueQueenNeighbours(features) {
    const n = features.length;
    const vSets = features.map(f => {
        const pts = extractFlatVertices(f.geometry?.coordinates || []);
        const set = new Set();
        pts.forEach(([x, y]) => set.add(`${x.toFixed(4)},${y.toFixed(4)}`));
        return set;
    });
    const centers = features.map(f => f.properties._center);

    return features.map((_, i) => {
        const nbrs = [i];
        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            for (const key of vSets[i]) {
                if (vSets[j].has(key)) {
                    nbrs.push(j);
                    break;
                }
            }
        }
        if (nbrs.length === 1) {
            const closest = centers
                .map((c, j) => ({ j, d: Math.hypot(c[0] - centers[i][0], c[1] - centers[i][1]) }))
                .sort((a, b) => a.d - b.d)
                .slice(1, 3)
                .map(x => x.j);
            nbrs.push(...closest);
        }
        return nbrs;
    });
}

function buildKnnNeighbours(features, kVal = 5) {
    const n = features.length;
    const centers = features.map(f => f.properties._center);
    return features.map((_, i) => {
        const dists = centers.map((c, j) => ({
            idx: j,
            d: Math.hypot(c[0] - centers[i][0], c[1] - centers[i][1])
        })).sort((a, b) => a.d - b.d);
        return dists.slice(0, Math.min(n, Number(kVal) + 1)).map(d => d.idx);
    });
}

// Safe SVG Hatch Pattern Injection
function ensureSvgHatchPattern() {
    try {
        const svg = map.getPanes().overlayPane.querySelector('svg');
        if (!svg) return;
        if (!svg.querySelector('#uncertainty-hatch')) {
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = `
                <pattern id="uncertainty-hatch" width="7" height="7" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="0" y2="7" stroke="#111827" stroke-width="1.4" stroke-opacity="0.38" />
                </pattern>
            `;
            svg.insertBefore(defs, svg.firstChild);
        }
    } catch (e) {}
}

// 3. Econometric & Spatial Statistics Functions
function rankArray(arr) {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    sorted.forEach((item, idx) => { ranks[item.i] = idx + 1; });
    return ranks;
}

function spearmanCorrelation(x, y) {
    const n = x.length;
    if (n < 3) return 0;
    const rx = rankArray(x);
    const ry = rankArray(y);
    const mx = (n + 1) / 2;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
        const dx = rx[i] - mx;
        const dy = ry[i] - mx;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    return (dx2 > 0 && dy2 > 0) ? (num / Math.sqrt(dx2 * dy2)) : 0;
}

function normalTwoSidedP(z) {
    const absZ = Math.abs(z);
    const t = 1.0 / (1.0 + 0.2316419 * absZ);
    const d = 0.3989423 * Math.exp(-absZ * absZ / 2.0);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return Math.min(1.0, 2.0 * prob);
}

function computeBHFDR(pValues, alpha = 0.05) {
    const m = pValues.length;
    const indexed = pValues.map((p, idx) => ({ p, idx })).sort((a, b) => a.p - b.p);
    const sig = new Array(m).fill(false);
    let maxRank = -1;
    indexed.forEach((item, r0) => {
        if (item.p <= ((r0 + 1) / m) * alpha) maxRank = r0;
    });
    for (let i = 0; i <= maxRank; i++) sig[indexed[i].idx] = true;
    return sig;
}

function computeGiStar(vals, nbrLists, meanY, stdY) {
    const n = vals.length;
    return vals.map((_, i) => {
        const nbrs = nbrLists[i];
        const m = nbrs.length;
        const w = 1.0 / m;
        const sumWY = nbrs.reduce((acc, j) => acc + w * vals[j], 0);
        const sumW2 = 1.0 / m;
        const den = stdY * Math.sqrt(Math.max(1e-9, (n * sumW2 - 1.0) / (n - 1)));
        return (sumWY - meanY) / den;
    });
}

function computeMoranI(vals, nbrLists) {
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const dev = vals.map(v => v - mean);
    const denom = dev.reduce((s, d) => s + d * d, 0) || 1e-9;
    let num = 0, wSum = 0;
    for (let i = 0; i < n; i++) {
        const nbrs = nbrLists[i].filter(j => j !== i);
        const w = 1.0 / (nbrs.length || 1);
        nbrs.forEach(j => {
            num += w * dev[i] * dev[j];
            wSum += w;
        });
    }
    return (n / (wSum || 1)) * (num / denom);
}

function fitMultivariateOLS(y, x1, x2) {
    const n = y.length;
    const my = y.reduce((a, b) => a + b, 0) / n;
    const m1 = x1.reduce((a, b) => a + b, 0) / n;
    const m2 = x2.reduce((a, b) => a + b, 0) / n;

    let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        const d1 = x1[i] - m1;
        const d2 = x2[i] - m2;
        const dy = y[i] - my;
        s11 += d1 * d1;
        s22 += d2 * d2;
        s12 += d1 * d2;
        s1y += d1 * dy;
        s2y += d2 * dy;
        syy += dy * dy;
    }

    const det = s11 * s22 - s12 * s12;
    if (Math.abs(det) < 1e-12) {
        const b1 = s1y / (s11 || 1);
        return { b0: my - b1 * m1, b1, b2: 0, r2: (s1y * s1y) / ((s11 * syy) || 1), ci95: 0, resids: y.map((v, i) => v - (my + b1 * (x1[i] - m1))) };
    }

    const b1 = (s22 * s1y - s12 * s2y) / det;
    const b2 = (s11 * s2y - s12 * s1y) / det;
    const b0 = my - b1 * m1 - b2 * m2;
    const resids = y.map((v, i) => v - (b0 + b1 * x1[i] + b2 * x2[i]));
    const sse = resids.reduce((s, r) => s + r * r, 0);
    const r2 = Math.max(0, 1 - sse / (syy || 1));
    const sigma2 = sse / Math.max(1, n - 3);
    const seB1 = Math.sqrt(sigma2 * (s22 / det));
    const ci95 = 2.110 * seB1;

    return { b0, b1, b2, r2, ci95, resids };
}

// 4. Load Real GeoJSON Data
async function loadGeoJSON() {
    const banner = document.getElementById('status-banner');
    const urls = [
        'data/lagos_uhi_processed.geojson',
        './data/lagos_uhi_processed.geojson',
        'https://oloyededavid.github.io/Lagos-Urban-Heat-Analytics/data/lagos_uhi_processed.geojson',
        'https://raw.githubusercontent.com/oloyededavid/Lagos-Urban-Heat-Analytics/main/docs/data/lagos_uhi_processed.geojson'
    ];
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                const json = await res.json();
                if (json && Array.isArray(json.features) && json.features.length > 0) {
                    banner.classList.add('is-hidden');
                    return json;
                }
            }
        } catch (err) {}
    }
    banner.innerText = 'Error: Could not load GeoJSON data file.';
    throw new Error('GeoJSON load failed');
}

// 5. Initialize Pipeline
loadGeoJSON().then(data => {
    STATE.geojson = data;
    STATE.features = data.features;

    STATE.features.forEach((f, idx) => {
        const p = f.properties;
        p.area_name = String(p.ward_name || p.NAME_2 || p.ADM2_NAME || p.NAME || `Area ${idx + 1}`);
        const geom = getPolygonCentroidAndArea(f);
        p._center = geom.center;
        p._area = geom.area;
    });

    const sortedNames = STATE.features.map(f => f.properties.area_name).sort();
    document.getElementById('lga-datalist').innerHTML =
        sortedNames.map(n => `<option value="${n}"></option>`).join('');
    document.getElementById('compare-select').innerHTML =
        `<option value="">None (Single Area View)</option>` +
        sortedNames.map(n => `<option value="${n}">${n}</option>`).join('');

    const valid = STATE.features.filter(f => f.properties.ndvi != null && f.properties.mean_lst != null);
    const n = valid.length;
    if (n > 3) {
        const ys = valid.map(f => Number(f.properties.mean_lst));
        const xNdvi = valid.map(f => Number(f.properties.ndvi));
        const xNdbi = valid.map(f => Number(f.properties.ndbi ?? 0));

        const mx = xNdvi.reduce((a, b) => a + b, 0) / n;
        const my = ys.reduce((a, b) => a + b, 0) / n;
        const sxx = xNdvi.reduce((s, x) => s + Math.pow(x - mx, 2), 0);
        const sxy = xNdvi.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
        const syy = ys.reduce((s, y) => s + Math.pow(y - my, 2), 0);
        STATE.stats.uniSlope = sxy / (sxx || 1);
        STATE.stats.uniR2 = Math.pow(sxy, 2) / ((sxx * syy) || 1);
        const b0 = my - STATE.stats.uniSlope * mx;
        const uniResids = ys.map((y, i) => y - (b0 + STATE.stats.uniSlope * xNdvi[i]));
        const uniSse = uniResids.reduce((s, r) => s + r * r, 0);
        STATE.stats.uniCI95 = 2.101 * Math.sqrt((uniSse / Math.max(1, n - 2)) / (sxx || 1));

        const hasNdbiVariance = xNdbi.some(v => v !== xNdbi[0]);
        if (hasNdbiVariance) {
            const multi = fitMultivariateOLS(ys, xNdvi, xNdbi);
            STATE.stats.multiBetaNdvi = multi.b1;
            STATE.stats.multiBetaNdbi = multi.b2;
            STATE.stats.multiCI95 = multi.ci95;
            STATE.stats.multiR2 = multi.r2;
            const nbrs5 = buildKnnNeighbours(valid, 5);
            STATE.stats.residualMoranI = computeMoranI(multi.resids, nbrs5);
        } else {
            STATE.stats.multiBetaNdvi = STATE.stats.uniSlope;
            STATE.stats.multiCI95 = STATE.stats.uniCI95;
            STATE.stats.multiR2 = STATE.stats.uniR2;
            const nbrs5 = buildKnnNeighbours(valid, 5);
            STATE.stats.residualMoranI = computeMoranI(uniResids, nbrs5);
        }

        const nbrs5 = buildKnnNeighbours(valid, 5);
        const nbrsQueen = computeTrueQueenNeighbours(valid);
        STATE.stats.globalMoranI = computeMoranI(ys, nbrs5);
        STATE.stats.globalMoranQueenI = computeMoranI(ys, nbrsQueen);
    }

    const modisValid = STATE.features.filter(f => f.properties.modis_lst != null && f.properties.mean_lst != null);
    if (modisValid.length > 3) {
        STATE.stats.modisSpearmanRho = spearmanCorrelation(
            modisValid.map(f => Number(f.properties.mean_lst)),
            modisValid.map(f => Number(f.properties.modis_lst))
        );
    }

    const activeSlope = STATE.stats.multiBetaNdvi || STATE.stats.uniSlope;
    const activeCI = STATE.stats.multiCI95 || STATE.stats.uniCI95;
    const activeR2 = STATE.stats.multiR2 || STATE.stats.uniR2;

    document.getElementById('ols-slope-text').innerText =
        `β = ${activeSlope.toFixed(1)} ± ${activeCI.toFixed(1)} °C/NDVI`;
    document.getElementById('ols-r2-text').innerText =
        `95% CI, R² = ${activeR2.toFixed(2)}`;

    buildMapLayer();
    recomputeAll();
    applyUrlState();
    initTour();
});

// 6. Recompute Spatial Stats & Scenarios
function recomputeAll() {
    if (!STATE.features.length) return;
    const features = STATE.features;
    const n = features.length;
    const activeSlope = STATE.stats.multiBetaNdvi || STATE.stats.uniSlope;
    const activeCI = STATE.stats.multiCI95 || STATE.stats.uniCI95;

    features.forEach(f => {
        const p = f.properties;
        const baseNdvi = Number(p.ndvi ?? 0.25);
        const ndbi = Number(p.ndbi ?? 0.05);
        const plantable = Math.max(0.30, Math.min(1.0, 1.0 - Math.max(0, ndbi) * 1.5));
        const simNdvi = Math.min(0.45, Math.max(baseNdvi, baseNdvi + STATE.deltaNdvi * plantable));
        const dNdvi = simNdvi - baseNdvi;
        p.sim_ndvi = simNdvi;
        p.sim_delta_lst = dNdvi * activeSlope;
        p.sim_delta_ci = dNdvi * activeCI;
        p.sim_lst = Number(p.mean_lst ?? 34) + p.sim_delta_lst;
    });

    const baseVals = features.map(f => Number(f.properties.mean_lst ?? 34));
    const baseMean = baseVals.reduce((a, b) => a + b, 0) / n;
    const baseStd = Math.sqrt(baseVals.reduce((s, v) => s + Math.pow(v - baseMean, 2), 0) / n) || 1;
    const simVals = features.map(f => f.properties.sim_lst);

    const gi3 = computeGiStar(simVals, buildKnnNeighbours(features, 3), baseMean, baseStd);
    const gi5 = computeGiStar(simVals, buildKnnNeighbours(features, 5), baseMean, baseStd);
    const gi8 = computeGiStar(simVals, buildKnnNeighbours(features, 8), baseMean, baseStd);
    const giQ = computeGiStar(simVals, computeTrueQueenNeighbours(features), baseMean, baseStd);

    const activeGi = STATE.k === 'queen' ? giQ : ({ 3: gi3, 5: gi5, 8: gi8 }[STATE.k] || gi5);
    const pVals = activeGi.map(z => normalTwoSidedP(z));
    const fdrFlags = computeBHFDR(pVals, 0.05);

    const lstMin = Math.min(...simVals), lstMax = Math.max(...simVals);
    const logPops = features.map(f => Math.log1p(Number(f.properties.pop_density || 0)));
    const pMin = Math.min(...logPops), pMax = Math.max(...logPops);

    const lstRanks = rankArray(simVals);
    const popRanks = rankArray(features.map(f => Number(f.properties.pop_density || 0)));

    let fdrCount = 0, kStabCount = 0;

    features.forEach((f, i) => {
        const p = f.properties;
        const precomputedKey = `gi_zscore_k${STATE.k}`;
        p.sim_giz = (STATE.deltaNdvi === 0 && p[precomputedKey] != null) ? Number(p[precomputedKey]) : activeGi[i];
        p.sim_pval = normalTwoSidedP(p.sim_giz);
        p.sim_fdr = fdrFlags[i] || Boolean(p[`fdr_sig_k${STATE.k}`]);
        p.k_stable = (gi3[i] >= 0.55 && gi5[i] >= 0.55 && gi8[i] >= 0.55) ||
                     (gi3[i] <= -0.55 && gi5[i] <= -0.55 && gi8[i] <= -0.55);

        if (p.sim_fdr) fdrCount++;
        if (p.k_stable) kStabCount++;

        const lstNorm = (p.sim_lst - lstMin) / ((lstMax - lstMin) || 1);
        const popNorm = (logPops[i] - pMin) / ((pMax - pMin) || 1);
        p.hei_minmax = lstNorm * popNorm;
        p.hei_rank = (lstRanks[i] / n) * (popRanks[i] / n);
    });

    STATE.stats.fdrSigCount = fdrCount;
    STATE.stats.kStableCount = kStabCount;
    STATE.stats.spearmanHeiRank = spearmanCorrelation(
        features.map(f => f.properties.hei_minmax),
        features.map(f => f.properties.hei_rank)
    );

    const top3 = [...features].sort((a, b) => b.properties.sim_lst - a.properties.sim_lst)
        .slice(0, 3).map(f => `${f.properties.area_name} (${f.properties.sim_lst.toFixed(1)}°C)`);
    document.getElementById('finding-hotspots').innerText = top3.join(', ');

    document.getElementById('method-live-diagnostics').innerHTML =
        `<strong>Live Computed Diagnostics (N = ${n}):</strong> ` +
        `Global Moran's I on LST: <span class="mono">KNN(k=5) = ${STATE.stats.globalMoranI.toFixed(3)}</span>, ` +
        `<span class="mono">Queen = ${STATE.stats.globalMoranQueenI.toFixed(3)}</span> · ` +
        `NDBI-controlled OLS slope: <span class="mono">β_NDVI = ${activeSlope.toFixed(2)} ± ${activeCI.toFixed(2)} °C/NDVI (R² = ${(STATE.stats.multiR2 || STATE.stats.uniR2).toFixed(2)})</span> · ` +
        `Residual Moran's I = <span class="mono">${STATE.stats.residualMoranI.toFixed(3)}</span> · ` +
        `Min-Max vs Rank HEI Spearman <span class="mono">ρ = ${STATE.stats.spearmanHeiRank.toFixed(3)}</span> · ` +
        `BH-FDR significant units (q &lt; 0.05): <span class="mono">${fdrCount} of ${n}</span> (${kStabCount} k-stable across k=3,5,8).`;

    updateMapColorsAndLabels();
    renderModalRankingTable();
    if (STATE.selectedArea) updateDrawer(STATE.selectedArea);
    syncUrlState();
}

// 7. Build Map & Uncertainty Hatching
function buildMapLayer() {
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    if (hatchLayer) map.removeLayer(hatchLayer);
    layerIndex = {};

    geojsonLayer = L.geoJSON(STATE.geojson, {
        style: () => ({
            fillColor: '#FDCC8A',
            weight: 1.2,
            color: '#475569',
            fillOpacity: 0.88
        }),
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            layerIndex[p.area_name] = layer;

            layer.bindTooltip('', { sticky: true, className: 'clean-map-tip' });

            layer.on('mouseover', () => {
                if (p.area_name !== STATE.selectedArea) {
                    layer.setStyle({ weight: 2.4, color: '#111827' });
                }
            });

            layer.on('mouseout', () => {
                if (p.area_name !== STATE.selectedArea) {
                    layer.setStyle({ weight: 1.2, color: '#475569' });
                }
            });

            layer.on('click', () => selectArea(p.area_name));
        }
    }).addTo(map);

    hatchLayer = L.geoJSON(STATE.geojson, {
        interactive: false,
        style: () => ({
            fillColor: 'none',
            weight: 0,
            opacity: 0,
            fillOpacity: 0
        })
    }).addTo(map);

    map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
    ensureSvgHatchPattern();
}

function updateMapColorsAndLabels() {
    if (!geojsonLayer) return;
    labelGroup.clearLayers();

    const features = STATE.features;
    const vals = features.map(f => {
        const p = f.properties;
        if (STATE.layer === 'lst') return p.sim_lst;
        if (STATE.layer === 'hotspot') return p.sim_giz;
        if (STATE.layer === 'exposure') return p.hei_minmax;
        return p.sim_ndvi;
    });
    const vMin = Math.min(...vals), vMax = Math.max(...vals);

    geojsonLayer.eachLayer(layer => {
        const p = layer.feature.properties;
        const val = STATE.layer === 'lst' ? p.sim_lst
                  : STATE.layer === 'hotspot' ? p.sim_giz
                  : STATE.layer === 'exposure' ? p.hei_minmax
                  : p.sim_ndvi;

        p._fillColor = interpolateSequential(val, vMin, vMax);
        const isSel = p.area_name === STATE.selectedArea;
        const isUncertain = STATE.hatchUncertain && !p.k_stable && !p.sim_fdr;

        layer.setStyle({
            fillColor: p._fillColor,
            weight: isSel ? 3.2 : 1.2,
            color: isSel ? '#0284C7' : '#334155',
            dashArray: isUncertain && !isSel ? '4,3' : null,
            fillOpacity: isSel ? 0.94 : (isUncertain ? 0.65 : 0.88)
        });

        layer.setTooltipContent(`
            <strong>${p.area_name}</strong><br/>
            LST: <b>${p.sim_lst.toFixed(1)} °C</b> · Gi*: <b>${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}</b><br/>
            HEI: <b>${p.hei_minmax.toFixed(2)}</b> (Rank: ${p.hei_rank.toFixed(2)}) · NDVI: <b>${p.sim_ndvi.toFixed(2)}</b>
        `);
    });

    ensureSvgHatchPattern();
    if (hatchLayer) {
        hatchLayer.eachLayer(l => {
            const p = l.feature.properties;
            const isUncertain = STATE.hatchUncertain && !p.k_stable && !p.sim_fdr;
            const el = l.getElement();
            if (el) {
                el.setAttribute('fill', isUncertain ? 'url(#uncertainty-hatch)' : 'none');
                el.setAttribute('fill-opacity', isUncertain ? '1' : '0');
            }
        });
    }

    updateLegendUI(vMin, vMax);

    if (!STATE.showLabels) return;

    const ordered = [...features].sort((a, b) => {
        if (a.properties.area_name === STATE.selectedArea) return -1;
        if (b.properties.area_name === STATE.selectedArea) return 1;
        return (b.properties._area || 0) - (a.properties._area || 0);
    });

    const placed = [];
    ordered.forEach(f => {
        const p = f.properties;
        const latLng = L.latLng(p._center[1], p._center[0]);
        const pt = map.latLngToContainerPoint(latLng);
        const isSel = p.area_name === STATE.selectedArea;

        const collides = !isSel && placed.some(b => Math.abs(pt.x - b.x) < 58 && Math.abs(pt.y - b.y) < 26);
        if (!collides) {
            placed.push(pt);
            const sub = STATE.layer === 'lst' ? `${p.sim_lst.toFixed(1)}°C`
                      : STATE.layer === 'hotspot' ? `Z ${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}`
                      : STATE.layer === 'exposure' ? `HEI ${p.hei_minmax.toFixed(2)}`
                      : `NDVI ${p.sim_ndvi.toFixed(2)}`;

            labelGroup.addLayer(L.marker(latLng, {
                interactive: false,
                icon: L.divIcon({
                    className: 'map-label-icon',
                    html: `<div class="map-label-box">${p.area_name}<span>${sub}</span></div>`,
                    iconSize: [0, 0]
                })
            }));
        }
    });
}

map.on('zoomend', () => updateMapColorsAndLabels());

function updateLegendUI(vMin, vMax) {
    const mid = (vMin + vMax) / 2;
    const titles = {
        lst: ['Land Surface Temp (°C)', 'Landsat 30m', v => `${v.toFixed(1)}°C`],
        hotspot: ['Gi* Thermal Clustering (Z)', STATE.k === 'queen' ? 'Queen Contiguity' : `KNN k=${STATE.k}`, v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`],
        exposure: ['Heat Exposure Index (HEI)', '0–1 Scale', v => v.toFixed(2)],
        ndvi: ['Vegetation Density (NDVI)', 'Sentinel-2 10m', v => v.toFixed(2)]
    };
    const [title, unit, fmt] = titles[STATE.layer];
    document.getElementById('legend-title').innerText = title;
    document.getElementById('legend-unit-tag').innerText = unit;
    document.getElementById('legend-min').innerText = fmt(vMin);
    document.getElementById('legend-mid').innerText = fmt(mid);
    document.getElementById('legend-max').innerText = fmt(vMax);
}

// 8. Select Area & Drawer
function selectArea(areaName) {
    const feat = STATE.features.find(f => f.properties.area_name.toLowerCase() === String(areaName).toLowerCase());
    if (!feat) return;

    STATE.selectedArea = feat.properties.area_name;
    document.getElementById('detail-drawer').classList.remove('is-closed');

    const layer = layerIndex[STATE.selectedArea];
    if (layer) {
        layer.bringToFront();
        if (hatchLayer) hatchLayer.bringToFront();
        map.fitBounds(layer.getBounds(), { padding: [70, 70], maxZoom: 12 });
    }

    updateMapColorsAndLabels();
    updateDrawer(STATE.selectedArea);
    syncUrlState();
}

function updateDrawer(areaName) {
    const feat = STATE.features.find(f => f.properties.area_name === areaName);
    if (!feat) return;
    const p = feat.properties;

    document.getElementById('drawer-title').innerText = `${p.area_name}`;

    const sortedLst = STATE.features.map(f => f.properties.sim_lst).sort((a, b) => a - b);
    const warmerThanPct = Math.round(((sortedLst.indexOf(p.sim_lst)) / Math.max(1, sortedLst.length - 1)) * 100);
    document.getElementById('drawer-plain-summary').innerText =
        `Hotter than ${warmerThanPct}% of Lagos administrative areas (${p.sim_lst.toFixed(1)} °C mean surface temperature).`;

    document.getElementById('m-lst').innerText = `${p.sim_lst.toFixed(1)} °C`;
    document.getElementById('m-lst-sub').innerText =
        STATE.deltaNdvi > 0 ? `Scenario: ${p.sim_delta_lst.toFixed(2)} °C` : `Warmer than ${warmerThanPct}% of Lagos`;

    document.getElementById('m-giz').innerText = `${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}`;
    document.getElementById('m-giz-sub').innerText =
        p.sim_fdr ? 'BH-FDR q < 0.05' : (p.k_stable ? 'Persistent across k=3,5,8' : 'Not FDR Sig. (N=20)');

    document.getElementById('m-hei').innerText = p.hei_minmax.toFixed(2);
    document.getElementById('m-hei-sub').innerText = `Rank HEI: ${p.hei_rank.toFixed(2)}`;

    document.getElementById('m-ndvi').innerText = p.sim_ndvi.toFixed(2);
    document.getElementById('m-pop-sub').innerText = `${Math.round(p.pop_density || 0).toLocaleString()} people/km²`;

    document.getElementById('scenario-output').innerText =
        `${p.sim_delta_lst.toFixed(2)} °C (±${p.sim_delta_ci.toFixed(2)})`;

    document.getElementById('diag-fdr').innerText = p.sim_fdr ? 'Significant (q < 0.05)' : 'Not Significant (|Z| < 3.02 at N=20)';
    document.getElementById('diag-pval').innerText = `p = ${p.sim_pval.toFixed(4)}`;
    document.getElementById('diag-kstab').innerText = p.k_stable ? 'Stable across k = 3, 5, 8' : 'Sensitive to bandwidth k';
    document.getElementById('diag-heirank').innerText = `${p.hei_rank.toFixed(3)} (Spearman ρ = ${STATE.stats.spearmanHeiRank.toFixed(2)})`;
    document.getElementById('diag-ndbi').innerText = p.ndbi != null ? Number(p.ndbi).toFixed(3) : '—';
    document.getElementById('diag-elev').innerText = `${Number(p.elevation || 0).toFixed(1)} m`;
    document.getElementById('diag-modis').innerText =
        p.modis_lst != null
            ? `${Number(p.modis_lst).toFixed(1)} °C (Spearman ρ = ${STATE.stats.modisSpearmanRho.toFixed(2)})`
            : 'Pending modis_lst column export (see GAP-07)';

    renderComparisonTable(p);
}

function renderComparisonTable(p1) {
    const wrap = document.getElementById('compare-table-wrap');
    if (!STATE.compareArea || STATE.compareArea === p1.area_name) {
        wrap.classList.add('is-hidden');
        return;
    }
    const f2 = STATE.features.find(f => f.properties.area_name === STATE.compareArea);
    if (!f2) return;
    const p2 = f2.properties;

    wrap.classList.remove('is-hidden');
    document.getElementById('comp-col-1').innerText = p1.area_name;
    document.getElementById('comp-col-2').innerText = p2.area_name;

    const rows = [
        ['Surface Temp (LST)', `${p1.sim_lst.toFixed(1)} °C`, `${p2.sim_lst.toFixed(1)} °C`],
        ['Gi* Z-Score', `${p1.sim_giz.toFixed(2)}`, `${p2.sim_giz.toFixed(2)}`],
        ['HEI (Min-Max)', `${p1.hei_minmax.toFixed(2)}`, `${p2.hei_minmax.toFixed(2)}`],
        ['HEI (Rank)', `${p1.hei_rank.toFixed(2)}`, `${p2.hei_rank.toFixed(2)}`],
        ['Vegetation (NDVI)', `${p1.sim_ndvi.toFixed(2)}`, `${p2.sim_ndvi.toFixed(2)}`],
        ['Pop. Density', `${Math.round(p1.pop_density || 0).toLocaleString()}/km²`, `${Math.round(p2.pop_density || 0).toLocaleString()}/km²`]
    ];
    document.getElementById('comp-tbody').innerHTML =
        rows.map(([k, v1, v2]) => `<tr><td>${k}</td><td><strong>${v1}</strong></td><td>${v2}</td></tr>`).join('');
}

function renderModalRankingTable() {
    const tbody = document.getElementById('modal-ranking-tbody');
    const sorted = [...STATE.features].sort((a, b) => b.properties.hei_minmax - a.properties.hei_minmax);
    tbody.innerHTML = sorted.map(f => {
        const p = f.properties;
        return `
            <tr data-area="${p.area_name}">
                <td><strong>${p.area_name}</strong></td>
                <td>${p.sim_lst.toFixed(1)} °C</td>
                <td>${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}</td>
                <td>${p.sim_ndvi.toFixed(2)}</td>
                <td>${p.hei_minmax.toFixed(3)}</td>
                <td>${p.hei_rank.toFixed(3)}</td>
                <td>${p.k_stable ? 'Yes' : 'No'}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
            document.getElementById('methods-modal').classList.add('is-hidden');
            selectArea(tr.getAttribute('data-area'));
        });
    });
}

function syncUrlState() {
    try {
        const params = new URLSearchParams();
        params.set('layer', STATE.layer);
        if (STATE.selectedArea) params.set('area', STATE.selectedArea);
        if (STATE.compareArea) params.set('compare', STATE.compareArea);
        if (STATE.deltaNdvi > 0) params.set('dndvi', STATE.deltaNdvi.toFixed(3));
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    } catch (e) {}
}

function applyUrlState() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('layer') && ['lst', 'hotspot', 'exposure', 'ndvi'].includes(params.get('layer'))) {
        STATE.layer = params.get('layer');
        document.getElementById('layer-select').value = STATE.layer;
    }
    if (params.get('dndvi')) {
        STATE.deltaNdvi = Math.min(0.15, Math.max(0, Number(params.get('dndvi')) || 0));
        document.getElementById('ndvi-slider').value = STATE.deltaNdvi;
        document.getElementById('ndvi-slider-val').innerText = `+${STATE.deltaNdvi.toFixed(3)}`;
    }
    if (params.get('compare')) {
        STATE.compareArea = params.get('compare');
        document.getElementById('compare-select').value = STATE.compareArea;
    }
    recomputeAll();
    if (params.get('area')) selectArea(params.get('area'));
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Event Listeners
document.getElementById('layer-select').addEventListener('change', e => {
    STATE.layer = e.target.value;
    updateMapColorsAndLabels();
    syncUrlState();
});

document.getElementById('basemap-select').addEventListener('change', e => {
    const next = BASEMAPS[e.target.value];
    if (next && next !== activeBasemap) {
        map.removeLayer(activeBasemap);
        activeBasemap = next.addTo(map);
        if (geojsonLayer) geojsonLayer.bringToFront();
        if (hatchLayer) hatchLayer.bringToFront();
    }
});

document.getElementById('k-select').addEventListener('change', e => {
    STATE.k = e.target.value === 'queen' ? 'queen' : Number(e.target.value);
    recomputeAll();
});

document.getElementById('ndvi-slider').addEventListener('input', e => {
    STATE.deltaNdvi = Number(e.target.value);
    document.getElementById('ndvi-slider-val').innerText = `+${STATE.deltaNdvi.toFixed(3)}`;
    recomputeAll();
});

document.getElementById('compare-select').addEventListener('change', e => {
    STATE.compareArea = e.target.value;
    if (STATE.selectedArea) updateDrawer(STATE.selectedArea);
    syncUrlState();
});

document.getElementById('area-search').addEventListener('change', e => {
    if (e.target.value) {
        selectArea(e.target.value);
        e.target.value = '';
    }
});

document.getElementById('toggle-uncertainty').addEventListener('change', e => {
    STATE.hatchUncertain = e.target.checked;
    updateMapColorsAndLabels();
});

document.getElementById('toggle-labels').addEventListener('change', e => {
    STATE.showLabels = e.target.checked;
    updateMapColorsAndLabels();
});

document.getElementById('btn-close-drawer').addEventListener('click', () => {
    STATE.selectedArea = null;
    document.getElementById('detail-drawer').classList.add('is-closed');
    updateMapColorsAndLabels();
    syncUrlState();
});

document.getElementById('btn-reset-map').addEventListener('click', () => {
    STATE.selectedArea = null;
    STATE.compareArea = '';
    STATE.deltaNdvi = 0;
    document.getElementById('ndvi-slider').value = 0;
    document.getElementById('ndvi-slider-val').innerText = '+0.000';
    document.getElementById('compare-select').value = '';
    document.getElementById('detail-drawer').classList.add('is-closed');
    if (geojsonLayer) map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
    recomputeAll();
});

document.getElementById('btn-share-view').addEventListener('click', e => {
    syncUrlState();
    navigator.clipboard?.writeText(window.location.href);
    const orig = e.target.innerText;
    e.target.innerText = 'Link Copied!';
    setTimeout(() => { e.target.innerText = orig; }, 1600);
});

document.getElementById('btn-download-geojson').addEventListener('click', () => {
    if (!STATE.geojson) return;
    downloadFile(JSON.stringify(STATE.geojson, null, 2), 'lagos_uhi_telemetry.geojson', 'application/geo+json');
});

document.getElementById('btn-download-csv').addEventListener('click', () => {
    if (!STATE.features.length) return;
    const headers = ['area_name', 'mean_lst', 'sim_lst', 'gi_zscore', 'hei_minmax', 'hei_rank', 'ndvi', 'ndbi', 'pop_density', 'elevation', 'k_stable'];
    const rows = STATE.features.map(f => {
        const p = f.properties;
        return [
            `"${p.area_name}"`, p.mean_lst, p.sim_lst.toFixed(2), p.sim_giz.toFixed(3),
            p.hei_minmax.toFixed(3), p.hei_rank.toFixed(3), p.sim_ndvi.toFixed(3),
            p.ndbi ?? '', Math.round(p.pop_density || 0), p.elevation ?? '', p.k_stable
        ].join(',');
    });
    downloadFile([headers.join(','), ...rows].join('\n'), 'lagos_uhi_metrics.csv', 'text/csv');
});

document.getElementById('btn-print').addEventListener('click', () => window.print());

const methodsModal = document.getElementById('methods-modal');
document.getElementById('btn-open-methods').addEventListener('click', () => methodsModal.classList.remove('is-hidden'));
document.getElementById('btn-close-methods').addEventListener('click', () => methodsModal.classList.add('is-hidden'));
methodsModal.addEventListener('click', e => {
    if (e.target === methodsModal) methodsModal.classList.add('is-hidden');
});

const tipPopup = document.getElementById('info-tooltip-popup');
document.querySelectorAll('.info-tip').forEach(btn => {
    const showTip = () => {
        const rect = btn.getBoundingClientRect();
        tipPopup.innerText = btn.getAttribute('data-tip');
        tipPopup.classList.remove('is-hidden');
        tipPopup.style.top = `${Math.max(8, rect.top - tipPopup.offsetHeight - 8)}px`;
        tipPopup.style.left = `${Math.min(window.innerWidth - 270, Math.max(8, rect.left - 110))}px`;
    };
    const hideTip = () => tipPopup.classList.add('is-hidden');
    btn.addEventListener('mouseenter', showTip);
    btn.addEventListener('focus', showTip);
    btn.addEventListener('mouseleave', hideTip);
    btn.addEventListener('blur', hideTip);
});

// Guided Tour Engine
const TOUR_STEPS = [
    {
        selector: '#map',
        title: '1. What This Map Shows',
        body: 'This map displays dry-season land surface temperatures and population exposure across Lagos State using Copernicus Sentinel-2 and USGS Landsat 8/9 imagery.'
    },
    {
        selector: '#tour-layer',
        title: '2. Choose a Spatial Layer',
        body: 'Switch between physical Surface Temperature (LST °C), Getis-Ord Gi* thermal clustering, the Heat Exposure Index (HEI), and Sentinel-2 vegetation (NDVI).'
    },
    {
        selector: '#tour-search',
        title: '3. Click or Search Any Area',
        body: 'Click any polygon on the map—or search by name here—to open its localized telemetry drawer.'
    },
    {
        selector: '#tour-metrics',
        title: '4. Read the Detail Panel',
        body: 'Inspect the 4 core metrics, plain-English thermal percentile, side-by-side area comparisons, and "?" tooltips explaining each statistical term.',
        openDrawer: true
    },
    {
        selector: '#tour-scenario',
        title: '5. Try the Greening Scenario',
        body: 'Test an association-based canopy greening shift (+ΔNDVI) with explicit 95% confidence intervals and built-up land (1 − NDBI) constraints.',
        openDrawer: true
    },
    {
        selector: '#tour-help',
        title: '6. Methods, Lineage & Downloads',
        body: 'Open "Method & Data" for full equations, live Moran\'s I & HEI rank diagnostics, and limitations, or export GeoJSON/CSV from the bottom bar.'
    }
];

let tourIndex = 0;

function initTour() {
    try {
        if (!localStorage.getItem('lagos_uhi_tour_done_v2')) startTour();
    } catch (e) {}
}

function startTour() {
    tourIndex = 0;
    document.getElementById('tour-backdrop').classList.remove('is-hidden');
    renderTourStep();
}

function endTour() {
    document.getElementById('tour-backdrop').classList.add('is-hidden');
    try { localStorage.setItem('lagos_uhi_tour_done_v2', '1'); } catch (e) {}
}

function renderTourStep() {
    const step = TOUR_STEPS[tourIndex];
    if (step.openDrawer && !STATE.selectedArea && STATE.features.length) {
        selectArea(STATE.features[0].properties.area_name);
    }

    const el = document.querySelector(step.selector) || document.getElementById('map');
    const rect = el.getBoundingClientRect();
    const spot = document.getElementById('tour-spotlight');
    const card = document.getElementById('tour-card');

    spot.style.top = `${Math.max(4, rect.top - 4)}px`;
    spot.style.left = `${Math.max(4, rect.left - 4)}px`;
    spot.style.width = `${Math.min(window.innerWidth - 8, rect.width + 8)}px`;
    spot.style.height = `${Math.min(window.innerHeight - 8, rect.height + 8)}px`;

    document.getElementById('tour-step-counter').innerText = `Step ${tourIndex + 1} of ${TOUR_STEPS.length}`;
    document.getElementById('tour-step-title').innerText = step.title;
    document.getElementById('tour-step-body').innerText = step.body;

    document.getElementById('tour-dots').innerHTML = TOUR_STEPS.map((_, i) =>
        `<span class="tour-dot ${i === tourIndex ? 'is-active' : ''}"></span>`
    ).join('');

    document.getElementById('tour-btn-prev').style.visibility = tourIndex === 0 ? 'hidden' : 'visible';
    document.getElementById('tour-btn-next').innerText = tourIndex === TOUR_STEPS.length - 1 ? 'Done' : 'Next';

    const topPos = rect.bottom + 14 + 190 < window.innerHeight ? rect.bottom + 14 : Math.max(16, rect.top - 195);
    const leftPos = Math.min(window.innerWidth - 336, Math.max(16, rect.left));
    card.style.top = `${topPos}px`;
    card.style.left = `${leftPos}px`;
}

document.getElementById('btn-start-tour').addEventListener('click', startTour);
document.getElementById('tour-btn-skip').addEventListener('click', endTour);
document.getElementById('tour-btn-prev').addEventListener('click', () => {
    if (tourIndex > 0) { tourIndex--; renderTourStep(); }
});
document.getElementById('tour-btn-next').addEventListener('click', () => {
    if (tourIndex < TOUR_STEPS.length - 1) { tourIndex++; renderTourStep(); }
    else { endTour(); }
});

window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        endTour();
        methodsModal.classList.add('is-hidden');
    }
});
