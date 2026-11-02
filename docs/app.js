// 1. Initialize Crisp 2D Leaflet Map
const map = L.map('map', {
    zoomControl: false
}).setView([6.5244, 3.3792], 10);

L.control.zoom({ position: 'topright' }).addTo(map);

// Keyless Basemap Layers
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
            opacity: 0.8
        })
    ])
};

let activeBasemap = BASEMAPS.light;
activeBasemap.addTo(map);

// Application State
let rawGeoJSON = null;
let geojsonLayer = null;
let labelGroup = L.layerGroup().addTo(map);
let layerIndex = {};
let currentMetric = 'hotspot';
let currentK = 5;
let deltaNdviInput = 0;
let empiricalSlope = 0;
let slopeCI95 = 0;
let olsR2 = 0;
let modisPearsonR = null;
let popThreshold = 0;
let selectedZone = null;

// Cohesive, Colorblind-Safe Continuous Graduated Spectrums
const SPECTRUMS = {
    hotspot: ['#2166ac', '#92c5de', '#f8fafc', '#f4a582', '#d6604d', '#8c0d1f'],
    lst: ['#fff7ec', '#fee8c8', '#fdbb84', '#ef6548', '#b30000', '#67000d'],
    exposure: ['#fffbeb', '#fde68a', '#fb923c', '#e11d48', '#9f1239', '#4c0519'],
    ndvi: ['#f7fcb9', '#d9f0a3', '#78c679', '#31a354', '#006837', '#004529']
};

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}

function getContrastTextColor(hex) {
    const [r, g, b] = hexToRgb(hex);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 155 ? '#0f172a' : '#ffffff';
}

function interpolateSpectrum(val, min, max, hexStops) {
    const t = Math.max(0, Math.min(1, (val - min) / ((max - min) || 1)));
    const scaled = t * (hexStops.length - 1);
    const i = Math.min(hexStops.length - 2, Math.floor(scaled));
    const f = scaled - i;
    const c1 = hexToRgb(hexStops[i]);
    const c2 = hexToRgb(hexStops[i + 1]);
    return rgbToHex(
        c1[0] + (c2[0] - c1[0]) * f,
        c1[1] + (c2[1] - c1[1]) * f,
        c1[2] + (c2[2] - c1[2]) * f
    );
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
        const avgX = ring.reduce((s, p) => s + p[0], 0) / n;
        const avgY = ring.reduce((s, p) => s + p[1], 0) / n;
        return { center: [avgX, avgY], area: 0 };
    }

    return {
        center: [cx / (3 * area2), cy / (3 * area2)],
        area: Math.abs(area2) / 2
    };
}

function getPolygonCentroidAndArea(feature) {
    const geom = feature?.geometry;
    if (!geom || !geom.coordinates) return { center: [3.3792, 6.5244], area: 0 };

    let best = { center: [3.3792, 6.5244], area: -1 };
    let totalArea = 0;

    if (geom.type === 'Polygon') {
        const res = computeRingCentroidAndArea(geom.coordinates[0] || []);
        best = res;
        totalArea = res.area;
    } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(poly => {
            const res = computeRingCentroidAndArea(poly[0] || []);
            totalArea += res.area;
            if (res.area > best.area) best = res;
        });
    }
    return { center: best.center, area: totalArea };
}

function computeGiStar(features, k, benchmarkMean, benchmarkStd) {
    const n = features.length;
    const vals = features.map(f => Number(f.properties.sim_lst || 34));
    const meanY = benchmarkMean !== undefined ? benchmarkMean : (vals.reduce((a, b) => a + b, 0) / n);
    const s = benchmarkStd !== undefined ? benchmarkStd : (Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - meanY, 2), 0) / n) || 1e-6);
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
    indexed.forEach((item, rank0) => {
        const rank = rank0 + 1;
        if (item.p <= (rank / m) * alpha) maxRank = rank0;
    });
    for (let i = 0; i <= maxRank; i++) {
        sig[indexed[i].idx] = true;
    }
    return sig;
}

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
            p.ward_name = String(p.ward_name || p.ADM2_NAME || p.WardName || p.NAME || `LGA ${i + 1}`);
            const geomStats = getPolygonCentroidAndArea(f);
            p._center = geomStats.center;
            p._area = geomStats.area;
        });

        const pops = data.features.map(f => Number(f.properties.pop_density || 0)).sort((a, b) => a - b);
        popThreshold = pops[Math.floor(pops.length * 0.65)] || 0;

        const valid = data.features.filter(f => f.properties.ndvi != null && f.properties.mean_lst != null);
        if (valid.length > 3) {
            const n = valid.length;
            const xs = valid.map(f => Number(f.properties.ndvi));
            const ys = valid.map(f => Number(f.properties.mean_lst));
            const mx = xs.reduce((a, b) => a + b, 0) / n;
            const my = ys.reduce((a, b) => a + b, 0) / n;
            const sxx = xs.reduce((s, x) => s + Math.pow(x - mx, 2), 0);
            const sxy = xs.reduce((s, x, idx) => s + (x - mx) * (ys[idx] - my), 0);
            const syy = ys.reduce((s, y) => s + Math.pow(y - my, 2), 0);

            if (sxx > 0 && syy > 0) {
                empiricalSlope = sxy / sxx;
                olsR2 = Math.pow(sxy, 2) / (sxx * syy);
                const intercept = my - empiricalSlope * mx;
                const sse = ys.reduce((s, y, idx) => s + Math.pow(y - (intercept + empiricalSlope * xs[idx]), 2), 0);
                const seSlope = Math.sqrt((sse / Math.max(1, n - 2)) / sxx);
                slopeCI95 = 2.101 * seSlope;
            }

            const minNdvi = Math.min(...xs), maxNdvi = Math.max(...xs);
            document.getElementById('ndvi-domain').innerText = `${minNdvi.toFixed(2)}–${maxNdvi.toFixed(2)}`;
        }

        const modisValid = data.features.filter(f => f.properties.modis_lst != null && f.properties.mean_lst != null);
        if (modisValid.length > 3) {
            const n = modisValid.length;
            const lx = modisValid.map(f => Number(f.properties.mean_lst));
            const my = modisValid.map(f => Number(f.properties.modis_lst));
            const mlx = lx.reduce((a, b) => a + b, 0) / n;
            const mmy = my.reduce((a, b) => a + b, 0) / n;
            const num = lx.reduce((s, x, idx) => s + (x - mlx) * (my[idx] - mmy), 0);
            const den = Math.sqrt(lx.reduce((s, x) => s + Math.pow(x - mlx, 2), 0) * my.reduce((s, y) => s + Math.pow(y - mmy, 2), 0));
            if (den > 0) modisPearsonR = num / den;
        }

        document.getElementById('slope-val').innerText =
            `β = ${empiricalSlope.toFixed(2)} ± ${slopeCI95.toFixed(2)} °C / NDVI`;
        document.getElementById('ols-stats').innerText = `R² = ${olsR2.toFixed(2)}`;
        if (modisPearsonR !== null) {
            document.getElementById('validation-inline').innerText =
                `Cross-sensor Landsat 30m vs. MODIS 1km r = ${modisPearsonR.toFixed(2)}.`;
        }

        buildMapPolygons(true);
        updateModel();
    })
    .catch(err => console.error('GeoJSON load error:', err));

function updateModel() {
    if (!rawGeoJSON) return;
    const features = rawGeoJSON.features;

    features.forEach(f => {
        const p = f.properties;
        const baseNdvi = Number(p.ndvi ?? 0.25);
        const ndbi = Number(p.ndbi ?? 0.05);
        const nonBuiltFraction = Math.max(0.30, Math.min(1.0, 1.0 - Math.max(0, ndbi) * 1.6));
        const effectiveShift = deltaNdviInput * nonBuiltFraction;
        const simNdvi = Math.min(0.45, Math.max(baseNdvi, baseNdvi + effectiveShift));
        const actualDeltaNdvi = simNdvi - baseNdvi;
        const dLst = actualDeltaNdvi * empiricalSlope;
        const dLstCI = actualDeltaNdvi * slopeCI95;

        p.sim_ndvi = simNdvi;
        p.sim_lst = Number(p.mean_lst ?? 34) + dLst;
        p.sim_delta = dLst;
        p.sim_delta_ci = dLstCI;
    });

    const baseMean = features.reduce((s, f) => s + Number(f.properties.mean_lst ?? 34), 0) / features.length;
    const baseStd = Math.sqrt(features.reduce((s, f) => s + Math.pow(Number(f.properties.mean_lst ?? 34) - baseMean, 2), 0) / features.length) || 1;

    const giK3 = computeGiStar(features, 3, baseMean, baseStd);
    const giK5 = computeGiStar(features, 5, baseMean, baseStd);
    const giK8 = computeGiStar(features, 8, baseMean, baseStd);
    const activeGiMap = { 3: giK3, 5: giK5, 8: giK8 }[currentK] || giK5;

    const lstVals = features.map(f => f.properties.sim_lst);
    const lstMin = Math.min(...lstVals), lstMax = Math.max(...lstVals);

    const ndviVals = features.map(f => f.properties.sim_ndvi);
    const ndviMin = Math.min(...ndviVals), ndviMax = Math.max(...ndviVals);

    const popLogs = features.map(f => Math.log1p(Number(f.properties.pop_density || 0)));
    const pMin = Math.min(...popLogs), pMax = Math.max(...popLogs);

    const zScoresActive = features.map((f, idx) => {
        const pyGiz = f.properties[`gi_zscore_k${currentK}`];
        if (deltaNdviInput === 0 && pyGiz !== undefined && pyGiz !== null) {
            return Number(pyGiz);
        }
        return activeGiMap[idx];
    });
    const zMin = Math.min(...zScoresActive), zMax = Math.max(...zScoresActive);
    const pValsActive = zScoresActive.map(z => normalTwoSidedP(z));
    const fdrFlags = computeBHFDR(pValsActive, 0.05);

    let priorityCount = 0;
    let totalDelta = 0;
    let totalCI = 0;
    const kStableNames = [];

    features.forEach((f, idx) => {
        const p = f.properties;
        p.sim_lst_z = (p.sim_lst - baseMean) / baseStd;
        p.sim_giz = zScoresActive[idx];
        p.sim_pval = pValsActive[idx];
        p.sim_fdr = (deltaNdviInput === 0 && Boolean(p[`fdr_sig_k${currentK}`])) || fdrFlags[idx];

        const z3 = deltaNdviInput === 0 && p.gi_zscore_k3 !== undefined ? Number(p.gi_zscore_k3) : giK3[idx];
        const z5 = deltaNdviInput === 0 && p.gi_zscore_k5 !== undefined ? Number(p.gi_zscore_k5) : giK5[idx];
        const z8 = deltaNdviInput === 0 && p.gi_zscore_k8 !== undefined ? Number(p.gi_zscore_k8) : giK8[idx];
        p.k_stable_hot = (z3 >= 0.55 && z5 >= 0.55 && z8 >= 0.55);
        if (p.k_stable_hot) kStableNames.push(p.ward_name);

        const lstNorm = Math.max(0, (p.sim_lst - lstMin) / ((lstMax - lstMin) || 1));
        const popNorm = (Math.log1p(Number(p.pop_density || 0)) - pMin) / ((pMax - pMin) || 1);
        p.sim_exp = lstNorm * popNorm;

        const isDense = Number(p.pop_density || 0) >= popThreshold;
        const compositeHeat = Math.max(p.sim_giz, p.sim_lst_z);

        p.is_priority = (compositeHeat >= 0.65 && isDense);
        if (p.is_priority) {
            p.sim_cat = 'Priority Cooling Zone';
            priorityCount++;
        } else if (compositeHeat >= 0.65) {
            p.sim_cat = 'Elevated Thermal Cluster';
        } else if (compositeHeat <= -0.45) {
            p.sim_cat = 'Cooler Thermal Refugium';
        } else {
            p.sim_cat = 'Moderate Urban Zone';
        }

        if (currentMetric === 'hotspot') {
            const bound = Math.max(Math.abs(zMin), Math.abs(zMax), 0.85);
            p.fillColor = interpolateSpectrum(p.sim_giz, -bound, bound, SPECTRUMS.hotspot);
        } else if (currentMetric === 'lst') {
            p.fillColor = interpolateSpectrum(p.sim_lst, lstMin, lstMax, SPECTRUMS.lst);
        } else if (currentMetric === 'exposure') {
            p.fillColor = interpolateSpectrum(p.sim_exp, 0, 0.85, SPECTRUMS.exposure);
        } else {
            p.fillColor = interpolateSpectrum(p.sim_ndvi, ndviMin, ndviMax, SPECTRUMS.ndvi);
        }

        totalDelta += p.sim_delta;
        totalCI += p.sim_delta_ci;
    });

    const avgDelta = totalDelta / features.length;
    const avgCI = totalCI / features.length;
    document.getElementById('sim-cooling-badge').innerText =
        deltaNdviInput === 0 ? '0.00 °C Shift' : `${avgDelta.toFixed(2)} ± ${avgCI.toFixed(2)} °C`;
    document.getElementById('priority-summary').innerText = `${priorityCount} Indicative Priority LGAs`;

    if (kStableNames.length > 0) {
        document.getElementById('k-stability-note').innerHTML =
            `<strong>KNN Sensitivity (k = 3, 5, 8):</strong> k = 5 (25% of N = 20) is default; <strong>${kStableNames.join(', ')}</strong> remain persistent hotspots across all k &in; {3, 5, 8}.`;
    }

    renderGraduatedLegend(lstMin, lstMax, zMin, zMax, ndviMin, ndviMax);
    renderTable();
    updateMapStylesAndLabels();

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
        style: () => ({
            fillColor: '#cbd5e1',
            weight: 1.4,
            opacity: 1,
            color: '#1e293b',
            fillOpacity: 0.86
        }),
        onEachFeature: (feature, layer) => {
            const p = feature.properties;
            layerIndex[p.ward_name] = layer;

            layer.bindTooltip('', { sticky: true, className: 'clean-tip' });

            layer.on('mouseover', () => {
                if (p.ward_name !== selectedZone) {
                    layer.setStyle({ weight: 2.8, color: '#0f172a', fillOpacity: 0.95 });
                }
            });

            layer.on('mouseout', () => {
                if (p.ward_name !== selectedZone) {
                    const isPri = currentMetric === 'hotspot' && p.is_priority;
                    layer.setStyle({
                        weight: isPri ? 2.2 : 1.4,
                        color: isPri ? '#450a0a' : '#1e293b',
                        fillOpacity: 0.86
                    });
                }
            });

            layer.on('click', () => {
                selectArea(p.ward_name);
            });
        }
    }).addTo(map);

    if (fitInitial) {
        map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
    }
}

function updateMapStylesAndLabels() {
    if (!geojsonLayer || !rawGeoJSON) return;
    labelGroup.clearLayers();
    const showLabels = document.getElementById('toggle-labels').checked;

    geojsonLayer.eachLayer(layer => {
        const p = layer.feature.properties;
        const isSel = p.ward_name === selectedZone;
        const isPri = currentMetric === 'hotspot' && p.is_priority;

        layer.setStyle({
            fillColor: p.fillColor,
            weight: isSel ? 3.6 : (isPri ? 2.2 : 1.4),
            color: isSel ? '#0284c7' : (isPri ? '#450a0a' : '#1e293b'),
            fillOpacity: isSel ? 0.95 : 0.86
        });

        const fdrLabel = p.sim_fdr ? 'FDR q<0.05' : (p.k_stable_hot ? 'k-Stable' : 'Uncorr.');
        layer.setTooltipContent(`
            <strong>${p.ward_name} LGA</strong><br/>
            LST: <b>${Number(p.sim_lst || 0).toFixed(2)} °C</b> &middot; Gi* (LST): <b>${Number(p.sim_giz || 0) >= 0 ? '+' : ''}${Number(p.sim_giz || 0).toFixed(2)}</b> (${fdrLabel})<br/>
            HEI: <b>${Number(p.sim_exp || 0).toFixed(3)}</b> &middot; Pop: <b>${Math.round(p.pop_density || 0).toLocaleString()} people/km²</b><br/>
            <span style="color:#38bdf8">${p.sim_cat}</span>
        `);
    });

    if (!showLabels) return;

    const candidates = [...rawGeoJSON.features].sort((a, b) => {
        if (a.properties.ward_name === selectedZone) return -1;
        if (b.properties.ward_name === selectedZone) return 1;
        return (b.properties._area || 0) - (a.properties._area || 0);
    });

    const placedBoxes = [];
    const minDx = 56;
    const minDy = 26;

    candidates.forEach(f => {
        const p = f.properties;
        const latLng = L.latLng(p._center[1], p._center[0]);
        const pt = map.latLngToContainerPoint(latLng);
        const isSel = p.ward_name === selectedZone;

        const collides = !isSel && placedBoxes.some(b =>
            Math.abs(pt.x - b.x) < minDx && Math.abs(pt.y - b.y) < minDy
        );

        if (!collides) {
            placedBoxes.push(pt);
            let subVal = `${Number(p.sim_lst || 0).toFixed(1)}°C`;
            if (currentMetric === 'hotspot') subVal = `Gi* ${Number(p.sim_giz || 0) >= 0 ? '+' : ''}${Number(p.sim_giz || 0).toFixed(2)}`;
            else if (currentMetric === 'exposure') subVal = `HEI ${Number(p.sim_exp || 0).toFixed(2)}`;
            else if (currentMetric === 'ndvi') subVal = `NDVI ${Number(p.sim_ndvi || 0).toFixed(2)}`;

            const labelMarker = L.marker(latLng, {
                interactive: false,
                icon: L.divIcon({
                    className: 'lga-label-icon',
                    html: `<div class="lga-label-text ${isSel ? 'selected-label' : ''}">${p.ward_name}<span class="lga-subval">${subVal}</span></div>`,
                    iconSize: [0, 0]
                })
            });
            labelGroup.addLayer(labelMarker);
        }
    });
}

map.on('zoomend', () => {
    updateMapStylesAndLabels();
});

function selectArea(wardName) {
    selectedZone = wardName;

    const targetLayer = layerIndex[wardName];
    if (targetLayer) {
        targetLayer.bringToFront();
        map.fitBounds(targetLayer.getBounds(), { padding: [65, 65], maxZoom: 12 });
        showZoneDetails(targetLayer.feature.properties);
    }

    updateMapStylesAndLabels();
    renderTable();
}

function showZoneDetails(p) {
    document.getElementById('zone-title').innerText = `${p.ward_name} LGA`;
    document.getElementById('val-lst').innerText =
        deltaNdviInput === 0 ? `${Number(p.sim_lst || 0).toFixed(2)} °C` : `${Number(p.sim_lst || 0).toFixed(2)} °C (${Number(p.sim_delta || 0).toFixed(2)} °C)`;

    const fdrText = p.sim_fdr ? 'FDR q<0.05' : (Math.abs(Number(p.sim_giz || 0)) >= 1.645 ? 'p<0.10 Uncorr.' : 'Uncorr. (N=20)');
    const kText = p.k_stable_hot ? ' · k-Stable' : '';
    document.getElementById('val-giz').innerText = `${Number(p.sim_giz || 0) >= 0 ? '+' : ''}${Number(p.sim_giz || 0).toFixed(2)} (${fdrText}${kText})`;

    const ndbiVal = p.ndbi !== undefined ? Number(p.ndbi).toFixed(2) : '—';
    document.getElementById('val-ndvi').innerText = `${Number(p.sim_ndvi || 0).toFixed(3)} / NDBI ${ndbiVal}`;
    document.getElementById('val-exp').innerText = `${Number(p.sim_exp || 0).toFixed(3)} (0–1 Scale)`;
    document.getElementById('val-pop').innerText = `${Math.round(Number(p.pop_density || 0)).toLocaleString()} people/km²`;
    document.getElementById('val-elev').innerText = `${Number(p.elevation || 0).toFixed(1)} m`;

    const badge = document.getElementById('zone-badge');
    badge.innerText = p.sim_cat;
    badge.style.backgroundColor = p.fillColor;
    badge.style.color = getContrastTextColor(p.fillColor);
}

function showStateOverview(features) {
    const n = features.length;
    const meanLst = features.reduce((s, f) => s + Number(f.properties.sim_lst || 0), 0) / n;
    const maxGi = Math.max(...features.map(f => Number(f.properties.sim_giz || 0)));
    const meanNdvi = features.reduce((s, f) => s + Number(f.properties.sim_ndvi || 0), 0) / n;
    const meanExp = features.reduce((s, f) => s + Number(f.properties.sim_exp || 0), 0) / n;
    const meanPop = features.reduce((s, f) => s + Number(f.properties.pop_density || 0), 0) / n;
    const meanElev = features.reduce((s, f) => s + Number(f.properties.elevation || 0), 0) / n;

    document.getElementById('zone-title').innerText = 'Lagos State Overview (20 LGAs)';
    document.getElementById('val-lst').innerText = `${meanLst.toFixed(2)} °C (Mean)`;
    document.getElementById('val-giz').innerText = `+${maxGi.toFixed(2)} Peak Gi*`;
    document.getElementById('val-ndvi').innerText = `${meanNdvi.toFixed(3)} Mean NDVI`;
    document.getElementById('val-exp').innerText = `${meanExp.toFixed(3)} Mean HEI`;
    document.getElementById('val-pop').innerText = `${Math.round(meanPop).toLocaleString()} people/km²`;
    document.getElementById('val-elev').innerText = `${meanElev.toFixed(1)} m`;

    const badge = document.getElementById('zone-badge');
    badge.innerText = 'Click Any LGA on Map';
    badge.style.backgroundColor = '#1e293b';
    badge.style.color = '#cbd5e1';
}

function renderTable() {
    const tbody = document.getElementById('zone-tbody');
    const sorted = [...rawGeoJSON.features].sort((a, b) => Number(b.properties.sim_exp || 0) - Number(a.properties.sim_exp || 0));

    tbody.innerHTML = sorted.map(f => {
        const p = f.properties;
        const isSel = p.ward_name === selectedZone ? 'selected' : '';
        const flag = p.sim_fdr ? 'FDR*' : (p.k_stable_hot ? 'k-Stab' : 'ns');
        const gizVal = Number(p.sim_giz || 0);
        return `
            <tr class="${isSel}" data-zone="${p.ward_name}">
                <td><span class="dot-indicator" style="background:${p.fillColor}"></span>${p.ward_name}</td>
                <td>${Number(p.sim_lst || 0).toFixed(1)} °C</td>
                <td>${Number(p.sim_ndvi || 0).toFixed(2)}</td>
                <td>${gizVal >= 0 ? '+' : ''}${gizVal.toFixed(2)} <span class="mono">(${flag})</span></td>
                <td>${Number(p.sim_exp || 0).toFixed(3)}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
            selectArea(tr.getAttribute('data-zone'));
        });
    });
}

function renderGraduatedLegend(lstMin, lstMax, zMin, zMax, ndviMin, ndviMax) {
    const box = document.getElementById('map-legend');
    const gradCSS = stops => `linear-gradient(90deg, ${stops.join(', ')})`;

    if (currentMetric === 'hotspot') {
        const bound = Math.max(Math.abs(zMin), Math.abs(zMax), 0.85);
        box.innerHTML = `
            <span class="legend-title">Gi* Thermal Clustering Spectrum (on LST)</span>
            <div class="spectrum-bar" style="background:${gradCSS(SPECTRUMS.hotspot)}"></div>
            <div class="spectrum-ticks">
                <span>-${bound.toFixed(2)} (Cool)</span>
                <span>0.00</span>
                <span>+${bound.toFixed(2)} (Hotspot)</span>
            </div>
            <div class="legend-note">
                <span class="priority-border-sample"></span>
                <span>Dark border = Indicative Priority Cooling Zone</span>
            </div>
        `;
    } else if (currentMetric === 'lst') {
        const midLst = ((lstMin + lstMax) / 2).toFixed(1);
        box.innerHTML = `
            <span class="legend-title">Mean Land Surface Temp (LST °C)</span>
            <div class="spectrum-bar" style="background:${gradCSS(SPECTRUMS.lst)}"></div>
            <div class="spectrum-ticks">
                <span>${lstMin.toFixed(1)} °C</span>
                <span>${midLst} °C</span>
                <span>${lstMax.toFixed(1)} °C</span>
            </div>
        `;
    } else if (currentMetric === 'exposure') {
        box.innerHTML = `
            <span class="legend-title">Heat Exposure Index (HEI · 0 to 1)</span>
            <div class="spectrum-bar" style="background:${gradCSS(SPECTRUMS.exposure)}"></div>
            <div class="spectrum-ticks">
                <span>0.00 (Low)</span>
                <span>0.42 (Mod)</span>
                <span>0.85+ (High)</span>
            </div>
        `;
    } else {
        const midNdvi = ((ndviMin + ndviMax) / 2).toFixed(2);
        box.innerHTML = `
            <span class="legend-title">Sentinel-2 Vegetation Density (NDVI)</span>
            <div class="spectrum-bar" style="background:${gradCSS(SPECTRUMS.ndvi)}"></div>
            <div class="spectrum-ticks">
                <span>${ndviMin.toFixed(2)} (Sparse)</span>
                <span>${midNdvi}</span>
                <span>${ndviMax.toFixed(2)} (Dense)</span>
            </div>
        `;
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

document.getElementById('toggle-labels').addEventListener('change', () => {
    updateMapStylesAndLabels();
});

document.getElementById('ndvi-slider').addEventListener('input', e => {
    deltaNdviInput = Number(e.target.value);
    document.getElementById('slider-label').innerText = `+${deltaNdviInput.toFixed(3)} NDVI`;
    updateModel();
});

document.getElementById('reset-view').addEventListener('click', () => {
    selectedZone = null;
    deltaNdviInput = 0;
    document.getElementById('ndvi-slider').value = 0;
    document.getElementById('slider-label').innerText = '+0.000 NDVI';
    if (geojsonLayer) {
        map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
    }
    updateModel();
});
