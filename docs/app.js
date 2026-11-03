/**
 * Lagos Urban Heat & Population Exposure Analytics Engine
 * Full Production Architecture - Zero-Crash Safe Mode
 * Author: David Oloyede
 */

const APP_STATE = {
    geojson: null,
    features: [],
    layer: 'hotspot',
    k: 5,
    selectedArea: null,
    compareArea: '',
    deltaNdvi: 0.0,
    empiricalSlope: -12.40,
    slopeCI: 3.42
};

// Perceptually Uniform Color Scales
const COLOR_RAMPS = {
    lst: ['#FFFFB2', '#FECC5C', '#FD8D3C', '#F03B20', '#BD0026'],
    hotspot: ['#2166AC', '#92C5DE', '#F7F7F7', '#F4A582', '#B2182B'],
    exposure: ['#FFF7EC', '#FDD49E', '#FC8D59', '#D7301F', '#7F0000'],
    ndvi: ['#FFFFCC', '#C2E699', '#78C679', '#31A354', '#006837']
};

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

function interpolateRamp(val, min, max, ramp) {
    const t = Math.max(0, Math.min(1, (val - min) / ((max - min) || 1e-6)));
    const scaled = t * (ramp.length - 1);
    const i = Math.min(ramp.length - 2, Math.floor(scaled));
    const f = scaled - i;
    
    const [r1, g1, b1] = hexToRgb(ramp[i]);
    const [r2, g2, b2] = hexToRgb(ramp[i + 1]);
    
    const r = Math.round(r1 + (r2 - r1) * f);
    const g = Math.round(g1 + (g2 - g1) * f);
    const b = Math.round(b1 + (b2 - b1) * f);
    return rgbToHex(r, g, b);
}

// Initialize Leaflet Map
const map = L.map('map', {
    zoomControl: false,
    preferCanvas: true
}).setView([6.5244, 3.3792], 10);

L.control.zoom({ position: 'bottomright' }).addTo(map);

const BASEMAPS = {
    light: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri, HERE, Garmin, USGS',
        maxZoom: 16
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri, Maxar, Earthstar Geographics',
        maxZoom: 18
    }),
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18
    })
};

let activeBasemap = BASEMAPS.light.addTo(map);
let vectorLayer = null;
let labelGroup = L.layerGroup().addTo(map);
let layerIndex = {};

// Coordinate & Centroid Extractors
function extractFlatCoords(coords, out = []) {
    if (!Array.isArray(coords)) return out;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        out.push(coords);
    } else {
        coords.forEach(c => extractFlatCoords(c, out));
    }
    return out;
}

function getPolygonCentroidAndArea(feature) {
    const pts = extractFlatCoords(feature?.geometry?.coordinates || []);
    if (!pts.length) return { center: [3.3792, 6.5244], area: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(([x, y]) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    });
    return { center: [(minX + maxX) / 2, (minY + maxY) / 2], area: (maxX - minX) * (maxY - minY) };
}

// Live Gi* Calculator
function computeGiStar(features, k) {
    const n = features.length;
    const vals = features.map(f => Number(f.properties.mean_lst || 34));
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

// Data Ingestion with Fallbacks
async function loadPipelineData() {
    const banner = document.getElementById('status-banner');
    const paths = [
        'data/lagos_uhi_processed.geojson',
        './data/lagos_uhi_processed.geojson',
        'https://oloyededavid.github.io/Lagos-Urban-Heat-Analytics/data/lagos_uhi_processed.geojson',
        'https://raw.githubusercontent.com/oloyededavid/Lagos-Urban-Heat-Analytics/main/docs/data/lagos_uhi_processed.geojson'
    ];

    for (const path of paths) {
        try {
            const res = await fetch(path);
            if (res.ok) {
                const json = await res.json();
                if (json && Array.isArray(json.features) && json.features.length > 0) {
                    if (banner) banner.classList.add('is-hidden');
                    return json;
                }
            }
        } catch (e) {
            // Try next path
        }
    }
    if (banner) banner.innerText = 'Error: Could not locate lagos_uhi_processed.geojson';
    throw new Error('Failed to load spatial GeoJSON data.');
}

loadPipelineData().then(data => {
    APP_STATE.geojson = data;
    APP_STATE.features = data.features;

    APP_STATE.features.forEach((f, i) => {
        const p = f.properties;
        p.area_name = String(p.ward_name || p.NAME_2 || p.ADM2_NAME || p.NAME || `Area ${i + 1}`);
        const geom = getPolygonCentroidAndArea(f);
        p._center = geom.center;
        p._area = geom.area;
    });

    // Populate Datalist & Selectors
    const names = APP_STATE.features.map(f => f.properties.area_name).sort();
    const datalist = document.getElementById('lga-datalist');
    if (datalist) {
        datalist.innerHTML = names.map(n => `<option value="${n}"></option>`).join('');
    }

    const compareSelect = document.getElementById('compare-select');
    if (compareSelect) {
        compareSelect.innerHTML = `<option value="">None (Single Area View)</option>` +
            names.map(n => `<option value="${n}">${n}</option>`).join('');
    }

    // Compute Empirical OLS Slope if NDVI/LST are present
    const valid = APP_STATE.features.filter(f => f.properties.ndvi != null && f.properties.mean_lst != null);
    if (valid.length > 3) {
        const xs = valid.map(f => Number(f.properties.ndvi));
        const ys = valid.map(f => Number(f.properties.mean_lst));
        const mx = xs.reduce((a, b) => a + b, 0) / valid.length;
        const my = ys.reduce((a, b) => a + b, 0) / valid.length;
        const sxx = xs.reduce((s, x) => s + Math.pow(x - mx, 2), 0);
        const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
        if (sxx > 0) {
            APP_STATE.empiricalSlope = sxy / sxx;
        }
    }

    buildMapVectorLayer(true);
    recomputeModelMetrics();
    initEventListeners();
}).catch(err => console.error(err));

function recomputeModelMetrics() {
    if (!APP_STATE.features.length) return;
    const features = APP_STATE.features;
    const n = features.length;

    // Apply Scenario Shift
    features.forEach(f => {
        const p = f.properties;
        const baseNdvi = Number(p.ndvi ?? 0.25);
        const ndbi = Number(p.ndbi ?? 0.05);
        const plantable = Math.max(0.30, Math.min(1.0, 1.0 - Math.max(0, ndbi) * 1.5));
        const simNdvi = Math.min(0.45, Math.max(baseNdvi, baseNdvi + APP_STATE.deltaNdvi * plantable));
        const dNdvi = simNdvi - baseNdvi;
        p.sim_ndvi = simNdvi;
        p.sim_delta_lst = dNdvi * APP_STATE.empiricalSlope;
        p.sim_delta_ci = dNdvi * APP_STATE.slopeCI;
        p.sim_lst = Number(p.mean_lst ?? 34) + p.sim_delta_lst;
    });

    const activeGi = computeGiStar(features, APP_STATE.k);
    const lstVals = features.map(f => f.properties.sim_lst);
    const lstMin = Math.min(...lstVals), lstMax = Math.max(...lstVals);

    const logPops = features.map(f => Math.log1p(Number(f.properties.pop_density || 0)));
    const pMin = Math.min(...logPops), pMax = Math.max(...logPops);

    features.forEach((f, i) => {
        const p = f.properties;
        const precomputedKey = `gi_zscore_k${APP_STATE.k}`;
        p.sim_giz = (APP_STATE.deltaNdvi === 0 && p[precomputedKey] != null) ? Number(p[precomputedKey]) : activeGi[i];
        
        const lstNorm = (p.sim_lst - lstMin) / ((lstMax - lstMin) || 1);
        const popNorm = (logPops[i] - pMin) / ((pMax - pMin) || 1);
        p.hei_minmax = lstNorm * popNorm;
    });

    const topHotspots = [...features].sort((a, b) => b.properties.sim_lst - a.properties.sim_lst)
        .slice(0, 3).map(f => `${f.properties.area_name} (${f.properties.sim_lst.toFixed(1)}°C)`).join(', ');
    
    const findingEl = document.getElementById('finding-hotspots');
    if (findingEl) findingEl.innerText = topHotspots;

    updateMapVisuals();
    renderRankingTable();
    if (APP_STATE.selectedArea) updateDetailDrawer(APP_STATE.selectedArea);
}

function buildMapVectorLayer(fitInitial = false) {
    if (vectorLayer) map.removeLayer(vectorLayer);
    layerIndex = {};

    vectorLayer = L.geoJSON(APP_STATE.geojson, {
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

            layer.on({
                mouseover: () => {
                    if (p.area_name !== APP_STATE.selectedArea) {
                        layer.setStyle({ weight: 2.5, color: '#111827' });
                    }
                },
                mouseout: () => {
                    if (p.area_name !== APP_STATE.selectedArea) {
                        layer.setStyle({ weight: 1.2, color: '#475569' });
                    }
                },
                click: () => {
                    selectArea(p.area_name);
                }
            });
        }
    }).addTo(map);

    if (fitInitial) {
        map.fitBounds(vectorLayer.getBounds(), { padding: [30, 30] });
    }
}

function updateMapVisuals() {
    if (!vectorLayer) return;
    labelGroup.clearLayers();

    const features = APP_STATE.features;
    const vals = features.map(f => {
        const p = f.properties;
        if (APP_STATE.layer === 'lst') return p.sim_lst;
        if (APP_STATE.layer === 'hotspot') return p.sim_giz;
        if (APP_STATE.layer === 'exposure') return p.hei_minmax;
        return p.sim_ndvi;
    });
    const vMin = Math.min(...vals), vMax = Math.max(...vals);

    vectorLayer.eachLayer(layer => {
        const p = layer.feature.properties;
        const val = APP_STATE.layer === 'lst' ? p.sim_lst
                  : APP_STATE.layer === 'hotspot' ? p.sim_giz
                  : APP_STATE.layer === 'exposure' ? p.hei_minmax
                  : p.sim_ndvi;

        p._fillColor = interpolateRamp(val, vMin, vMax, COLOR_RAMPS[APP_STATE.layer] || COLOR_RAMPS.lst);
        const isSel = (p.area_name === APP_STATE.selectedArea);

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

function updateLegendUI(min, max) {
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('legend-min', min.toFixed(1));
    setTxt('legend-mid', ((min + max) / 2).toFixed(1));
    setTxt('legend-max', max.toFixed(1));

    const bar = document.getElementById('legend-bar');
    if (bar) {
        const ramp = COLOR_RAMPS[APP_STATE.layer] || COLOR_RAMPS.lst;
        bar.style.background = `linear-gradient(90deg, ${ramp.join(', ')})`;
    }
}

function selectArea(areaName) {
    const feat = APP_STATE.features.find(f => f.properties.area_name.toLowerCase() === String(areaName).toLowerCase());
    if (!feat) return;

    APP_STATE.selectedArea = feat.properties.area_name;
    const drawer = document.getElementById('detail-drawer');
    if (drawer) drawer.classList.remove('is-closed');

    const layer = layerIndex[APP_STATE.selectedArea];
    if (layer) {
        layer.bringToFront();
        map.fitBounds(layer.getBounds(), { padding: [70, 70], maxZoom: 12 });
    }

    updateMapVisuals();
    updateDetailDrawer(APP_STATE.selectedArea);
}

function updateDetailDrawer(areaName) {
    const feat = APP_STATE.features.find(f => f.properties.area_name === areaName);
    if (!feat) return;
    const p = feat.properties;

    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('drawer-title', p.area_name);
    setTxt('m-lst', `${p.sim_lst.toFixed(1)} °C`);
    setTxt('m-giz', `${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}`);
    setTxt('m-hei', p.hei_minmax.toFixed(2));
    setTxt('m-ndvi', p.sim_ndvi.toFixed(2));
    setTxt('scenario-output', `${p.sim_delta_lst.toFixed(2)} °C (±${p.sim_delta_ci.toFixed(2)})`);
}

function renderRankingTable() {
    const tbody = document.getElementById('comp-tbody') || document.getElementById('zone-tbody');
    if (!tbody || !APP_STATE.features.length) return;
    
    const sorted = [...APP_STATE.features].sort((a, b) => b.properties.hei_minmax - a.properties.hei_minmax);
    tbody.innerHTML = sorted.map(f => {
        const p = f.properties;
        const isSel = p.area_name === APP_STATE.selectedArea ? 'selected' : '';
        return `
            <tr class="${isSel}" data-area="${p.area_name}">
                <td><strong>${p.area_name}</strong></td>
                <td>${p.sim_lst.toFixed(1)} °C</td>
                <td>${p.sim_giz >= 0 ? '+' : ''}${p.sim_giz.toFixed(2)}</td>
                <td>${p.hei_minmax.toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => selectArea(tr.getAttribute('data-area')));
    });
}

function initEventListeners() {
    const layerSel = document.getElementById('layer-select') || document.getElementById('metric-select');
    if (layerSel) {
        layerSel.addEventListener('change', e => {
            APP_STATE.layer = e.target.value;
            updateMapVisuals();
        });
    }

    const baseSel = document.getElementById('basemap-select');
    if (baseSel) {
        baseSel.addEventListener('change', e => {
            const next = BASEMAPS[e.target.value];
            if (next && next !== activeBasemap) {
                map.removeLayer(activeBasemap);
                activeBasemap = next.addTo(map);
                if (vectorLayer) vectorLayer.bringToFront();
            }
        });
    }

    const slider = document.getElementById('ndvi-slider');
    if (slider) {
        slider.addEventListener('input', e => {
            APP_STATE.deltaNdvi = Number(e.target.value);
            const readout = document.getElementById('ndvi-slider-val') || document.getElementById('slider-readout');
            if (readout) readout.innerText = `+${APP_STATE.deltaNdvi.toFixed(3)}`;
            recomputeModelMetrics();
        });
    }

    const searchInput = document.getElementById('area-search');
    if (searchInput) {
        searchInput.addEventListener('change', e => {
            if (e.target.value) {
                selectArea(e.target.value);
                e.target.value = '';
            }
        });
    }

    const closeDrawerBtn = document.getElementById('btn-close-drawer');
    if (closeDrawerBtn) {
        closeDrawerBtn.addEventListener('click', () => {
            APP_STATE.selectedArea = null;
            const drawer = document.getElementById('detail-drawer');
            if (drawer) drawer.classList.add('is-closed');
            updateMapVisuals();
        });
    }
}
