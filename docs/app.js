Chart.defaults.font.family = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";
Chart.defaults.color = '#cbd5e1';

const MAP_STYLE = {
    version: 8,
    sources: {
        'esri-sat': {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256
        },
        'esri-labels': {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256
        }
    },
    layers: [
        { id: 'base-sat', type: 'raster', source: 'esri-sat', layout: { visibility: 'visible' } },
        { id: 'base-labels', type: 'raster', source: 'esri-labels', layout: { visibility: 'visible' }, paint: { 'raster-opacity': 0.9 } }
    ]
};

const map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: [3.39, 6.51],
    zoom: 9.8,
    pitch: 52,
    bearing: -12,
    antialias: true
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

let currentK = 5;
let currentMetric = 'hotspot';
let ndviBoostPct = 0;
let is3D = true;
let popQuartile75 = 0;
let empiricalSlope = -13.5;
let selectedZoneName = null;
let scatterChart = null;
let hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

function getHotspotColor(category) {
    switch (category) {
        case 'Priority Cooling Zone': return '#ef4444';
        case 'Significant Heat Hotspot': return '#f97316';
        case 'Elevated Thermal Cluster': return '#eab308';
        case 'Thermal Refugium': return '#06b6d4';
        default: return '#64748b';
    }
}

function getContinuousColor(val, min, max, palette) {
    const t = Math.max(0, Math.min(1, (val - min) / ((max - min) || 1)));
    const idx = Math.min(palette.length - 1, Math.floor(t * palette.length));
    return palette[idx];
}

const LST_PALETTE = ['#06b6d4', '#10b981', '#eab308', '#f97316', '#ef4444', '#b91c1c'];
const EXP_PALETTE = ['#334155', '#6366f1', '#a855f7', '#ec4899', '#ef4444', '#dc2626'];
const NDVI_PALETTE = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#15803d'];

// Fully Embedded Lagos LGA Dataset
const rawGeoJSON = {
    type: "FeatureCollection",
    features: [
        { type: "Feature", properties: { ward_name: "Lagos Island", mean_lst: 38.5, ndvi: 0.18, elevation: 5, pop_density: 22000, gi_zscore_k5: 3.4, fdr_sig_k5: true }, geometry: { type: "Polygon", coordinates: [[[3.38, 6.45], [3.42, 6.45], [3.42, 6.48], [3.38, 6.48], [3.38, 6.45]]] } },
        { type: "Feature", properties: { ward_name: "Ikeja", mean_lst: 37.2, ndvi: 0.22, elevation: 35, pop_density: 18000, gi_zscore_k5: 2.8, fdr_sig_k5: true }, geometry: { type: "Polygon", coordinates: [[[3.33, 6.58], [3.37, 6.58], [3.37, 6.62], [3.33, 6.62], [3.33, 6.58]]] } },
        { type: "Feature", properties: { ward_name: "Alimosho", mean_lst: 35.8, ndvi: 0.31, elevation: 45, pop_density: 15000, gi_zscore_k5: 1.9, fdr_sig_k5: false }, geometry: { type: "Polygon", coordinates: [[[3.25, 6.55], [3.32, 6.55], [3.32, 6.63], [3.25, 6.63], [3.25, 6.55]]] } },
        { type: "Feature", properties: { ward_name: "Eti-Osa", mean_lst: 37.9, ndvi: 0.20, elevation: 3, pop_density: 12000, gi_zscore_k5: 2.5, fdr_sig_k5: true }, geometry: { type: "Polygon", coordinates: [[[3.42, 6.42], [3.55, 6.42], [3.55, 6.48], [3.42, 6.48], [3.42, 6.42]]] } },
        { type: "Feature", properties: { ward_name: "Surulere", mean_lst: 36.5, ndvi: 0.24, elevation: 12, pop_density: 25000, gi_zscore_k5: 2.1, fdr_sig_k5: true }, geometry: { type: "Polygon", coordinates: [[[3.34, 6.49], [3.38, 6.49], [3.38, 6.53], [3.34, 6.53], [3.34, 6.49]]] } },
        { type: "Feature", properties: { ward_name: "Lagos Mainland", mean_lst: 37.0, ndvi: 0.21, elevation: 10, pop_density: 28000, gi_zscore_k5: 2.6, fdr_sig_k5: true }, geometry: { type: "Polygon", coordinates: [[[3.37, 6.50], [3.41, 6.50], [3.41, 6.54], [3.37, 6.54], [3.37, 6.50]]] } },
        { type: "Feature", properties: { ward_name: "Kosofe", mean_lst: 35.2, ndvi: 0.35, elevation: 22, pop_density: 16000, gi_zscore_k5: 0.8, fdr_sig_k5: false }, geometry: { type: "Polygon", coordinates: [[[3.37, 6.55], [3.43, 6.55], [3.43, 6.62], [3.37, 6.62], [3.37, 6.55]]] } },
        { type: "Feature", properties: { ward_name: "Ikorodu", mean_lst: 34.5, ndvi: 0.42, elevation: 30, pop_density: 9000, gi_zscore_k5: -0.5, fdr_sig_k5: false }, geometry: { type: "Polygon", coordinates: [[[3.45, 6.58], [3.55, 6.58], [3.55, 6.68], [3.45, 6.68], [3.45, 6.58]]] } },
        { type: "Feature", properties: { ward_name: "Ibeju-Lekki", mean_lst: 33.8, ndvi: 0.48, elevation: 4, pop_density: 4000, gi_zscore_k5: -1.8, fdr_sig_k5: true }, geometry: { type: "Polygon", coordinates: [[[3.55, 6.42], [3.70, 6.42], [3.70, 6.52], [3.55, 6.52], [3.55, 6.42]]] } },
        { type: "Feature", properties: { ward_name: "Epe", mean_lst: 34.0, ndvi: 0.46, elevation: 15, pop_density: 5000, gi_zscore_k5: -1.2, fdr_sig_k5: false }, geometry: { type: "Polygon", coordinates: [[[3.90, 6.55], [4.05, 6.55], [4.05, 6.65], [3.90, 6.65], [3.90, 6.55]]] } }
    ]
};

function getFeatureCenter(feature) {
    const coords = feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates.flat(2)
        : feature.geometry.coordinates.flat(1);
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

rawGeoJSON.features.forEach(f => {
    f.properties._center = getFeatureCenter(f);
});

const densities = rawGeoJSON.features.map(f => f.properties.pop_density).sort((a, b) => a - b);
popQuartile75 = densities[Math.floor(densities.length * 0.70)] || 10000;

const zoneSelect = document.getElementById('zone-select');
rawGeoJSON.features.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.properties.ward_name;
    opt.innerText = f.properties.ward_name;
    zoneSelect.appendChild(opt);
});

recomputeSimulation();
initChart();

if (map.loaded()) initMapLayers();
else map.on('load', initMapLayers);

function recomputeSimulation() {
    const features = rawGeoJSON.features;
    const boost = ndviBoostPct / 100.0;

    features.forEach(f => {
        const p = f.properties;
        const baseNdvi = Number(p.ndvi || 0.25);
        const simNdvi = Math.min(0.85, baseNdvi * (1 + boost));
        const dLst = (simNdvi - baseNdvi) * empiricalSlope;
        p.sim_ndvi = simNdvi;
        p.sim_lst = Number(p.mean_lst || 35) + dLst;
        p.sim_delta_lst = dLst;
    });

    const baseMean = features.reduce((s, f) => s + f.properties.sim_lst, 0) / features.length;
    const baseStd = Math.sqrt(features.reduce((s, f) => s + Math.pow(f.properties.sim_lst - baseMean, 2), 0) / features.length) || 1;

    const lstVals = features.map(f => f.properties.sim_lst);
    const lstMin = Math.min(...lstVals), lstMax = Math.max(...lstVals);

    let priorityCount = 0;
    let sumDelta = 0;

    features.forEach(f => {
        const p = f.properties;
        p.sim_lst_zscore = (p.sim_lst - baseMean) / baseStd;
        p.sim_giz = Number(p[`gi_zscore_k${currentK}`] ?? p.gi_zscore ?? 1.5) + ((p.sim_delta_lst / baseStd) * 0.5);

        const lstNorm = Math.max(0, (p.sim_lst - lstMin) / ((lstMax - lstMin) || 1));
        const popNorm = Math.min(1, (p.pop_density || 10000) / 30000);
        p.sim_exposure = lstNorm * popNorm;

        const isHot = p.sim_giz >= 1.28;
        const isDense = (p.pop_density || 10000) >= popQuartile75;

        if (isHot && isDense) {
            p.sim_category = 'Priority Cooling Zone';
            priorityCount++;
        } else if (isHot) {
            p.sim_category = 'Significant Heat Hotspot';
        } else if (p.sim_giz <= -1.28) {
            p.sim_category = 'Thermal Refugium';
        } else {
            p.sim_category = 'Not Significant';
        }

        if (currentMetric === 'hotspot') {
            p.activeColor = getHotspotColor(p.sim_category);
        } else if (currentMetric === 'lst') {
            p.activeColor = getContinuousColor(p.sim_lst, lstMin, lstMax, LST_PALETTE);
        } else if (currentMetric === 'exposure') {
            p.activeColor = getContinuousColor(p.sim_exposure, 0, 1, EXP_PALETTE);
        } else {
            p.activeColor = getContinuousColor(p.sim_ndvi, 0.15, 0.6, NDVI_PALETTE);
        }

        p.extrudeHeight = is3D ? Math.max(1200, Math.round((p.sim_exposure * 7000) + ((p.sim_lst - 30) * 400))) : 0;
        p.highlightHeight = p.extrudeHeight + 350;
        sumDelta += p.sim_delta_lst;
    });

    document.getElementById('kpi-mean-lst').innerText = `${(lstVals.reduce((a, b) => a + b, 0) / lstVals.length).toFixed(2)} °C`;
    document.getElementById('kpi-max-lst').innerText = `${lstMax.toFixed(2)} °C`;
    document.getElementById('kpi-priority-count').innerText = `${priorityCount} of ${features.length}`;
    document.getElementById('kpi-sim-delta').innerText = `${(sumDelta / features.length).toFixed(2)} °C`;

    updateLegend(lstMin, lstMax);
    renderLeaderboard();

    const src = map.getSource('lagos-zones');
    if (src) src.setData(rawGeoJSON);

    if (selectedZoneName) {
        const selFeat = features.find(f => f.properties.ward_name === selectedZoneName);
        if (selFeat) populateSidebar(selFeat.properties);
    }

    if (scatterChart) {
        scatterChart.data.datasets[0].data = features.map(f => ({
            x: f.properties.sim_ndvi,
            y: f.properties.sim_lst,
            ward: f.properties.ward_name
        }));
        scatterChart.data.datasets[0].backgroundColor = features.map(f => getHotspotColor(f.properties.sim_category));
        scatterChart.update();
    }
}

function initMapLayers() {
    if (map.getSource('lagos-zones')) return;

    map.addSource('lagos-zones', {
        type: 'geojson',
        data: rawGeoJSON
    });

    map.addLayer({
        id: 'zones-3d',
        type: 'fill-extrusion',
        source: 'lagos-zones',
        paint: {
            'fill-extrusion-color': ['get', 'activeColor'],
            'fill-extrusion-height': ['get', 'extrudeHeight'],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.88
        }
    });

    map.addLayer({
        id: 'zones-outline',
        type: 'line',
        source: 'lagos-zones',
        paint: {
            'line-color': '#ffffff',
            'line-width': 2,
            'line-opacity': 0.95
        }
    });

    map.addLayer({
        id: 'zones-selected-3d',
        type: 'fill-extrusion',
        source: 'lagos-zones',
        filter: ['==', ['get', 'ward_name'], ''],
        paint: {
            'fill-extrusion-color': '#38bdf8',
            'fill-extrusion-height': ['get', 'highlightHeight'],
            'fill-extrusion-base': ['get', 'extrudeHeight'],
            'fill-extrusion-opacity': 0.98
        }
    });

    // Make mouse cursor pointer on hover
    map.on('mousemove', 'zones-3d', (e) => {
        if (!e.features.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const p = e.features[0].properties;
        hoverPopup
            .setLngLat(e.lngLat)
            .setHTML(`
                <div style="line-height:1.45">
                    <strong style="font-size:0.96rem">${p.ward_name}</strong><br/>
                    Mean LST: <b>${Number(p.sim_lst).toFixed(2)} °C</b> &middot; Gi*: <b>${Number(p.sim_giz).toFixed(2)}</b><br/>
                    Pop Density: <b>${Math.round(p.pop_density || 0).toLocaleString()} /km²</b><br/>
                    <span style="color:#60a5fa;font-weight:700">${p.sim_category}</span>
                </div>
            `)
            .addTo(map);
    });

    map.on('mouseleave', 'zones-3d', () => {
        map.getCanvas().style.cursor = '';
        hoverPopup.remove();
    });

    // CRITICAL: Full Click Interaction Handler
    map.on('click', 'zones-3d', (e) => {
        if (!e.features.length) return;
        const zoneName = e.features[0].properties.ward_name;
        selectAndFlyToZone(zoneName, e.lngLat);
    });
}

function selectAndFlyToZone(wardName, customCenter = null) {
    const feat = rawGeoJSON.features.find(f => f.properties.ward_name === wardName);
    if (!feat) return;

    selectedZoneName = wardName;
    document.getElementById('zone-select').value = wardName;

    if (map.getLayer('zones-selected-3d')) {
        map.setFilter('zones-selected-3d', ['==', ['get', 'ward_name'], wardName]);
    }

    const center = customCenter || feat.properties._center;
    map.flyTo({
        center: center,
        zoom: 11.2,
        pitch: is3D ? 56 : 0,
        bearing: map.getBearing(),
        duration: 1100
    });

    populateSidebar(feat.properties);
    renderLeaderboard();
}

function populateSidebar(p) {
    document.getElementById('instruction').classList.add('hidden');
    document.getElementById('ward-details').classList.remove('hidden');

    document.getElementById('ward-name').innerText = p.ward_name;
    document.getElementById('val-raw-lst').innerText = `${Number(p.sim_lst).toFixed(2)} °C`;
    document.getElementById('val-lst').innerText = Number(p.sim_lst_zscore).toFixed(2);
    document.getElementById('val-pop').innerText = `${Math.round(p.pop_density || 0).toLocaleString()} /km²`;
    document.getElementById('val-exp').innerText = Number(p.sim_exposure).toFixed(3);
    document.getElementById('val-ndvi').innerText = Number(p.sim_ndvi).toFixed(3);
    document.getElementById('val-elev').innerText = `${Number(p.elevation || 0).toFixed(1)} m`;
    document.getElementById('val-giz').innerText = Number(p.sim_giz).toFixed(2);
    document.getElementById('val-fdr').innerText = p.sim_giz >= 1.28 ? 'Significant Hotspot' : 'Normal Tier';

    const pill = document.getElementById('val-class');
    pill.innerText = p.sim_category;
    pill.style.backgroundColor = getHotspotColor(p.sim_category);
    pill.style.color = '#ffffff';
}

function renderLeaderboard() {
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;

    const sorted = [...rawGeoJSON.features].sort((a, b) => (b.properties.sim_exposure || 0) - (a.properties.sim_exposure || 0));
    tbody.innerHTML = sorted.map(f => {
        const p = f.properties;
        const isSel = p.ward_name === selectedZoneName ? 'active-row' : '';
        const col = getHotspotColor(p.sim_category);
        return `
            <tr class="${isSel}" data-ward="${p.ward_name}">
                <td><span class="mini-dot" style="background:${col}"></span>${p.ward_name}</td>
                <td>${Number(p.sim_lst).toFixed(1)}°C</td>
                <td>${Number(p.sim_giz).toFixed(2)}</td>
                <td>${p.sim_category.replace('Significant ', '')}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr').forEach(row => {
        row.addEventListener('click', () => {
            selectAndFlyToZone(row.getAttribute('data-ward'));
        });
    });
}

function updateLegend(lstMin, lstMax) {
    const box = document.getElementById('legend-box');
    const items = [
        ['Priority Cooling Zone', '#ef4444'],
        ['Significant Heat Hotspot', '#f97316'],
        ['Elevated Thermal Cluster', '#eab308'],
        ['Thermal Refugium', '#06b6d4'],
        ['Not Significant', '#64748b']
    ];
    box.innerHTML = `<span class="legend-heading">3D Hotspot Classification</span>` +
        items.map(([lbl, col]) => `<div class="legend-item"><span class="legend-color" style="background:${col}"></span><span>${lbl}</span></div>`).join('');
}

function initChart() {
    const ctx = document.getElementById('uhiChart').getContext('2d');
    scatterChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                data: rawGeoJSON.features.map(f => ({
                    x: f.properties.sim_ndvi,
                    y: f.properties.sim_lst,
                    ward: f.properties.ward_name
                })),
                backgroundColor: rawGeoJSON.features.map(f => getHotspotColor(f.properties.sim_category)),
                borderColor: '#ffffff',
                borderWidth: 1.5,
                pointRadius: 6,
                pointHoverRadius: 9
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (evt, els) => {
                if (els.length > 0) {
                    const ward = scatterChart.data.datasets[0].data[els[0].index].ward;
                    selectAndFlyToZone(ward);
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => `${c.raw.ward}: NDVI ${c.raw.x.toFixed(3)} | LST ${c.raw.y.toFixed(2)}°C`
                    }
                }
            },
            scales: {
                x: { grid: { color: '#1e293b' }, title: { display: true, text: 'Sentinel-2 NDVI', color: '#94a3b8', font: { weight: '700' } } },
                y: { grid: { color: '#1e293b' }, title: { display: true, text: 'Mean LST (°C)', color: '#94a3b8', font: { weight: '700' } } }
            }
        }
    });
}

document.getElementById('ndvi-slider').addEventListener('input', (e) => {
    ndviBoostPct = Number(e.target.value);
    document.getElementById('ndvi-boost-val').innerText = `+${ndviBoostPct}% NDVI`;
    recomputeSimulation();
});

document.getElementById('reset-sim').addEventListener('click', () => {
    ndviBoostPct = 0;
    document.getElementById('ndvi-slider').value = 0;
    document.getElementById('ndvi-boost-val').innerText = '+0% NDVI';
    recomputeSimulation();
});

document.getElementById('k-select').addEventListener('change', (e) => {
    currentK = Number(e.target.value);
    recomputeSimulation();
});

document.getElementById('layer-select').addEventListener('change', (e) => {
    currentMetric = e.target.value;
    recomputeSimulation();
});

document.getElementById('zone-select').addEventListener('change', (e) => {
    if (!e.target.value) {
        selectedZoneName = null;
        if (map.getLayer('zones-selected-3d')) {
            map.setFilter('zones-selected-3d', ['==', ['get', 'ward_name'], '']);
        }
        map.flyTo({ center: [3.39, 6.51], zoom: 9.8, pitch: is3D ? 52 : 0, bearing: -12, duration: 1000 });
        renderLeaderboard();
    } else {
        selectAndFlyToZone(e.target.value);
    }
});

document.getElementById('toggle-3d').addEventListener('click', (e) => {
    is3D = !is3D;
    e.target.classList.toggle('active', is3D);
    e.target.innerText = is3D ? '3D Extrusion: ON' : '3D Extrusion: OFF';
    recomputeSimulation();
    map.easeTo({ pitch: is3D ? 52 : 0, bearing: is3D ? -12 : 0, duration: 850 });
});

document.getElementById('btn-reset-cam').addEventListener('click', () => {
    map.flyTo({ center: [3.39, 6.51], zoom: 9.8, pitch: is3D ? 52 : 0, bearing: -12, duration: 950 });
});

document.getElementById('btn-rotate-cam').addEventListener('click', () => {
    map.easeTo({ bearing: map.getBearing() + 45, duration: 700 });
});

document.getElementById('download-brief').addEventListener('click', () => {
    if (!selectedZoneName) return;
    const feat = rawGeoJSON.features.find(f => f.properties.ward_name === selectedZoneName);
    if (!feat) return;
    const p = feat.properties;

    const lines = [
        `====================================================================`,
        `LAGOS URBAN HEAT ANALYTICS - MUNICIPAL COOLING POLICY BRIEF`,
        `====================================================================`,
        `Administrative Unit (LGA) : ${p.ward_name}`,
        `Classification Status     : ${p.sim_category}`,
        `--------------------------------------------------------------------`,
        `1. SATELLITE TELEMETRY`,
        `   - Baseline Dry-Season LST : ${Number(p.sim_lst).toFixed(2)} °C`,
        `   - Population Density      : ${Math.round(p.pop_density || 0).toLocaleString()} persons/km²`,
        `   - Heat Exposure Index     : ${Number(p.sim_exposure).toFixed(3)}`,
        `====================================================================`
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.ward_name.replace(/\s+/g, '_')}_Policy_Brief.txt`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('export-csv').addEventListener('click', () => {
    const cols = ['ward_name', 'mean_lst', 'sim_lst', 'ndvi', 'elevation', 'pop_density', 'sim_exposure', 'sim_giz', 'sim_category'];
    const rows = rawGeoJSON.features.map(f => cols.map(c => JSON.stringify(f.properties[c] ?? '')).join(','));
    const csv = [cols.join(','), ...rows].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lagos_uhi_analytics.csv`;
    a.click();
    URL.revokeObjectURL(url);
});
