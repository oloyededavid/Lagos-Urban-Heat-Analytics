// 1. Initialize Crisp SVG 2D Leaflet Map
const map = L.map('map', {
    zoomControl: false
}).setView([6.5244, 3.3792], 10);

L.control.zoom({ position: 'topright' }).addTo(map);

// Keyless Basemap Layers
const BASEMAPS = {
    satellite: L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 18
        }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 18,
            opacity: 0.85
        })
    ]),
    light: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 16
    }),
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18
    })
};

let activeBasemap = BASEMAPS.satellite;
activeBasemap.addTo(map);

// Application State
let rawGeoJSON = null;
let geojsonLayer = null;
let layerIndex = {};
let currentMetric = 'hotspot';
let currentK = 5;
let ndviBoost = 0;
let empiricalSlope = -12.4;
let popThreshold70 = 0;
let selectedZone = null;

// Color Palettes
const LST_COLORS = ['#06b6d4', '#10b981', '#eab308', '#f97316', '#ef4444', '#b91c1c'];
const EXP_COLORS = ['#334155', '#6366f1', '#a855f7', '#ec4899', '#ef4444', '#dc2626'];
const NDVI_COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#15803d'];

function getHotspotColor(cat) {
    switch (cat) {
        case 'Priority Cooling Zone': return '#ef4444';
        case 'Significant Heat Hotspot': return '#f97316';
        case 'Elevated Thermal Cluster': return '#eab308';
        case 'Thermal Refugium (Cool)': return '#06b6d4';
        default: return '#64748b';
    }
}

function getGradColor(val, min, max, palette) {
    const t = Math.max(0, Math.min(1, (val - min) / ((max - min) || 1)));
    const idx = Math.min(palette.length - 1, Math.floor(t * palette.length));
    return palette[idx];
}

// Safe coordinate extractor
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

// Exact KNN Getis-Ord Gi* calculated live in JS
function computeGiStar(features, k) {
    const n = features.length;
    const vals = features.map(f => Number(f.properties.sim_lst || 34));
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

// Fetch GeoJSON with Robust Fallback Paths
async function fetchLagosGeoJSON() {
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
                    return json;
                }
            }
        } catch (e) {
            // Try next URL
        }
    }
    throw new Error('Could not load lagos_uhi_processed.geojson');
}

fetchLagosGeoJSON()
    .then(data => {
        rawGeoJSON = data;

        data.features.forEach((f, i) => {
            const p = f.properties;
            p.ward_name = String(p.ward_name || p.ADM2_NAME || p.WardName || p.NAME || `Zone ${i + 1}`);
            p._center = getCentroid(f);
        });

        const pops = data.features.map(f => Number(f.properties.pop_density || 0)).sort((a, b) => a - b);
        popThreshold70 = pops[Math.floor(pops.length * 0.65)] || 0;

        const valid = data.features.filter(f => f.properties.ndvi != null && f.properties.mean_lst != null);
        if (valid.length > 2) {
            const mx = valid.reduce((s, f) => s + Number(f.properties.ndvi), 0) / valid.length;
            const my = valid.reduce((s, f) => s + Number(f.properties.mean_lst), 0) / valid.length;
            const num = valid.reduce((s, f) => s + (Number(f.properties.ndvi) - mx) * (Number(f.properties.mean_lst) - my), 0);
            const den = valid.reduce((s, f) => s + Math.pow(Number(f.properties.ndvi) - mx, 2), 0);
            if (den > 0) empiricalSlope = num / den;
        }
        document.getElementById('slope-val').innerText = empiricalSlope.toFixed(1);

        updateModel();
        buildMapPolygons(true);
    })
    .catch(err => console.error('GeoJSON load error:', err));

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
        p.sim_delta = dLst;
    });

    const exactGi = computeGiStar(features, currentK);
    const baseMean = features.reduce((s, f) => s + Number(f.properties.mean_lst ?? 34), 0) / features.length;
    const baseStd = Math.sqrt(features.reduce((s, f) => s + Math.pow(Number(f.properties.mean_lst ?? 34) - baseMean, 2), 0) / features.length) || 1;

    const lstVals = features.map(f => f.properties.sim_lst);
    const lstMin = Math.min(...lstVals), lstMax = Math.max(...lstVals);

    const popLogs = features.map(f => Math.log1p(Number(f.properties.pop_density || 0)));
    const pMin = Math.min(...popLogs), pMax = Math.max(...popLogs);

    let priorityCount = 0;
    let totalDelta = 0;

    features.forEach((f, idx) => {
        const p = f.properties;
        p.sim_lst_z = (p.sim_lst - baseMean) / baseStd;

        const pyGiz = p[`gi_zscore_k${currentK}`];
        const baseGiz = (pyGiz !== undefined && pyGiz !== null) ? Number(pyGiz) : exactGi[idx];
        p.sim_giz = baseGiz + (p.sim_delta / baseStd);

        const lstNorm = Math.max(0, (p.sim_lst - lstMin) / ((lstMax - lstMin) || 1));
        const popNorm = (Math.log1p(Number(p.pop_density || 0)) - pMin) / ((pMax - pMin) || 1);
        p.sim_exp = lstNorm * popNorm;

        const isDense = Number(p.pop_density || 0) >= popThreshold70;
        const compositeHeat = Math.max(p.sim_giz, p.sim_lst_z);

        if (compositeHeat >= 0.65 && isDense) {
            p.sim_cat = 'Priority Cooling Zone';
            priorityCount++;
        } else if (compositeHeat >= 0.85) {
            p.sim_cat = 'Significant Heat Hotspot';
        } else if (compositeHeat >= 0.15) {
            p.sim_cat = 'Elevated Thermal Cluster';
        } else if (compositeHeat <= -0.45) {
            p.sim_cat = 'Thermal Refugium (Cool)';
        } else {
            p.sim_cat = 'Moderate Urban Zone';
        }

        if (currentMetric === 'hotspot') {
            p.fillColor = getHotspotColor(p.sim_cat);
        } else if (currentMetric === 'lst') {
            p.fillColor = getGradColor(p.sim_lst, lstMin, lstMax, LST_COLORS);
        } else if (currentMetric === 'exposure') {
            p.fillColor = getGradColor(p.sim_exp, 0, 0.85, EXP_COLORS);
        } else {
            p.fillColor = getGradColor(p.sim_ndvi, 0.15, 0.65, NDVI_COLORS);
        }

        totalDelta += p.sim_delta;
    });

    const avgDelta = totalDelta / features.length;
    document.getElementById('sim-cooling-badge').innerText = `${avgDelta.toFixed(2)} °C Shift`;
    document.getElementById('priority-summary').innerText = `${priorityCount} Priority Zones`;

    renderLegend(lstMin, lstMax);
    renderTable();

    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
            const p = layer.feature.properties;
            const isSel = p.ward_name === selectedZone;
            layer.setStyle({
                fillColor: p.fillColor,
                weight: isSel ? 3.5 : 1.5,
                color: isSel ? '#38bdf8' : '#ffffff',
                fillOpacity: isSel ? 0.90 : 0.76
            });
            layer.setTooltipContent(`
                <strong>${p.ward_name}</strong><br/>
                LST: <b>${p.sim_lst.toFixed(2)} °C</b> &middot; Gi*: <b>${p.sim_giz.toFixed(2)}</b><br/>
                <span style="color:#38bdf8">${p.sim_cat}</span>
            `);
        });
    }

    if (selectedZone) {
        const feat = features.find(f => f.properties.ward_name === selectedZone);
        if (feat) showZoneDetails(feat.properties);
    } else {
        showStateOverview(features);
    }
}

function buildMapPolygons(fitInitial = false) {
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    layerIndex = {};

    geojsonLayer = L.geoJSON(rawGeoJSON, {
        style: feature => ({
            fillColor: feature.properties.fillColor,
            weight: 1.5,
            opacity: 1,
            color: '#ffffff',
            fillOpacity: 0.76
        }),
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            layerIndex[p.ward_name] = layer;

            layer.bindTooltip(`
                <strong>${p.ward_name}</strong><br/>
                LST: <b>${p.sim_lst.toFixed(2)} °C</b> &middot; Gi*: <b>${p.sim_giz.toFixed(2)}</b><br/>
                <span style="color:#38bdf8">${p.sim_cat}</span>
            `, { sticky: true, className: 'clean-tip' });

            layer.on('mouseover', () => {
                if (p.ward_name !== selectedZone) {
                    layer.setStyle({ weight: 2.6, color: '#f8fafc', fillOpacity: 0.88 });
                }
            });

            layer.on('mouseout', () => {
                if (p.ward_name !== selectedZone) {
                    layer.setStyle({ weight: 1.5, color: '#ffffff', fillOpacity: 0.76 });
                }
            });

            layer.on('click', () => {
                selectArea(p.ward_name);
            });
        }
    }).addTo(map);

    if (fitInitial) {
        map.fitBounds(geojsonLayer.getBounds(), { padding: [28, 28] });
    }
}

function selectArea(wardName) {
    selectedZone = wardName;

    geojsonLayer.eachLayer(layer => {
        const p = layer.feature.properties;
        const isSel = p.ward_name === wardName;
        layer.setStyle({
            fillColor: p.fillColor,
            weight: isSel ? 3.5 : 1.5,
            color: isSel ? '#38bdf8' : '#ffffff',
            fillOpacity: isSel ? 0.90 : 0.72
        });
        if (isSel) layer.bringToFront();
    });

    const targetLayer = layerIndex[wardName];
    if (targetLayer) {
        map.fitBounds(targetLayer.getBounds(), { padding: [65, 65], maxZoom: 12 });
        showZoneDetails(targetLayer.feature.properties);
    }

    renderTable();
}

function showZoneDetails(p) {
    document.getElementById('zone-title').innerText = p.ward_name;
    document.getElementById('val-lst').innerText = `${p.sim_lst.toFixed(2)} °C`;
    document.getElementById('val-giz').innerText = p.sim_giz.toFixed(2);
    document.getElementById('val-ndvi').innerText = p.sim_ndvi.toFixed(3);
    document.getElementById('val-exp').innerText = p.sim_exp.toFixed(3);
    document.getElementById('val-pop').innerText = `${Math.round(p.pop_density || 0).toLocaleString()} /km²`;
    document.getElementById('val-elev').innerText = `${Number(p.elevation || 0).toFixed(1)} m`;

    const badge = document.getElementById('zone-badge');
    badge.innerText = p.sim_cat;
    badge.style.backgroundColor = getHotspotColor(p.sim_cat);
    badge.style.color = '#ffffff';
}

function showStateOverview(features) {
    const n = features.length;
    const meanLst = features.reduce((s, f) => s + f.properties.sim_lst, 0) / n;
    const maxGi = Math.max(...features.map(f => f.properties.sim_giz));
    const meanNdvi = features.reduce((s, f) => s + f.properties.sim_ndvi, 0) / n;
    const meanExp = features.reduce((s, f) => s + f.properties.sim_exp, 0) / n;
    const meanPop = features.reduce((s, f) => s + Number(f.properties.pop_density || 0), 0) / n;
    const meanElev = features.reduce((s, f) => s + Number(f.properties.elevation || 0), 0) / n;

    document.getElementById('zone-title').innerText = 'Lagos State Overview (Mean)';
    document.getElementById('val-lst').innerText = `${meanLst.toFixed(2)} °C`;
    document.getElementById('val-giz').innerText = `${maxGi.toFixed(2)} (Peak)`;
    document.getElementById('val-ndvi').innerText = meanNdvi.toFixed(3);
    document.getElementById('val-exp').innerText = meanExp.toFixed(3);
    document.getElementById('val-pop').innerText = `${Math.round(meanPop).toLocaleString()} /km²`;
    document.getElementById('val-elev').innerText = `${meanElev.toFixed(1)} m`;

    const badge = document.getElementById('zone-badge');
    badge.innerText = 'Click Map to Inspect';
    badge.style.backgroundColor = '#1e293b';
    badge.style.color = '#cbd5e1';
}

function renderTable() {
    const tbody = document.getElementById('zone-tbody');
    const sorted = [...rawGeoJSON.features].sort((a, b) => b.properties.sim_exp - a.properties.sim_exp);

    tbody.innerHTML = sorted.map(f => {
        const p = f.properties;
        const isSel = p.ward_name === selectedZone ? 'selected' : '';
        const dotCol = getHotspotColor(p.sim_cat);
        return `
            <tr class="${isSel}" data-zone="${p.ward_name}">
                <td><span class="dot-indicator" style="background:${dotCol}"></span>${p.ward_name}</td>
                <td>${p.sim_lst.toFixed(1)} °C</td>
                <td>${p.sim_ndvi.toFixed(2)}</td>
                <td>${p.sim_giz.toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
            selectArea(tr.getAttribute('data-zone'));
        });
    });
}

function renderLegend(lstMin, lstMax) {
    const box = document.getElementById('map-legend');
    if (currentMetric === 'hotspot') {
        const rows = [
            ['Priority Cooling Zone', '#ef4444'],
            ['Significant Heat Hotspot', '#f97316'],
            ['Elevated Thermal Cluster', '#eab308'],
            ['Thermal Refugium (Cool)', '#06b6d4'],
            ['Moderate Urban Zone', '#64748b']
        ];
        box.innerHTML = `<span class="legend-title">Gi* Thermal Classification</span>` +
            rows.map(([lbl, col]) => `<div class="legend-row"><span class="swatch" style="background:${col}"></span><span>${lbl}</span></div>`).join('');
    } else if (currentMetric === 'lst') {
        box.innerHTML = `<span class="legend-title">Mean Surface Temp (${lstMin.toFixed(1)}°C – ${lstMax.toFixed(1)}°C)</span>` +
            LST_COLORS.map((col, i) => `<div class="legend-row"><span class="swatch" style="background:${col}"></span><span>Tier ${i + 1} Thermal Intensity</span></div>`).join('');
    } else if (currentMetric === 'exposure') {
        box.innerHTML = `<span class="legend-title">Heat Exposure Index (0–1)</span>` +
            EXP_COLORS.map((col, i) => `<div class="legend-row"><span class="swatch" style="background:${col}"></span><span>Exposure Level ${i + 1}</span></div>`).join('');
    } else {
        box.innerHTML = `<span class="legend-title">Sentinel-2 Canopy (NDVI)</span>` +
            NDVI_COLORS.map((col, i) => `<div class="legend-row"><span class="swatch" style="background:${col}"></span><span>Canopy Density ${i + 1}</span></div>`).join('');
    }
}

// UI Controls
document.getElementById('metric-select').addEventListener('change', e => {
    currentMetric = e.target.value;
    updateModel();
});

document.getElementById('k-select').addEventListener('change', e => {
    currentK = Number(e.target.value);
    updateModel();
});

document.getElementById('basemap-select').addEventListener('change', e => {
    const next = BASEMAPS[e.target.value];
    if (next && next !== activeBasemap) {
        map.removeLayer(activeBasemap);
        activeBasemap = next;
        activeBasemap.addTo(map);
        if (geojsonLayer) geojsonLayer.bringToFront();
    }
});

document.getElementById('ndvi-slider').addEventListener('input', e => {
    ndviBoost = Number(e.target.value);
    document.getElementById('slider-label').innerText = `+${ndviBoost}%`;
    updateModel();
});

document.getElementById('reset-view').addEventListener('click', () => {
    selectedZone = null;
    ndviBoost = 0;
    document.getElementById('ndvi-slider').value = 0;
    document.getElementById('slider-label').innerText = '+0%';
    updateModel();
    if (geojsonLayer) {
        map.fitBounds(geojsonLayer.getBounds(), { padding: [28, 28] });
    }
});
