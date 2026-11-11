/* Interactive LGA map for the study page. Reads data/lagos_uhi_processed.geojson (LGA outlines) and
   data/extra_analysis.json (per-LGA values from scripts/extra_analysis.py). No numbers are typed here. */
(() => {
    'use strict';
    const box = document.getElementById('explore-map');
    if (!box) return;
    const NS = 'http://www.w3.org/2000/svg';
    const pct = v => `${Math.round(v * 100)}%`;
    const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const STOPS = [[250, 226, 196], [246, 165, 95], [217, 80, 11], [107, 36, 6]];
    const ramp = t => {
        const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(x)), f = x - i;
        return `rgb(${STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f)).join(',')})`;
    };
    const el = (tag, attrs = {}, text) => {
        const e = document.createElementNS(NS, tag);
        Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
        if (text != null) e.textContent = text;
        return e;
    };

    Promise.all([fetch('data/lagos_uhi_processed.geojson').then(r => r.json()), fetch('data/extra_analysis.json').then(r => r.json())])
        .then(([geo, extra]) => {
            const vals = extra.lga;
            // labels come from the data file, so the thresholds are never typed here
            const METRICS = [
                { key: 'pop_weighted_mean_suhi_c', label: 'Mean heat', unit: '°C above the countryside', fmt: v => `${v.toFixed(1)} °C` },
                { key: 'population_in_hot_cells_share', label: 'Residents on hot cells', unit: `share of residents on cells at least ${extra.hot_threshold_c} °C warmer`, fmt: pct },
                { key: 'population_beyond_300m_share', label: `Beyond ${extra.access_m} m from vegetation`, unit: 'share of residents', fmt: pct },
                { key: 'population_low_ground_share', label: 'On low ground', unit: `share of residents on cells below ${extra.low_ground_m} m`, fmt: pct },
                { key: 'population', label: 'Population', unit: 'WorldPop 2020, a modelled estimate', fmt: v => `${(v / 1e6).toFixed(2)} million` },
            ];
            const rings = f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flat();
            const all = geo.features.flatMap(rings).flat();
            const lat0 = all.reduce((s, p) => s + p[1], 0) / all.length, k = Math.cos(lat0 * Math.PI / 180);
            const xs = all.map(p => p[0] * k), ys = all.map(p => -p[1]);
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
            const W = 900, s = W / (x1 - x0), H = Math.round((y1 - y0) * s);
            const path = f => rings(f).map(r => 'M' + r.map(p => `${((p[0] * k - x0) * s).toFixed(1)},${((-p[1] - y0) * s).toFixed(1)}`).join('L') + 'Z').join('');

            const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Map of the local government areas. Select an area for its values.' });
            const outline = el('path', { class: 'xp-sel', 'aria-hidden': 'true' });   // drawn last, so a selected area is never covered by its neighbours
            const paths = geo.features.map(f => {
                const name = f.properties.lga_name;
                const p = el('path', { d: path(f), class: 'xp-u', tabindex: '0', role: 'button' });
                p.dataset.name = name;
                svg.append(p);
                return p;
            });
            svg.append(outline);
            box.append(svg);

            const readout = document.getElementById('xp-readout');
            const legendBar = document.getElementById('xp-legend-bar');
            const lo = document.getElementById('xp-min'), hi = document.getElementById('xp-max'), unit = document.getElementById('xp-unit');
            const tableBox = document.getElementById('xp-table');
            const picker = document.getElementById('xp-select');
            picker.append(new Option('Choose an area', ''));
            Object.keys(vals).sort().forEach(n => picker.append(new Option(n, n)));
            picker.addEventListener('change', () => select(picker.value || null));
            let metric = METRICS[0], selected = null;

            const value = (name, m = metric) => (vals[name] && vals[name][m.key] != null ? vals[name][m.key] : null);
            const detail = name => {
                const v = vals[name];
                if (!v) return `<b>${esc(name)}</b>: no values (too few cells with a heat value).`;
                const fmt = m => (v[m.key] == null ? 'n/a' : m.fmt(v[m.key]));
                const others = METRICS.filter(m => m.key !== metric.key).map(m => `${esc(m.label)}: ${fmt(m)}`).join(' · ');
                return `<b>${esc(name)}</b>: <span class="xp-main">${esc(metric.label)} ${fmt(metric)}</span><br>${others}`;
            };
            const select = name => {
                selected = name;
                paths.forEach(p => p.classList.toggle('on', p.dataset.name === name));
                const sel = paths.find(p => p.dataset.name === name);
                outline.setAttribute('d', sel ? sel.getAttribute('d') : '');
                picker.value = name || '';
                readout.innerHTML = name ? detail(name) : 'Select an area on the map, on the list above it, or use Tab and Enter.';
            };
            const paint = () => {
                const nums = Object.keys(vals).map(n => value(n)).filter(v => v != null);
                const min = Math.min(...nums), max = Math.max(...nums);
                paths.forEach(p => {
                    const v = value(p.dataset.name);
                    p.style.fill = v == null ? '#e6e4de' : ramp((v - min) / (max - min || 1));
                    p.setAttribute('aria-label', `${p.dataset.name}: ${v == null ? 'no value' : metric.fmt(v)}`);
                });
                lo.textContent = metric.fmt(min); hi.textContent = metric.fmt(max); unit.textContent = `${metric.unit.charAt(0).toUpperCase()}${metric.unit.slice(1)}. The colour scale is set separately for each measure.`;
                legendBar.style.background = `linear-gradient(90deg, ${[0, 0.33, 0.66, 1].map(ramp).join(',')})`;
                const rows = Object.keys(vals).sort((a, b) => (value(b) ?? -Infinity) - (value(a) ?? -Infinity));
                tableBox.innerHTML = `<table><thead><tr><th scope="col">LGA</th>${METRICS.map(m => `<th scope="col">${esc(m.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(n => `<tr><th scope="row">${esc(n)}</th>${METRICS.map(m => `<td>${vals[n][m.key] == null ? 'n/a' : m.fmt(vals[n][m.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
            };
            const choose = m => {
                metric = m;
                document.querySelectorAll('.xp-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.key === m.key)));
                paint();
                select(selected);
            };

            const bar = document.getElementById('xp-buttons');
            METRICS.forEach(m => {
                const b = document.createElement('button');
                b.type = 'button'; b.className = 'xp-btn'; b.dataset.key = m.key; b.textContent = m.label; b.setAttribute('aria-pressed', 'false');
                b.addEventListener('click', () => choose(m));
                bar.append(b);
            });
            paths.forEach(p => {
                p.addEventListener('click', () => select(p.dataset.name));
                p.addEventListener('focus', () => select(p.dataset.name));
                p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p.dataset.name); } });
                p.addEventListener('mouseenter', () => { readout.innerHTML = detail(p.dataset.name); });
                p.addEventListener('mouseleave', () => select(selected));
            });
            choose(METRICS[0]);
        })
        .catch(() => { box.textContent = 'The map data did not load.'; });
})();
