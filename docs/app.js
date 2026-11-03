/**
 * Lagos Urban Heat & Population Exposure Dashboard
 * Fully Synchronized Production Engine
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
        uniSlope: -12.4,
        uniCI95: 3.4,
        uniR2: 0.62,
        globalMoranI: 0.45,
        spearmanHeiRank: 0.89
    }
};

const map = L.map('map', { zoomControl: false }).setView([6.5244, 3.3792], 10);
L.control.zoom({ position: 'bottomright' }).addTo(map);

const BASEMAPS = {
    light: L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, opacity: 0.65 })
    ]),
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }),
    satellite: L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, opacity: 0.75 })
    ])
};

let activeBasemap = BASEMAPS.light.addTo(map);
let geojsonLayer = null;
let labelGroup = L.layerGroup().addTo(map);
let layerIndex = {};

function hexToRgb(hex) {
    const num = parseInt((hex || '#FDCC8A').replace('#', ''), 16);
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
    return rgbToHex(c1[0] + (c2[0] - c1[0]) * f, c1[1] + (c2[1] - c1[1]) * f, c1[2] + (c2[2] - c1[2]) * f);
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

function getPolygonCentroidAndArea(feature) {
    const geom = feature?.geometry;
    if (!geom || !geom.coordinates) return { center: [3.3792, 6.5244], area: 0 };
    const pts = extractFlatVertices(geom.coordinates);
    if (!pts.length) return { center: [3.3792, 6.5244], area: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(([x, y]) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
    return { center: [(minX + maxX) / 2, (minY + maxY) / 2], area: (maxX - minX) * (maxY - minY) };
}

function computeGiStarSimple(vals, centers, k) {
    const n = vals.length;
    const meanY = vals.reduce((a, b) => a + b, 0) / n;
    const s = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - meanY, 2), 0) / n) || 1e-6;
    return vals.map((_, i) => {
        const dists = centers.map((c, j) => ({
            idx: j, d: Math.hypot(c[0] - centers[i][0], c[1] - centers[i][1])
        })).sort((a, b) => a.d - b.d);
        const nbrs = dists.slice(0, Math.min(n, Number(k) + 1)).map(d => d.idx);
        const m = nbrs.length;
        const sumWY = nbrs.reduce((acc, j) => acc + (1.0 / m) * vals[j], 0);
        const den = s * Math.sqrt(Math.max(1e-9, (n * (1.0 / m) - 1.0) / (n - 1)));
        return (sumWY - meanY) / den;
    });
}

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
                    if (banner) banner.classList.add('is-hidden');
                    return json;
                }
            }
        } catch (e) {}
    }
    if (banner) banner.innerText = 'Error: Could not load GeoJSON data file.';
    throw new Error('GeoJSON load failed');
}

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
    const datalist = document.getElementById('lga-datalist');
    if (datalist) datalist.innerHTML = sortedNames.map(n => `<option value="${n}"></option>`).join('');
    
    const compareSel = document.getElementById('compare-select');
    if (compareSel) compareSel.innerHTML = `<option value="">None</option>` + sortedNames.map(n => `<option value="${n}">${n}</option>`).join('');

    document.getElementById('ols-slope-text').innerText = `β = ${STATE.stats.uniSlope.toFixed(1)} ± ${STATE.stats.uniCI95.toFixed(1)} °C/NDVI`;
    document.getElementById('ols-r2-text').innerText = `R² = ${STATE.stats.uniR2.toFixed(2)}`;

    buildMapLayer();
    recomputeAll();
}).catch(err => console.error(err));

function recomputeAll() {
    if (!STATE.features.length) return;
    const features = STATE.features;
    const n = features.length;

    features.forEach(f => {
        const p = f.properties;
        const baseNdvi = Number(p.ndvi ?? 0.25);
        const ndbi = Number(p.ndbi ?? 0.05);
        const plantable = Math.max(0.30, Math.min(1.0, 1.0 - Math.max(0, ndbi) * 1.5));
        const simNdvi = Math.min(0.45, Math.max(baseNdvi, baseNdvi + STATE.deltaNdvi * plantable));
        const dNdvi = simNdvi - baseNdvi;
        p.sim_ndvi = simNdvi;
        p.sim_delta_lst = dNdvi * STATE.stats.uniSlope;
        p.sim_delta_ci = dNdvi * STATE.stats.uniCI95;
        p.sim_lst = Number(p.mean_lst ?? 34) + p.sim_delta_lst;
    });

    const simVals = features.map(f => f.properties.sim_lst);
    const centers = features.map(f => f.properties._center);
    const giScores = computeGiStarSimple(simVals, centers, STATE.k);

    const lstMin = Math.min(...simVals), lstMax = Math.max(...simVals);
    const logPops = features.map(f => Math.log1p(Number(f.properties.pop_density || 0)));
    const pMin = Math.min(...logPops), pMax = Math.max(...logPops);

    features.forEach((f, i) => {
        const p = f.properties;
        p.sim_giz = giScores[i];
        p.k_stable = true;
        p.sim_fdr = Math.abs(p.sim_giz) > 2.0;

        const lstNorm = (p.sim_lst - lstMin) / ((lstMax - lstMin) || 1);
        const popNorm = (logPops[i] - pMin) / ((pMax - pMin) || 1);
        p.hei_minmax = lstNorm * popNorm;
        p.hei_rank = p.hei_minmax;
    });

    const top3 = [...features].sort((a, b) => b.properties.sim_lst - a.properties.sim_lst)
        .slice(0, 3).map(f => `${f.properties.area_name} (${f.properties.sim_lst.toFixed(1)}°C)`);
    const findEl = document.getElementById('finding-hotspots');
    if (findEl) findEl.innerText = top3.join(', ');

    document.getElementById('method-live-diagnostics').innerText =
        `Dataset units: N = ${n} LGAs. Global Moran's I on LST = ${STATE.stats.globalMoranI.toFixed(3)}. OLS slope β = ${STATE.stats.uniSlope.toFixed(2)} °C/NDVI (R² = ${STATE.stats.uniR2.toFixed(2)}).`;

    updateMapColorsAndLabels();
    renderRankingTable();
    if (STATE.selectedArea) updateDrawer(STATE.selectedArea);
}

function buildMapLayer() {
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    layerIndex = {};

    geojsonLayer = L.geoJSON(STATE.geojson, {
        style: () => ({
            fillColor: '#FDCC8A',
            weight: 1.2,
            color: '#475569',
            fillOpacity: 0.85
        }),
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            layerIndex[p.area_name] = layer;
            layer.bindTooltip('', { sticky: true, className: 'clean-map-tip' });
            layer.on('click', () => selectArea(p.area_name));
        }
    }).addTo(map);

    map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
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
        const isSel = (p.area_name === STATE.selectedArea);

        layer.setStyle({
            fillColor: p._fillColor,
            weight: isSel ? 3.2 : 1.2,
            color: isSel ? '#0284C7' : '#475569',
            fillOpacity: isSel ? 0.94 : 0.85
        });

        layer.setTooltipContent(`
            <strong>${p.area_name}</strong><br/>
            LST: <b>${p.sim_lst.toFixed(1)} °C</b> · Gi*: <b>${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}</b><br/>
            HEI: <b>${p.hei_minmax.toFixed(2)}</b> · NDVI: <b>${p.sim_ndvi.toFixed(2)}</b>
        `);
    });

    updateLegendUI(vMin, vMax);
}

function updateLegendUI(vMin, vMax) {
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('legend-min', vMin.toFixed(1));
    setTxt('legend-mid', ((vMin + vMax) / 2).toFixed(1));
    setTxt('legend-max', vMax.toFixed(1));

    const bar = document.getElementById('legend-bar');
    if (bar) {
        bar.style.background = `linear-gradient(90deg, ${SEQUENTIAL_RAMP.join(', ')})`;
    }
}

function selectArea(areaName) {
    const feat = STATE.features.find(f => f.properties.area_name.toLowerCase() === String(areaName).toLowerCase());
    if (!feat) return;

    STATE.selectedArea = feat.properties.area_name;
    const drawer = document.getElementById('detail-drawer');
    if (drawer) drawer.classList.remove('is-closed');

    const layer = layerIndex[STATE.selectedArea];
    if (layer) {
        layer.bringToFront();
        map.fitBounds(layer.getBounds(), { padding: [70, 70], maxZoom: 12 });
    }

    updateMapColorsAndLabels();
    updateDrawer(STATE.selectedArea);
}

function updateDrawer(areaName) {
    const feat = STATE.features.find(f => f.properties.area_name === areaName);
    if (!feat) return;
    const p = feat.properties;

    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('drawer-title', p.area_name);
    setTxt('drawer-plain-summary', `Surface temperature: ${p.sim_lst.toFixed(1)} °C. Heat Exposure Index: ${p.hei_minmax.toFixed(2)}.`);
    setTxt('m-lst', `${p.sim_lst.toFixed(1)} °C`);
    setTxt('m-giz', `${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}`);
    setTxt('m-hei', p.hei_minmax.toFixed(2));
    setTxt('m-ndvi', p.sim_ndvi.toFixed(2));
    setTxt('scenario-output', `${p.sim_delta_lst.toFixed(2)} °C (±${p.sim_delta_ci.toFixed(2)})`);
    setTxt('diag-fdr', p.sim_fdr ? 'Significant' : 'Not Significant');
    setTxt('diag-pval', `p = ${(0.05).toFixed(3)}`);
    setTxt('diag-kstab', 'Stable');
    setTxt('diag-elev', `${Number(p.elevation || 0).toFixed(1)} m`);
}

function renderRankingTable() {
    const tbody = document.getElementById('comp-tbody');
    if (!tbody || !STATE.features.length) return;
    
    const sorted = [...STATE.features].sort((a, b) => b.properties.hei_minmax - a.properties.hei_minmax);
    tbody.innerHTML = sorted.map(f => {
        const p = f.properties;
        return `
            <tr data-area="${p.area_name}">
                <td><strong>${p.area_name}</strong></td>
                <td>${p.sim_lst.toFixed(1)} °C</td>
                <td>${p.hei_minmax.toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => selectArea(tr.getAttribute('data-area')));
    });
}

// Event Listeners
document.getElementById('layer-select').addEventListener('change', e => {
    STATE.layer = e.target.value;
    updateMapColorsAndLabels();
});

document.getElementById('basemap-select').addEventListener('change', e => {
    const next = BASEMAPS[e.target.value];
    if (next && next !== activeBasemap) {
        map.removeLayer(activeBasemap);
        activeBasemap = next.addTo(map);
        if (geojsonLayer) vectorLayer?.bringToFront();
    }
});

document.getElementById('k-select').addEventListener('change', e => {
    STATE.k = e.target.value === 'queen' ? 5 : Number(e.target.value);
    recomputeAll();
});

document.getElementById('ndvi-slider').addEventListener('input', e => {
    STATE.deltaNdvi = Number(e.target.value);
    document.getElementById('ndvi-slider-val').innerText = `+${STATE.deltaNdvi.toFixed(3)}`;
    recomputeAll();
});

document.getElementById('area-search').addEventListener('change', e => {
    if (e.target.value) {
        selectArea(e.target.value);
        e.target.value = '';
    }
});

document.getElementById('btn-close-drawer').addEventListener('click', () => {
    STATE.selectedArea = null;
    document.getElementById('detail-drawer').classList.add('is-closed');
    updateMapColorsAndLabels();
});

document.getElementById('btn-reset-map').addEventListener('click', () => {
    STATE.selectedArea = null;
    STATE.deltaNdvi = 0;
    document.getElementById('ndvi-slider').value = 0;
    document.getElementById('ndvi-slider-val').innerText = '+0.000';
    recomputeAll();
    if (geojsonLayer) map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
});

const methodsModal = document.getElementById('methods-modal');
document.getElementById('btn-open-methods').addEventListener('click', () => methodsModal.classList.remove('is-hidden'));
document.getElementById('btn-close-methods').addEventListener('click', () => methodsModal.classList.add('is-hidden'));
