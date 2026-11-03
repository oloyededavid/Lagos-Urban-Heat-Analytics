/**
 * Lagos Urban Heat & Population Exposure Analytics
 * Smooth, Zero-Jump Light Mode Engine with All 20 LGA Labels & Livability Advisor
 */

// Color Palettes for the 4 Layers
const PALETTES = {
    lst: ['#FEF0D9', '#FDCC8A', '#FC8D59', '#E34A33', '#B30000'],
    hotspot: ['#2166AC', '#92C5DE', '#F8FAFC', '#F4A582', '#B2182B'],
    exposure: ['#FFF7EC', '#FDD49E', '#FC8D59', '#D7301F', '#7F0000'],
    ndvi: ['#FEF0D9', '#D9F0A3', '#78C679', '#238443', '#004529']
};

// Small Nudges (lat, lng) for Tiny Clustered Mainland LGAs so All 20 Labels Are Readable
const LABEL_OFFSETS = {
    'Lagos Island': [-0.018, 0.008],
    'Lagos Mainland': [0.002, 0.015],
    'Surulere': [-0.008, -0.012],
    'Mushin': [0.012, -0.010],
    'Shomolu': [0.016, 0.014],
    'Ajeromi-Ifelodun': [-0.022, -0.018],
    'Apapa': [-0.028, 0.000],
    'Agege': [0.020, -0.015],
    'Ifako-Ijaye': [0.022, 0.005],
    'Oshodi/Isolo': [-0.004, -0.022],
    'Ikeja': [0.012, 0.002]
};

const STATE = {
    geojson: null,
    features: [],
    layer: 'lst',
    k: 5,
    selectedLga: null,
    compA: 'Ikeja',
    compB: 'Epe',
    deltaNdvi: 0,
    showLabels: true,
    is3D: false,
    slope: -12.4,
    slopeCI: 3.4,
    r2: 0.48
};

// 1. Initialize Smooth Leaflet Map (No Jump on Click)
const map = L.map('map', {
    zoomControl: false,
    wheelPxPerZoomLevel: 90
}).setView([6.5244, 3.42], 10);

L.control.zoom({ position: 'topright' }).addTo(map);

const BASEMAPS = {
    light: L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 16
        }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 16,
            opacity: 0.55
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

// 2. Color & Centroid Helpers
function hexToRgb(hex) {
    const clean = String(hex || '#FDCC8A').replace('#', '');
    const num = parseInt(clean, 16);
    if (isNaN(num)) return [253, 204, 138];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}

function interpolateColor(val, min, max, ramp) {
    const palette = ramp || PALETTES.lst;
    const t = Math.max(0, Math.min(1, (val - min) / ((max - min) || 1)));
    const scaled = t * (palette.length - 1);
    const i = Math.min(palette.length - 2, Math.floor(scaled));
    const f = scaled - i;
    const c1 = hexToRgb(palette[i]);
    const c2 = hexToRgb(palette[i + 1]);
    return rgbToHex(
        c1[0] + (c2[0] - c1[0]) * f,
        c1[1] + (c2[1] - c1[1]) * f,
        c1[2] + (c2[2] - c1[2]) * f
    );
}

function computeRingCentroid(ring) {
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

function getTrueCentroid(feature) {
    const geom = feature?.geometry;
    if (!geom || !geom.coordinates) return [3.3792, 6.5244];
    if (geom.type === 'Polygon') {
        return computeRingCentroid(geom.coordinates[0] || []).center;
    } else if (geom.type === 'MultiPolygon') {
        let best = { center: [3.3792, 6.5244], area: -1 };
        geom.coordinates.forEach(poly => {
            const res = computeRingCentroid(poly[0] || []);
            if (res.area > best.area) best = res;
        });
        return best.center;
    }
    return [3.3792, 6.5244];
}

// Universal Property Resolver (Never returns NaN or undefined)
function normalizeFeatureProperties(f, idx) {
    const p = f.properties || {};
    p.lga_name = String(p.ward_name || p.NAME_2 || p.ADM2_NAME || p.NAME || p.lga_name || `LGA ${idx + 1}`).trim();
    p.base_lst = Number(p.mean_lst ?? p.lst ?? p.LST ?? 35.5);
    p.base_ndvi = Number(p.ndvi ?? p.NDVI ?? 0.25);
    p.base_ndbi = Number(p.ndbi ?? p.NDBI ?? 0.08);
    p.base_pop = Number(p.pop_density ?? p.population ?? 5000);
    p.base_elev = Number(p.elevation ?? p.dem ?? 15.0);
    p._center = getTrueCentroid(f);
}

// Live KNN Getis-Ord Gi* (star=True) on Physical LST
function computeGiStar(features, k) {
    const n = features.length;
    const vals = features.map(f => f.properties.sim_lst);
    const meanY = vals.reduce((a, b) => a + b, 0) / n;
    const stdY = Math.sqrt(vals.reduce((s, v) => s + Math.pow(v - meanY, 2), 0) / n) || 1e-6;
    const centers = features.map(f => f.properties._center);

    return features.map((_, i) => {
        const dists = centers.map((c, j) => ({
            idx: j,
            d: Math.hypot(c[0] - centers[i][0], c[1] - centers[i][1])
        })).sort((a, b) => a.d - b.d);

        const nbrs = dists.slice(0, Math.min(n, Number(k) + 1)).map(d => d.idx);
        const m = nbrs.length;
        const sumWY = nbrs.reduce((acc, j) => acc + (1.0 / m) * vals[j], 0);
        const den = stdY * Math.sqrt(Math.max(1e-9, (n * (1.0 / m) - 1.0) / (n - 1)));
        return (sumWY - meanY) / den;
    });
}

// 3. Load GeoJSON with Multiple Fallback URLs
async function fetchLagosData() {
    const statusEl = document.getElementById('map-status');
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
                    if (statusEl) statusEl.classList.add('is-hidden');
                    return json;
                }
            }
        } catch (err) {}
    }
    if (statusEl) statusEl.innerText = 'Error loading GeoJSON data.';
    throw new Error('Could not load lagos_uhi_processed.geojson');
}

// 4. Boot Application
fetchLagosData().then(data => {
    STATE.geojson = data;
    STATE.features = data.features;

    STATE.features.forEach((f, idx) => normalizeFeatureProperties(f, idx));

    // Fit Empirical OLS Slope from Real GeoJSON Data
    const n = STATE.features.length;
    if (n > 3) {
        const xs = STATE.features.map(f => f.properties.base_ndvi);
        const ys = STATE.features.map(f => f.properties.base_lst);
        const mx = xs.reduce((a, b) => a + b, 0) / n;
        const my = ys.reduce((a, b) => a + b, 0) / n;
        const sxx = xs.reduce((s, x) => s + Math.pow(x - mx, 2), 0);
        const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
        const syy = ys.reduce((s, y) => s + Math.pow(y - my, 2), 0);
        if (sxx > 0 && syy > 0) {
            STATE.slope = sxy / sxx;
            STATE.r2 = Math.pow(sxy, 2) / (sxx * syy);
            const b0 = my - STATE.slope * mx;
            const sse = ys.reduce((s, y, i) => s + Math.pow(y - (b0 + STATE.slope * xs[i]), 2), 0);
            STATE.slopeCI = 2.101 * Math.sqrt((sse / Math.max(1, n - 2)) / sxx);
        }
    }

    document.getElementById('ols-slope-label').innerText =
        `β = ${STATE.slope.toFixed(1)} ± ${STATE.slopeCI.toFixed(1)} °C/NDVI (R² = ${STATE.r2.toFixed(2)})`;

    // Populate Search & Comparison Dropdowns
    const sortedNames = STATE.features.map(f => f.properties.lga_name).sort();
    document.getElementById('lga-list').innerHTML = sortedNames.map(name => `<option value="${name}"></option>`).join('');

    const compHtml = sortedNames.map(name => `<option value="${name}">${name}</option>`).join('');
    const selA = document.getElementById('comp-select-a');
    const selB = document.getElementById('comp-select-b');
    selA.innerHTML = compHtml;
    selB.innerHTML = compHtml;
    if (sortedNames.includes('Ikeja')) STATE.compA = 'Ikeja';
    else STATE.compA = sortedNames[0];
    if (sortedNames.includes('Epe')) STATE.compB = 'Epe';
    else STATE.compB = sortedNames[sortedNames.length - 1];
    selA.value = STATE.compA;
    selB.value = STATE.compB;

    buildPolygons();
    recomputeMetrics();
    initTourIfFirstVisit();
});

// 5. Recompute All Spatial Metrics & Update UI
function recomputeMetrics() {
    if (!STATE.features.length) return;
    const features = STATE.features;
    const n = features.length;

    // 1. Apply Greening Scenario Shift (Scaled by 1 - NDBI, Capped at NDVI <= 0.45)
    let totalDelta = 0;
    features.forEach(f => {
        const p = f.properties;
        const plantable = Math.max(0.30, Math.min(1.0, 1.0 - Math.max(0, p.base_ndbi) * 1.5));
        const simNdvi = Math.min(0.45, Math.max(p.base_ndvi, p.base_ndvi + STATE.deltaNdvi * plantable));
        const dNdvi = simNdvi - p.base_ndvi;
        p.sim_ndvi = simNdvi;
        p.sim_delta = dNdvi * STATE.slope;
        p.sim_ci = dNdvi * STATE.slopeCI;
        p.sim_lst = p.base_lst + p.sim_delta;
        totalDelta += p.sim_delta;
    });

    // 2. Compute Gi* Z-Scores & Heat Exposure Index (HEI)
    const giScores = computeGiStar(features, STATE.k);
    const lstVals = features.map(f => f.properties.sim_lst);
    const lstMin = Math.min(...lstVals), lstMax = Math.max(...lstVals);

    const logPops = features.map(f => Math.log1p(f.properties.base_pop));
    const pMin = Math.min(...logPops), pMax = Math.max(...logPops);
    const popSorted = features.map(f => f.properties.base_pop).sort((a, b) => a - b);
    const popQ70 = popSorted[Math.floor(n * 0.65)] || 5000;

    features.forEach((f, i) => {
        const p = f.properties;
        const preKey = `gi_zscore_k${STATE.k}`;
        p.sim_giz = (STATE.deltaNdvi === 0 && p[preKey] != null) ? Number(p[preKey]) : giScores[i];

        const lstNorm = (p.sim_lst - lstMin) / ((lstMax - lstMin) || 1);
        const popNorm = (logPops[i] - pMin) / ((pMax - pMin) || 1);
        p.sim_hei = lstNorm * popNorm;

        // Classify Thermal & Livability Tier
        if (p.sim_lst >= 38.2 && p.base_pop >= popQ70) {
            p.tier = 'Priority Cooling Core';
            p.tierColor = '#B91C1C';
            p.livability = 'High Heat Stress — Priority for Urban Tree Canopy & Reflective Cool Roofs';
        } else if (p.sim_lst >= 37.5) {
            p.tier = 'Warm Mainland Cluster';
            p.tierColor = '#EA580C';
            p.livability = 'Elevated Daytime Heat — Street Corridor Shading Recommended';
        } else if (p.sim_lst <= 35.8) {
            p.tier = 'Cooler Coastal / Green Refugium';
            p.tierColor = '#047857';
            p.livability = 'Favourable Thermal Comfort — Cooled by Lagoon/Sea Breeze or Dense Canopy';
        } else {
            p.tier = 'Moderate Urban Zone';
            p.tierColor = '#0284C7';
            p.livability = 'Moderate Urban Microclimate — Preserve Existing Green Buffers';
        }
    });

    // Update Executive Summary Strip
    const hottest = [...features].sort((a, b) => b.properties.sim_lst - a.properties.sim_lst).slice(0, 3);
    const coolest = [...features].sort((a, b) => a.properties.sim_lst - b.properties.sim_lst).slice(0, 2);
    document.getElementById('executive-finding').innerHTML =
        `<strong>Key Empirical Finding:</strong> Inland mainland LGAs (<strong>${hottest.map(f => `${f.properties.lga_name} ${f.properties.sim_lst.toFixed(1)}°C`).join(', ')}</strong>) experience the highest surface temperatures, while <strong>${coolest.map(f => `${f.properties.lga_name} (${f.properties.sim_lst.toFixed(1)}°C)`).join(' & ')}</strong> remain cooler.`;

    const avgDelta = totalDelta / n;
    document.getElementById('sim-badge').innerText =
        STATE.deltaNdvi === 0 ? '0.00 °C Shift' : `${avgDelta.toFixed(2)} °C Mean Shift`;

    document.getElementById('live-model-summary').innerText =
        `Live Dataset Diagnostics (N = ${n} LGAs): Mean LST = ${(lstVals.reduce((a, b) => a + b, 0) / n).toFixed(2)}°C (Range: ${lstMin.toFixed(1)}°C to ${lstMax.toFixed(1)}°C) · OLS NDVI–LST Slope β = ${STATE.slope.toFixed(2)} ± ${STATE.slopeCI.toFixed(2)} °C/NDVI (R² = ${STATE.r2.toFixed(2)}).`;

    stylePolygonsAndLabels();
    renderComparison();
    renderRankingTable();

    if (STATE.selectedLga) {
        const feat = features.find(f => f.properties.lga_name === STATE.selectedLga);
        if (feat) renderSelectedLga(feat.properties);
    } else {
        renderStateOverview();
    }
}

// 6. Build Polygons & Render All 20 Permanent LGA Labels
function buildPolygons() {
    if (geojsonLayer) map.removeLayer(geojsonLayer);
    layerIndex = {};

    geojsonLayer = L.geoJSON(STATE.geojson, {
        style: () => ({
            fillColor: '#FDCC8A',
            weight: 1.4,
            color: '#334155',
            fillOpacity: 0.84
        }),
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            layerIndex[p.lga_name] = layer;

            layer.bindTooltip('', { sticky: true, className: 'clean-tip' });

            layer.on('mouseover', () => {
                if (p.lga_name !== STATE.selectedLga) {
                    layer.setStyle({ weight: 2.6, color: '#0F172A', fillOpacity: 0.94 });
                }
            });

            layer.on('mouseout', () => {
                if (p.lga_name !== STATE.selectedLga) {
                    layer.setStyle({ weight: 1.4, color: '#334155', fillOpacity: 0.84 });
                }
            });

            // Smooth Click: Selects LGA and updates telemetry WITHOUT jumping the map camera
            layer.on('click', () => {
                selectLga(p.lga_name, false);
            });
        }
    }).addTo(map);

    map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
}

function stylePolygonsAndLabels() {
    if (!geojsonLayer) return;
    labelGroup.clearLayers();

    const features = STATE.features;
    const vals = features.map(f => {
        const p = f.properties;
        if (STATE.layer === 'lst') return p.sim_lst;
        if (STATE.layer === 'hotspot') return p.sim_giz;
        if (STATE.layer === 'exposure') return p.sim_hei;
        return p.sim_ndvi;
    });
    const vMin = Math.min(...vals), vMax = Math.max(...vals);
    const ramp = PALETTES[STATE.layer] || PALETTES.lst;

    geojsonLayer.eachLayer(layer => {
        const p = layer.feature.properties;
        const val = STATE.layer === 'lst' ? p.sim_lst
                  : STATE.layer === 'hotspot' ? p.sim_giz
                  : STATE.layer === 'exposure' ? p.sim_hei
                  : p.sim_ndvi;

        p._color = interpolateColor(val, vMin, vMax, ramp);
        const isSel = (p.lga_name === STATE.selectedLga);

        layer.setStyle({
            fillColor: p._color,
            weight: isSel ? 3.5 : 1.4,
            color: isSel ? '#0284C7' : '#334155',
            fillOpacity: isSel ? 0.95 : 0.84
        });

        layer.setTooltipContent(`
            <strong>${p.lga_name} LGA</strong><br/>
            LST: <b>${p.sim_lst.toFixed(2)} °C</b> · Gi* Z: <b>${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}</b><br/>
            HEI: <b>${p.sim_hei.toFixed(3)}</b> · NDVI: <b>${p.sim_ndvi.toFixed(3)}</b><br/>
            <span style="color:${p.tierColor};font-weight:700;">${p.tier}</span>
        `);
    });

    updateLegendCard(vMin, vMax, ramp);

    // Render All 20 LGA Labels Clearly on Map
    if (!STATE.showLabels) return;

    features.forEach(f => {
        const p = f.properties;
        const offset = LABEL_OFFSETS[p.lga_name] || [0, 0];
        const lat = p._center[1] + offset[0];
        const lng = p._center[0] + offset[1];
        const isSel = (p.lga_name === STATE.selectedLga);

        const metricText = STATE.layer === 'lst' ? `${p.sim_lst.toFixed(1)}°C`
                         : STATE.layer === 'hotspot' ? `Gi* ${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}`
                         : STATE.layer === 'exposure' ? `HEI ${p.sim_hei.toFixed(2)}`
                         : `NDVI ${p.sim_ndvi.toFixed(2)}`;

        const marker = L.marker([lat, lng], {
            interactive: false,
            icon: L.divIcon({
                className: 'lga-label-icon',
                html: `<div class="lga-pin ${isSel ? 'is-selected' : ''}">${p.lga_name}<span>${metricText}</span></div>`,
                iconSize: [0, 0]
            })
        });
        labelGroup.addLayer(marker);
    });
}

// 7. Comprehensive Legend Updater
function updateLegendCard(vMin, vMax, ramp) {
    const q25 = vMin + (vMax - vMin) * 0.25;
    const mid = (vMin + vMax) * 0.50;
    const q75 = vMin + (vMax - vMin) * 0.75;

    const meta = {
        lst: ['Land Surface Temp (LST °C)', 'Landsat 8/9 (30m)', v => `${v.toFixed(1)}°C`, [
            ['#FEF0D9', 'Cooler (<36.0°C)'],
            ['#FDCC8A', 'Moderate (36–37°C)'],
            ['#FC8D59', 'Warm (37–38°C)'],
            ['#B30000', 'Hot Core (>38.2°C)']
        ]],
        hotspot: ['Getis-Ord Gi* Clustering (Z)', `KNN (k = ${STATE.k})`, v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`, [
            ['#2166AC', 'Cool Refugium (Z < -0.5)'],
            ['#92C5DE', 'Slightly Cool'],
            ['#F4A582', 'Warm Cluster'],
            ['#B2182B', 'Hotspot Core (Z > +0.6)']
        ]],
        exposure: ['Heat Exposure Index (HEI)', 'LST × log(Pop)', v => v.toFixed(2), [
            ['#FFF7EC', 'Low Exposure (<0.20)'],
            ['#FDD49E', 'Moderate (0.20–0.45)'],
            ['#FC8D59', 'High (0.45–0.65)'],
            ['#7F0000', 'Critical (>0.65)']
        ]],
        ndvi: ['Vegetation Canopy (NDVI)', 'Sentinel-2 (10m)', v => v.toFixed(2), [
            ['#FEF0D9', 'Dense Built (<0.20)'],
            ['#D9F0A3', 'Sparse Green (0.20–0.30)'],
            ['#78C679', 'Moderate Canopy'],
            ['#004529', 'Dense Vegetation (>0.40)']
        ]]
    };

    const [title, tag, fmt, classes] = meta[STATE.layer];
    document.getElementById('legend-title').innerText = title;
    document.getElementById('legend-tag').innerText = tag;
    document.getElementById('legend-bar').style.background = `linear-gradient(90deg, ${ramp.join(', ')})`;

    document.getElementById('legend-min').innerText = fmt(vMin);
    document.getElementById('legend-q25').innerText = fmt(q25);
    document.getElementById('legend-mid').innerText = fmt(mid);
    document.getElementById('legend-q75').innerText = fmt(q75);
    document.getElementById('legend-max').innerText = fmt(vMax);

    document.getElementById('legend-classes').innerHTML = classes.map(([col, label]) =>
        `<div class="legend-item"><span class="swatch-dot" style="background:${col}"></span><span>${label}</span></div>`
    ).join('');
}

// 8. Select LGA (Zero Camera Jump Unless Explicitly Requested)
function selectLga(lgaName, shouldZoom = false) {
    const feat = STATE.features.find(f => f.properties.lga_name.toLowerCase() === String(lgaName).toLowerCase());
    if (!feat) return;

    STATE.selectedLga = feat.properties.lga_name;
    document.getElementById('btn-zoom-lga').classList.remove('is-hidden');

    const targetLayer = layerIndex[STATE.selectedLga];
    if (targetLayer) {
        targetLayer.bringToFront();
        if (shouldZoom) {
            map.flyToBounds(targetLayer.getBounds(), { padding: [70, 70], maxZoom: 12, duration: 0.65 });
        }
    }

    // Also set Comparison Slot A to the clicked LGA so comparison updates live
    STATE.compA = STATE.selectedLga;
    document.getElementById('comp-select-a').value = STATE.compA;

    stylePolygonsAndLabels();
    renderSelectedLga(feat.properties);
    renderComparison();
    renderRankingTable();
}

function renderSelectedLga(p) {
    const sortedLst = STATE.features.map(f => f.properties.sim_lst).sort((a, b) => a - b);
    const rankIdx = sortedLst.indexOf(p.sim_lst);
    const warmerPct = Math.round((rankIdx / Math.max(1, sortedLst.length - 1)) * 100);

    document.getElementById('sel-eyebrow').innerText = 'Selected Local Government Area';
    document.getElementById('sel-title').innerText = `${p.lga_name} LGA`;
    document.getElementById('sel-insight').innerText =
        `${p.lga_name} records a mean surface temperature of ${p.sim_lst.toFixed(2)} °C (warmer than ${warmerPct}% of Lagos LGAs), with vegetation cover NDVI = ${p.sim_ndvi.toFixed(3)} and population density of ${Math.round(p.base_pop).toLocaleString()} people/km².`;

    const badge = document.getElementById('sel-badge');
    badge.innerText = p.tier;
    badge.style.background = p.tierColor;
    badge.style.color = '#FFFFFF';
    badge.style.borderColor = p.tierColor;

    document.getElementById('val-lst').innerText = `${p.sim_lst.toFixed(2)} °C`;
    document.getElementById('sub-lst').innerText =
        STATE.deltaNdvi > 0 ? `Scenario shift: ${p.sim_delta.toFixed(2)} °C` : `Warmer than ${warmerPct}% of Lagos`;

    document.getElementById('val-giz').innerText = `${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}`;
    document.getElementById('sub-giz').innerText = p.sim_giz >= 0.55 ? 'Warm cluster neighbour' : (p.sim_giz <= -0.45 ? 'Cooler refugium cluster' : 'Neutral cluster');

    document.getElementById('val-hei').innerText = p.sim_hei.toFixed(3);
    document.getElementById('sub-hei').innerText = p.sim_hei >= 0.55 ? 'High human heat exposure' : 'Moderate/low exposure';

    document.getElementById('val-ndvi').innerText = p.sim_ndvi.toFixed(3);
    document.getElementById('sub-ndbi').innerText = `Built-up NDBI: ${p.base_ndbi.toFixed(3)}`;

    document.getElementById('val-pop').innerText = `${Math.round(p.base_pop).toLocaleString()}`;
    document.getElementById('val-elev').innerText = `${p.base_elev.toFixed(1)} m`;

    document.getElementById('livability-rating').innerText = `${p.lga_name}: ${p.tier}`;
    document.getElementById('livability-desc').innerText = p.livability;
}

function renderStateOverview() {
    const features = STATE.features;
    const n = features.length;
    const meanLst = features.reduce((s, f) => s + f.properties.sim_lst, 0) / n;
    const maxGi = Math.max(...features.map(f => f.properties.sim_giz));
    const meanHei = features.reduce((s, f) => s + f.properties.sim_hei, 0) / n;
    const meanNdvi = features.reduce((s, f) => s + f.properties.sim_ndvi, 0) / n;
    const meanNdbi = features.reduce((s, f) => s + f.properties.base_ndbi, 0) / n;
    const meanPop = features.reduce((s, f) => s + f.properties.base_pop, 0) / n;
    const meanElev = features.reduce((s, f) => s + f.properties.base_elev, 0) / n;

    document.getElementById('sel-eyebrow').innerText = 'Statewide Summary (All 20 LGAs)';
    document.getElementById('sel-title').innerText = 'Lagos State Overview';
    document.getElementById('btn-zoom-lga').classList.add('is-hidden');

    const badge = document.getElementById('sel-badge');
    badge.innerText = 'Click Any LGA';
    badge.style.background = '#F8FAFC';
    badge.style.color = '#334155';
    badge.style.borderColor = '#CBD5E1';

    document.getElementById('val-lst').innerText = `${meanLst.toFixed(2)} °C`;
    document.getElementById('sub-lst').innerText = 'Statewide mean LST';
    document.getElementById('val-giz').innerText = `+${maxGi.toFixed(2)}`;
    document.getElementById('sub-giz').innerText = 'Peak hotspot Z-score';
    document.getElementById('val-hei').innerText = meanHei.toFixed(3);
    document.getElementById('sub-hei').innerText = 'Mean exposure index';
    document.getElementById('val-ndvi').innerText = meanNdvi.toFixed(3);
    document.getElementById('sub-ndbi').innerText = `Mean NDBI: ${meanNdbi.toFixed(3)}`;
    document.getElementById('val-pop').innerText = `${Math.round(meanPop).toLocaleString()}`;
    document.getElementById('val-elev').innerText = `${meanElev.toFixed(1)} m`;
}

// 9. Side-by-Side Comparison & Complete 20-LGA Table
function renderComparison() {
    const fA = STATE.features.find(f => f.properties.lga_name === STATE.compA) || STATE.features[0];
    const fB = STATE.features.find(f => f.properties.lga_name === STATE.compB) || STATE.features[1];
    if (!fA || !fB) return;

    const a = fA.properties, b = fB.properties;
    document.getElementById('comp-th-a').innerText = a.lga_name;
    document.getElementById('comp-th-b').innerText = b.lga_name;

    const diffLst = a.sim_lst - b.sim_lst;
    const diffHei = a.sim_hei - b.sim_hei;
    const diffNdvi = a.sim_ndvi - b.sim_ndvi;

    const rows = [
        ['Surface Temp (LST)', `${a.sim_lst.toFixed(2)} °C`, `${b.sim_lst.toFixed(2)} °C`, `${diffLst >= 0 ? '+' : ''}${diffLst.toFixed(2)} °C`],
        ['Gi* Hotspot Z', `${a.sim_giz >= 0 ? '+' : ''}${a.sim_giz.toFixed(2)}`, `${b.sim_giz >= 0 ? '+' : ''}${b.sim_giz.toFixed(2)}`, `${(a.sim_giz - b.sim_giz).toFixed(2)}`],
        ['Heat Exposure (HEI)', a.sim_hei.toFixed(3), b.sim_hei.toFixed(3), `${diffHei >= 0 ? '+' : ''}${diffHei.toFixed(3)}`],
        ['Vegetation (NDVI)', a.sim_ndvi.toFixed(3), b.sim_ndvi.toFixed(3), `${diffNdvi >= 0 ? '+' : ''}${diffNdvi.toFixed(3)}`],
        ['Pop. Density (/km²)', Math.round(a.base_pop).toLocaleString(), Math.round(b.base_pop).toLocaleString(), `${Math.round(a.base_pop - b.base_pop).toLocaleString()}`]
    ];

    document.getElementById('comp-tbody').innerHTML = rows.map(([m, va, vb, d]) =>
        `<tr><td>${m}</td><td><strong>${va}</strong></td><td><strong>${vb}</strong></td><td class="mono">${d}</td></tr>`
    ).join('');
}

function renderRankingTable() {
    const tbody = document.getElementById('ranking-tbody');
    const sorted = [...STATE.features].sort((a, b) => b.properties.sim_hei - a.properties.sim_hei);

    tbody.innerHTML = sorted.map(f => {
        const p = f.properties;
        const isSel = p.lga_name === STATE.selectedLga ? 'is-active-row' : '';
        return `
            <tr class="${isSel}" data-lga="${p.lga_name}">
                <td><span class="swatch-dot" style="background:${p._color};display:inline-block;margin-right:6px;vertical-align:middle;"></span><strong>${p.lga_name}</strong></td>
                <td>${p.sim_lst.toFixed(1)} °C</td>
                <td>${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}</td>
                <td>${p.sim_ndvi.toFixed(2)}</td>
                <td>${p.sim_hei.toFixed(3)}</td>
                <td style="color:${p.tierColor};font-weight:600;">${p.tier.split(' ')[0]}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
            selectLga(tr.getAttribute('data-lga'), false);
        });
    });
}

// 10. UI Controls, 3D Tilt, Exports & Onboarding Tour
document.getElementById('layer-select').addEventListener('change', e => {
    STATE.layer = e.target.value;
    stylePolygonsAndLabels();
});

document.getElementById('basemap-select').addEventListener('change', e => {
    const next = BASEMAPS[e.target.value];
    if (next && next !== activeBasemap) {
        map.removeLayer(activeBasemap);
        activeBasemap = next.addTo(map);
        if (geojsonLayer) geojsonLayer.bringToFront();
    }
});

document.getElementById('k-select').addEventListener('change', e => {
    STATE.k = Number(e.target.value);
    recomputeMetrics();
});

document.getElementById('ndvi-slider').addEventListener('input', e => {
    STATE.deltaNdvi = Number(e.target.value);
    document.getElementById('slider-val').innerText = `+${STATE.deltaNdvi.toFixed(3)} NDVI`;
    recomputeMetrics();
});

document.getElementById('comp-select-a').addEventListener('change', e => {
    STATE.compA = e.target.value;
    renderComparison();
});

document.getElementById('comp-select-b').addEventListener('change', e => {
    STATE.compB = e.target.value;
    renderComparison();
});

document.getElementById('lga-search').addEventListener('change', e => {
    if (e.target.value) {
        selectLga(e.target.value, true);
        e.target.value = '';
    }
});

document.getElementById('btn-zoom-lga').addEventListener('click', () => {
    if (STATE.selectedLga) selectLga(STATE.selectedLga, true);
});

document.getElementById('btn-3d').addEventListener('click', e => {
    STATE.is3D = !STATE.is3D;
    document.getElementById('map-stage').classList.toggle('is-3d', STATE.is3D);
    e.currentTarget.classList.toggle('active', STATE.is3D);
});

document.getElementById('btn-labels').addEventListener('click', e => {
    STATE.showLabels = !STATE.showLabels;
    e.currentTarget.classList.toggle('active', STATE.showLabels);
    stylePolygonsAndLabels();
});

document.getElementById('btn-reset').addEventListener('click', () => {
    STATE.selectedLga = null;
    STATE.deltaNdvi = 0;
    document.getElementById('ndvi-slider').value = 0;
    document.getElementById('slider-val').innerText = '+0.000 NDVI';
    if (geojsonLayer) map.flyToBounds(geojsonLayer.getBounds(), { padding: [24, 24], duration: 0.6 });
    recomputeMetrics();
});

// CSV & GeoJSON Downloads
function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

document.getElementById('btn-export-csv').addEventListener('click', () => {
    if (!STATE.features.length) return;
    const headers = ['LGA_Name', 'LST_C', 'Gi_Star_Z', 'HEI_Index', 'NDVI', 'NDBI', 'Pop_Density_km2', 'Elevation_m', 'Thermal_Tier'];
    const rows = STATE.features.map(f => {
        const p = f.properties;
        return [`"${p.lga_name}"`, p.sim_lst.toFixed(2), p.sim_giz.toFixed(3), p.sim_hei.toFixed(3), p.sim_ndvi.toFixed(3), p.base_ndbi.toFixed(3), Math.round(p.base_pop), p.base_elev.toFixed(1), `"${p.tier}"`].join(',');
    });
    downloadBlob([headers.join(','), ...rows].join('\n'), 'lagos_urban_heat_20_lgas.csv', 'text/csv');
});

document.getElementById('btn-export-geojson').addEventListener('click', () => {
    if (!STATE.geojson) return;
    downloadBlob(JSON.stringify(STATE.geojson, null, 2), 'lagos_urban_heat_20_lgas.geojson', 'application/geo+json');
});

// Methods Modal
const methodsModal = document.getElementById('methods-modal');
document.getElementById('btn-methods').addEventListener('click', () => methodsModal.classList.remove('is-hidden'));
document.getElementById('btn-close-methods').addEventListener('click', () => methodsModal.classList.add('is-hidden'));
methodsModal.addEventListener('click', e => { if (e.target === methodsModal) methodsModal.classList.add('is-hidden'); });

// Contextual "?" Tooltips
const tipEl = document.getElementById('floating-tip');
document.querySelectorAll('.tip-btn').forEach(btn => {
    const show = () => {
        const r = btn.getBoundingClientRect();
        tipEl.innerText = btn.getAttribute('data-tip');
        tipEl.classList.remove('is-hidden');
        tipEl.style.top = `${Math.max(8, r.top - tipEl.offsetHeight - 8)}px`;
        tipEl.style.left = `${Math.min(window.innerWidth - 270, Math.max(8, r.left - 110))}px`;
    };
    const hide = () => tipEl.classList.add('is-hidden');
    btn.addEventListener('mouseenter', show);
    btn.addEventListener('focus', show);
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('blur', hide);
});

// 4-Step Interactive Onboarding Guide
const TOUR_STEPS = [
    {
        title: '1. All 20 Lagos LGAs Labeled & Mapped',
        desc: 'Every Local Government Area is labeled directly on the map with its live metric value. Click any polygon to inspect its exact numbers—the camera stays smooth and steady without jumping.'
    },
    {
        title: '2. Switch Layers & Toggle 3D Perspective',
        desc: 'Use the top bar to switch between Land Surface Temperature (LST °C), Getis-Ord Gi* thermal hotspots, the Heat Exposure Index (HEI), and Sentinel-2 vegetation (NDVI), or click "3D View" for a tilted perspective.'
    },
    {
        title: '3. Residential Livability & Canopy Simulator',
        desc: 'Check the Residential Comfort guide to see which areas offer cooler microclimates, and slide the Canopy Simulator (+ΔNDVI) to model urban greening cooling across Lagos.'
    },
    {
        title: '4. Compare LGAs Side-by-Side & Export Data',
        desc: 'Compare any two LGAs head-to-head in the benchmark table, or export the entire 20-LGA dataset as CSV or GeoJSON with one click.'
    }
];

let tourIdx = 0;
const tourOverlay = document.getElementById('tour-overlay');

function renderTour() {
    const step = TOUR_STEPS[tourIdx];
    document.getElementById('tour-step-num').innerText = `Step ${tourIdx + 1} of ${TOUR_STEPS.length}`;
    document.getElementById('tour-title').innerText = step.title;
    document.getElementById('tour-desc').innerText = step.desc;
    document.getElementById('tour-dots').innerHTML = TOUR_STEPS.map((_, i) =>
        `<span class="tour-dot ${i === tourIdx ? 'active' : ''}"></span>`
    ).join('');
    document.getElementById('tour-prev').style.visibility = tourIdx === 0 ? 'hidden' : 'visible';
    document.getElementById('tour-next').innerText = tourIdx === TOUR_STEPS.length - 1 ? 'Start Exploring' : 'Next';
}

function openTour() {
    tourIdx = 0;
    renderTour();
    tourOverlay.classList.remove('is-hidden');
}

function closeTour() {
    tourOverlay.classList.add('is-hidden');
    try { localStorage.setItem('lagos_uhi_tour_v3', '1'); } catch (e) {}
}

function initTourIfFirstVisit() {
    try {
        if (!localStorage.getItem('lagos_uhi_tour_v3')) openTour();
    } catch (e) {}
}

document.getElementById('btn-tour').addEventListener('click', openTour);
document.getElementById('tour-close').addEventListener('click', closeTour);
document.getElementById('tour-prev').addEventListener('click', () => {
    if (tourIdx > 0) { tourIdx--; renderTour(); }
});
document.getElementById('tour-next').addEventListener('click', () => {
    if (tourIdx < TOUR_STEPS.length - 1) { tourIdx++; renderTour(); }
    else closeTour();
});
