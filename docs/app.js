/**
 * Lagos Urban Heat Analytics - Fail-Safe Stable Engine
 */

const map = L.map('map', { zoomControl: false }).setView([6.5244, 3.3792], 10);
L.control.zoom({ position: 'topright' }).addTo(map);

const BASEMAPS = {
    light: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 16
    }),
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
let layerIndex = {};
let rawGeoJSON = null;
let currentMetric = 'lst';
let currentK = 5;
let ndviBoost = 0;
let empiricalSlope = -12.4;
let selectedZone = null;

const RAMP = ['#FEF0D9', '#FDCC8A', '#FC8D59', '#E34A33', '#B30000'];

function hexToRgb(hex) {
    const num = parseInt((hex || '#FDCC8A').replace('#', ''), 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}

function interpolateSequential(val, min, max) {
    const t = Math.max(0, Math.min(1, (val - min) / ((max - min) || 1)));
    const scaled = t * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(scaled));
    const f = scaled - i;
    const c1 = hexToRgb(RAMP[i]);
    const c2 = hexToRgb(RAMP[i + 1]);
    return rgbToHex(c1[0] + (c2[0] - c1[0]) * f, c1[1] + (c2[1] - c1[1]) * f, c1[2] + (c2[2] - c1[2]) * f);
}

function extractCoords(coords, list = []) {
    if (!Array.isArray(coords)) return list;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        list.push(coords);
    } else {
        coords.forEach(c => extractCoords(c, list));
    }
    return list;
}

function getCentroid(feature) {
    const pts = extractCoords(feature?.geometry?.coordinates || []);
    if (!pts.length) return [3.3792, 6.5244];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(([x, y]) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    });
    return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function computeGiStar(features, k) {
    const n = features.length;
    const vals = features.map(f => Number(f.properties.sim_lst || f.properties.mean_lst || 34));
    const meanY = vals.reduce((a, b) => a + b, 0) / n;
    const s = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - meanY, 2), 0) / n) || 1e-6;
    const centers = features.map(f => f.properties._center);

    return features.map((_, i) => {
        const dists = centers.map((c, j) => ({
            idx: j,
            d: Math.hypot(c[0] - centers[i][0], c[1] - centers[i][1])
        })).sort((a, b) => a.d - b.d);

        const nbrs = dists.slice(0, Math.min(n, k + 1)).map(d => d.idx);
        const m = nbrs.length;
        const w = 1.0 / m;
        const sumWY = nbrs.reduce((acc, j) => acc + w * vals[j], 0);
        const sumW2 = 1.0 / m;
        const den = s * Math.sqrt(Math.max(1e-9, (n * sumW2 - 1.0) / (n - 1)));
        return (sumWY - meanY) / den;
    });
}

// Fail-safe fetch trying multiple absolute and relative paths
async function fetchGeoJSON() {
    const banner = document.getElementById('status-banner');
    const urls = [
        'data/lagos_uhi_processed.geojson',
        './data/lagos_uhi_processed.geojson',
        'https://raw.githubusercontent.com/oloyededavid/Lagos-Urban-Heat-Analytics/main/docs/data/lagos_uhi_processed.geojson',
        'https://oloyededavid.github.io/Lagos-Urban-Heat-Analytics/data/lagos_uhi_processed.geojson'
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
        } catch (e) {
            // Try next
        }
    }
    if (banner) banner.innerText = 'Error: Could not load GeoJSON. Check file location in docs/data/.';
    throw new Error('Failed to fetch GeoJSON from all paths.');
}

fetchGeoJSON().then(data => {
    rawGeoJSON = data;

    data.features.forEach((f, i) => {
        const p = f.properties;
        p.area_name = String(p.ward_name || p.NAME_2 || p.ADM2_NAME || p.NAME || `Area ${i + 1}`);
        p._center = getCentroid(f);
    });

    const valid = data.features.filter(f => f.properties.ndvi != null && f.properties.mean_lst != null);
    if (valid.length > 2) {
        const mx = valid.reduce((s, f) => s + Number(f.properties.ndvi), 0) / valid.length;
        const my = valid.reduce((s, f) => s + Number(f.properties.mean_lst), 0) / valid.length;
        const num = valid.reduce((s, f) => s + (Number(f.properties.ndvi) - mx) * (Number(f.properties.mean_lst) - my), 0);
        const den = valid.reduce((s, f) => s + Math.pow(Number(f.properties.ndvi) - mx, 2), 0);
        if (den > 0) empiricalSlope = num / den;
    }
    const slopeEl = document.getElementById('ols-slope-text') || document.getElementById('slope-val');
    if (slopeEl) slopeEl.innerText = empiricalSlope.toFixed(1);

    updateModel();
    buildMap(true);
}).catch(err => console.error(err));

function updateModel() {
    if (!rawGeoJSON) return;
    const features = rawGeoJSON.features;
    const boost = ndviBoost / 100.0;

    features.forEach(f => {
        const p = f.properties;
        const baseNdvi = Number(p.ndvi ?? 0.25);
        const simNdvi = Math.min(0.85, baseNdvi * (1 + boost));
        const dLst = (simNdvi - baseNdvi) * empiricalSlope;
        p.sim_ndvi = simNdvi;
        p.sim_lst = Number(p.mean_lst ?? 34) + dLst;
    });

    const exactGi = computeGiStar(features, currentK);
    const lstVals = features.map(f => f.properties.sim_lst);
    const lstMin = Math.min(...lstVals), lstMax = Math.max(...lstVals);

    const popLogs = features.map(f => Math.log1p(Number(f.properties.pop_density || 0)));
    const pMin = Math.min(...popLogs), pMax = Math.max(...popLogs);

    features.forEach((f, idx) => {
        const p = f.properties;
        const pyGiz = p[`gi_zscore_k${currentK}`];
        p.sim_giz = (pyGiz !== undefined && pyGiz !== null) ? Number(pyGiz) : exactGi[idx];

        const lstNorm = Math.max(0, (p.sim_lst - lstMin) / ((lstMax - lstMin) || 1));
        const popNorm = (Math.log1p(Number(p.pop_density || 0)) - pMin) / ((pMax - pMin) || 1);
        p.sim_exp = lstNorm * popNorm;

        // Color assignment based on active layer
        let val = p.sim_lst;
        if (currentMetric === 'hotspot') val = p.sim_giz;
        else if (currentMetric === 'exposure') val = p.sim_exp;
        else if (currentMetric === 'ndvi') val = p.sim_ndvi;

        const vMin = currentMetric === 'hotspot' ? -2.5 : (currentMetric === 'exposure' ? 0 : (currentMetric === 'ndvi' ? 0.15 : lstMin));
        const vMax = currentMetric === 'hotspot' ? 2.5 : (currentMetric === 'exposure' ? 0.85 : (currentMetric === 'ndvi' ? 0.65 : lstMax));
        
        p.fillColor = interpolateSequential(val, vMin, vMax);
    });

    renderLegend(lstMin, lstMax);
    renderTable();

    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
            const p = layer.feature.properties;
            const isSel = p.area_name === selectedZone;
            layer.setStyle({
                fillColor: p.fillColor,
                weight: isSel ? 3.5 : 1.2,
                color: isSel ? '#0284c7' : '#ffffff',
                fillOpacity: isSel ? 0.94 : 0.82
            });
        });
    }

    if (selectedZone) {
        const feat = features.find(f => f.properties.area_name === selectedZone);
        if (feat) showDetails(feat.properties);
    } else {
        showOverview(features);
    }
}

function buildMap(fitInitial = false) {
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    layerIndex = {};

    geojsonLayer = L.geoJSON(rawGeoJSON, {
        style: feature => ({
            fillColor: feature.properties.fillColor,
            weight: 1.2,
            opacity: 1,
            color: '#ffffff',
            fillOpacity: 0.82
        }),
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            layerIndex[p.area_name] = layer;

            layer.bindTooltip(`
                <strong>${p.area_name}</strong><br/>
                LST: <b>${p.sim_lst.toFixed(1)} °C</b> &middot; Gi*: <b>${p.sim_giz.toFixed(2)}</b><br/>
                HEI: <b>${p.sim_exp.toFixed(2)}</b>
            `, { sticky: true, className: 'clean-tip' });

            layer.on('click', () => selectArea(p.area_name));
        }
    }).addTo(map);

    if (fitInitial) {
        map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
    }
}

function selectArea(areaName) {
    selectedZone = areaName;
    const targetLayer = layerIndex[areaName];
    if (targetLayer) {
        targetLayer.bringToFront();
        map.fitBounds(targetLayer.getBounds(), { padding: [60, 60], maxZoom: 12 });
        showDetails(targetLayer.feature.properties);
    }
    updateModel();
}

function showDetails(p) {
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('zone-title', p.area_name);
    setTxt('val-lst', `${p.sim_lst.toFixed(2)} °C`);
    setTxt('val-giz', `${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}`);
    setTxt('val-ndvi', p.sim_ndvi.toFixed(3));
    setTxt('val-exp', p.sim_exp.toFixed(3));
    setTxt('val-pop', `${Math.round(p.pop_density || 0).toLocaleString()} /km²`);
    setTxt('val-elev', `${Number(p.elevation || 0).toFixed(1)} m`);

    const badge = document.getElementById('zone-badge');
    if (badge) {
        badge.innerText = p.sim_lst > 38 ? 'High Heat Core' : 'Normal Urban Zone';
        badge.style.backgroundColor = p.fillColor;
    }
}

function showOverview(features) {
    const n = features.length;
    const meanLst = features.reduce((s, f) => s + f.properties.sim_lst, 0) / n;
    const maxGi = Math.max(...features.map(f => f.properties.sim_giz));
    const meanNdvi = features.reduce((s, f) => s + f.properties.sim_ndvi, 0) / n;
    const meanExp = features.reduce((s, f) => s + f.properties.sim_exp, 0) / n;
    const meanPop = features.reduce((s, f) => s + Number(f.properties.pop_density || 0), 0) / n;
    const meanElev = features.reduce((s, f) => s + Number(f.properties.elevation || 0), 0) / n;

    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('zone-title', 'Lagos State Overview');
    setTxt('val-lst', `${meanLst.toFixed(2)} °C`);
    setTxt('val-giz', `+${maxGi.toFixed(2)} Peak`);
    setTxt('val-ndvi', meanNdvi.toFixed(3));
    setTxt('val-exp', meanExp.toFixed(3));
    setTxt('val-pop', `${Math.round(meanPop).toLocaleString()} /km²`);
    setTxt('val-elev', `${meanElev.toFixed(1)} m`);

    const badge = document.getElementById('zone-badge');
    if (badge) {
        badge.innerText = 'Click Map to Inspect';
        badge.style.backgroundColor = '#1e293b';
    }
}

function renderTable() {
    const tbody = document.getElementById('zone-tbody');
    if (!tbody || !rawGeoJSON) return;
    const sorted = [...rawGeoJSON.features].sort((a, b) => b.properties.sim_exp - a.properties.sim_exp);

    tbody.innerHTML = sorted.map(f => {
        const p = f.properties;
        const isSel = p.area_name === selectedZone ? 'selected' : '';
        return `
            <tr class="${isSel}" data-zone="${p.area_name}">
                <td><span class="dot-indicator" style="background:${p.fillColor}"></span>${p.area_name}</td>
                <td>${p.sim_lst.toFixed(1)} °C</td>
                <td>${p.sim_ndvi.toFixed(2)}</td>
                <td>${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => selectArea(tr.getAttribute('data-zone')));
    });
}

function renderLegend(lstMin, lstMax) {
    const box = document.getElementById('map-legend');
    if (!box) return;
    box.innerHTML = `
        <span class="legend-title">${currentMetric.toUpperCase()} Gradient Scale</span>
        <div style="height:10px; width:100%; background: linear-gradient(90deg, ${RAMP.join(', ')}); border-radius:3px; margin-bottom:6px;"></div>
        <div style="display:flex; justify-content:space-between; font-size:11px; color:#cbd5e1;">
            <span>Min</span><span>Median</span><span>Max</span>
        </div>
    `;
}

// Event Bindings
const metricSel = document.getElementById('metric-select');
if (metricSel) metricSel.addEventListener('change', e => { currentMetric = e.target.value; updateModel(); });

const kSel = document.getElementById('k-select');
if (kSel) kSel.addEventListener('change', e => { currentK = Number(e.target.value); updateModel(); });

const baseSel = document.getElementById('basemap-select');
if (baseSel) baseSel.addEventListener('change', e => {
    const next = BASEMAPS[e.target.value];
    if (next && next !== activeBasemap) {
        map.removeLayer(activeBasemap);
        activeBasemap = next.addTo(map);
        if (geojsonLayer) geojsonLayer.bringToFront();
    }
});

const slider = document.getElementById('ndvi-slider');
if (slider) slider.addEventListener('input', e => {
    ndviBoost = Number(e.target.value);
    const lbl = document.getElementById('slider-label');
    if (lbl) lbl.innerText = `+${ndviBoost}%`;
    updateModel();
});

const resetBtn = document.getElementById('reset-view');
if (resetBtn) resetBtn.addEventListener('click', () => {
    selectedZone = null;
    ndviBoost = 0;
    if (slider) slider.value = 0;
    const lbl = document.getElementById('slider-label');
    if (lbl) lbl.innerText = '+0%';
    updateModel();
    if (geojsonLayer) map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
});
