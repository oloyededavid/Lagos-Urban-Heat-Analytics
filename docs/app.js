Chart.defaults.font.family = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";
Chart.defaults.color = '#64748b';

const map = L.map('map', { zoomControl: false }).setView([6.5244, 3.3792], 10);
L.control.zoom({ position: 'topleft' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 18
}).addTo(map);

function getColor(category) {
    switch (category) {
        case 'Priority Cooling Zone': return '#dc2626';
        case 'Significant Heat Hotspot': return '#f97316';
        case 'Thermal Refugium': return '#0284c7';
        default: return '#cbd5e1';
    }
}

function classifyByK(props, k, popThreshold) {
    const z = props[`gi_zscore_k${k}`] ?? props.gi_zscore;
    const sig = Boolean(props[`fdr_sig_k${k}`] ?? props.fdr_significant);
    const dense = (props.pop_density || 0) >= popThreshold;
    if (sig && z > 0 && dense) return 'Priority Cooling Zone';
    if (sig && z > 0) return 'Significant Heat Hotspot';
    if (sig && z < 0) return 'Thermal Refugium';
    return 'Not Significant';
}

let geojsonLayer = null;
let rawData = null;
let popQuartile75 = 0;
let selectedLayer = null;

fetch('data/lagos_uhi_processed.geojson')
    .then(res => res.json())
    .then(data => {
        rawData = data;
        const densities = data.features.map(f => f.properties.pop_density || 0).sort((a, b) => a - b);
        popQuartile75 = densities[Math.floor(densities.length * 0.75)] || 0;

        renderMap('5', true);
        renderScatterChart(data.features);
    })
    .catch(err => console.error('Error loading GeoJSON:', err));

function renderMap(kVal, fitInitialBounds = false) {
    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
    }
    selectedLayer = null;

    geojsonLayer = L.geoJson(rawData, {
        style: function (feature) {
            const cat = classifyByK(feature.properties, kVal, popQuartile75);
            return {
                fillColor: getColor(cat),
                weight: 1.2,
                opacity: 1,
                color: '#ffffff',
                fillOpacity: 0.78
            };
        },
        onEachFeature: function (feature, layer) {
            layer.on('click', function () {
                if (selectedLayer && geojsonLayer) {
                    geojsonLayer.resetStyle(selectedLayer);
                }
                selectedLayer = layer;
                layer.setStyle({ weight: 2.2, color: '#0f172a', fillOpacity: 0.92 });
                layer.bringToFront();

                document.getElementById('instruction').classList.add('hidden');
                document.getElementById('ward-details').classList.remove('hidden');

                const p = feature.properties;
                const cat = classifyByK(p, kVal, popQuartile75);
                const zVal = p[`gi_zscore_k${kVal}`] ?? p.gi_zscore;
                const sigVal = Boolean(p[`fdr_sig_k${kVal}`] ?? p.fdr_significant);

                document.getElementById('ward-name').innerText = p.ward_name || 'Administrative Zone';
                document.getElementById('val-raw-lst').innerText = p.mean_lst !== undefined ? Number(p.mean_lst).toFixed(2) : '—';
                document.getElementById('val-lst').innerText = p.lst_zscore !== undefined ? Number(p.lst_zscore).toFixed(2) : '—';
                document.getElementById('val-ndvi').innerText = p.ndvi !== undefined ? Number(p.ndvi).toFixed(3) : '—';
                document.getElementById('val-elev').innerText = p.elevation !== undefined ? Number(p.elevation).toFixed(1) : '—';
                document.getElementById('val-pop').innerText = p.pop_density !== undefined ? Math.round(p.pop_density).toLocaleString() : '—';
                document.getElementById('val-exp').innerText = p.heat_exposure_index !== undefined ? Number(p.heat_exposure_index).toFixed(3) : '—';
                document.getElementById('val-giz').innerText = zVal !== undefined ? Number(zVal).toFixed(2) : '—';
                document.getElementById('val-fdr').innerText = sigVal ? 'Significant' : 'Not Sig.';

                const badge = document.getElementById('val-class');
                badge.innerText = cat;
                badge.style.backgroundColor = getColor(cat);
                badge.style.color = cat === 'Not Significant' ? '#0f172a' : '#ffffff';
            });
        }
    }).addTo(map);

    if (fitInitialBounds) {
        map.fitBounds(geojsonLayer.getBounds(), { padding: [24, 24] });
    }
}

document.getElementById('k-select').addEventListener('change', e => renderMap(e.target.value, false));

const legend = L.control({ position: 'bottomleft' });
legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'legend');
    const categories = [
        'Priority Cooling Zone',
        'Significant Heat Hotspot',
        'Thermal Refugium',
        'Not Significant'
    ];
    div.innerHTML = '<span class="legend-title">Classification</span>';
    categories.forEach(c => {
        div.innerHTML += `<div class="legend-item"><i style="background:${getColor(c)}"></i><span>${c}</span></div>`;
    });
    return div;
};
legend.addTo(map);

function renderScatterChart(features) {
    const points = features
        .filter(f => f.properties.ndvi !== undefined && f.properties.mean_lst !== undefined)
        .map(f => ({ x: f.properties.ndvi, y: f.properties.mean_lst }));

    const ctx = document.getElementById('uhiChart').getContext('2d');
    new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                data: points,
                backgroundColor: 'rgba(220, 38, 38, 0.7)',
                borderColor: '#dc2626',
                borderWidth: 1,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { color: '#f1f5f9' },
                    title: { display: true, text: 'Sentinel-2 NDVI', font: { size: 11, weight: '500' } }
                },
                y: {
                    grid: { color: '#f1f5f9' },
                    title: { display: true, text: 'Mean LST (°C)', font: { size: 11, weight: '500' } }
                }
            }
        }
    });
}
