/* Study page for the Lagos heat-island analysis.
   Every number on the page is read from docs/data/change_summary.json (scripts/analyze_change.py)
   and docs/data/summary.json (scripts/analyze_uhi.py); the HTML holds only placeholders. */
(() => {
    'use strict';
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const NS = 'http://www.w3.org/2000/svg';
    let C, S, GEO;

    // ---------- number formatting ----------
    const minus = s => s.replace(/^-/, '−');
    const f = (x, d = 1) => minus(Number(x).toFixed(d));
    const sf = (x, d = 1) => (x > 0 ? '+' : '') + f(x, d);
    const pct = x => String(Math.round(x * 100));
    const range = (a, d = 1, signed = true) => `${(signed ? sf : f)(a[0], d)} to ${(signed ? sf : f)(a[1], d)}`;
    const pval = p => p < 0.001 ? '< 0.001' : p < 0.01 ? f(p, 3) : f(p, 2);
    const list = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    function values() {
        const P = C.periods.map(p => p.label), [p1, p2, p3] = P;
        const st = C.state, sc = C.state_change, u = C.urbanisation, m = C.method, L = C.lgas;
        const kf = id => C.key_findings.find(k => k.id === id).stats;
        const lg = kf('lgas'), hot = C.periods.map(p => p.share_above_3c), hot6 = C.periods.map(p => p.share_above_6c);
        const trendNames = Object.keys(L).filter(n => L[n].trend && L[n].trend.fdr_significant && L[n].trend.slope_per_decade > 0);
        const core = ['Surulere', 'Mushin', 'Agege'].map(n => L[n].periods[p1].median);
        const few = Object.keys(L).filter(n => L[n].change && L[n].change.verdict === 'Too few clear days');
        const s = S, lst = s.lst;
        return {
            nLga: String(Object.keys(L).length),
            nCommon: String(sc.lgas),
            dState: sf(sc.delta), dStateCi: range(sc.ci95),
            s1: sf(st[p1].weighted_suhi), s2: sf(st[p2].weighted_suhi), s3: sf(st[p3].weighted_suhi),
            a1: sf(st[p1].all_observed.weighted_suhi), a2: sf(st[p2].all_observed.weighted_suhi), a3: sf(st[p3].all_observed.weighted_suhi),
            pass1: String(st[p1].passes),
            hot1: pct(hot[0]), hot2: pct(hot[1]), hot3: pct(hot[2]), hot6a: pct(hot6[0]), hot6c: pct(hot6[2]),
            hotThr: String(kf('hot_area').threshold_c),
            urbSlope: sf(u.slope_c_per_10pp), urbCi: range(u.ci95), urbR2: f(u.r2, 2), urbP: pval(u.p_value),
            urbRho: f(u.spearman_rho, 2), urbRhoP: pval(u.spearman_p), urbN: String(u.n),
            urbDrop: list(u.without_most_built.dropped), urbDropN: String(u.without_most_built.n),
            urbDropSlope: sf(u.without_most_built.slope_c_per_10pp), urbDropCi: range(u.without_most_built.ci95),
            ghsl0: String(u.ghsl_years[0]), ghsl1: String(u.ghsl_years[1]),
            scUsed: String(C.scenes.used), scAll: String(C.scenes.considered),
            refKm: String(m.reference_buffer_m / 1000), refPix: m.ref_min_pixels.toLocaleString('en-GB'),
            coldShare: pct(m.max_cold_share), coldThr: String(m.cold_threshold_c),
            minN: 'three', nTrend: String(Object.values(L).filter(l => l.trend).length),
            top4: list(lg.top5.slice(0, 4)), nTestable: String(lg.n_testable), nWarmed: String(lg.n_warmed),
            trendName: list(trendNames), trendSlope: trendNames.length ? sf(L[trendNames[0]].trend.slope_per_decade) : '',
            coreRange: `${sf(Math.min(...core))} to ${sf(Math.max(...core))}`,
            fewList: list(few),
            nLandsat: String(s.provenance.landsat_scenes),
            lstMean: f(lst.mean), lstMin: f(lst.min), lstMax: f(lst.max), coolest: lst.coolest, hottest: lst.hottest,
        };
    }
    function fill() { const v = values(); $$('[data-v]').forEach(el => { if (el.dataset.v in v) el.textContent = v[el.dataset.v]; }); }

    // ---------- colour scale of the heat-island maps (stops come from the export) ----------
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    function colour(v) {
        const st = C.map.stops;
        if (v <= st[0][0]) return st[0][1];
        if (v >= st[st.length - 1][0]) return st[st.length - 1][1];
        for (let i = 1; i < st.length; i++) if (v <= st[i][0]) {
            const t = (v - st[i - 1][0]) / (st[i][0] - st[i - 1][0]), a = hex(st[i - 1][1]), b = hex(st[i][1]);
            return `rgb(${a.map((x, k) => Math.round(x + t * (b[k] - x))).join(',')})`;
        }
    }
    function rampLegend(el) {
        const st = C.map.stops, lo = st[0][0], hi = st[st.length - 1][0];
        const grad = st.map(([v, c]) => `${c} ${((v - lo) / (hi - lo) * 100).toFixed(1)}%`).join(', ');
        el.innerHTML = `<div>Heat island, °C above the countryside</div><div class="ramp" style="background:linear-gradient(to right, ${grad})"></div>
            <div class="ticks">${st.filter((_, i) => i % 2 === 0).map(([v]) => `<span>${sf(v, 0)}</span>`).join('')}</div>`;
    }

    // ---------- Figure 1: LGA map ----------
    let period, selected = null;
    function drawMap() {
        const svg = $('#lga-map'), feats = GEO.features;
        let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
        const each = fn => feats.forEach(ft => ft.geometry.coordinates.forEach(ring => ring.forEach(fn)));
        each(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
        const k = Math.cos((y0 + y1) / 2 * Math.PI / 180), W = 800, pad = 6;
        const sc = (W - 2 * pad) / ((x1 - x0) * k), H = Math.round((y1 - y0) * sc + 2 * pad);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        const px = ([x, y]) => `${(pad + (x - x0) * k * sc).toFixed(1)},${(pad + (y1 - y) * sc).toFixed(1)}`;
        svg.innerHTML = '';
        feats.forEach(ft => {
            const name = ft.properties.lga_name, p = document.createElementNS(NS, 'path');
            p.setAttribute('d', ft.geometry.coordinates.map(r => `M${r.map(px).join('L')}Z`).join(''));
            p.dataset.lga = name; p.setAttribute('tabindex', '0'); p.setAttribute('role', 'button');
            p.addEventListener('click', () => select(name));
            p.addEventListener('mouseenter', () => { if (!selected) info(name); });
            p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(name); } });
            svg.append(p);
        });
        paint();
    }
    function paint() {
        $$('#lga-map path').forEach(p => {
            const v = C.lgas[p.dataset.lga].periods[period];
            p.style.fill = v.median == null ? '#e2e2e2' : colour(v.median);
            p.setAttribute('aria-label', `${p.dataset.lga}: ${v.median == null ? 'no clear pass' : `${sf(v.median)} °C`}`);
            p.classList.toggle('is-on', p.dataset.lga === selected);
        });
        info(selected || C.key_findings.find(k => k.id === 'lgas').stats.top5[0]);
    }
    function select(name) { selected = selected === name ? null : name; paint(); }
    function info(name) {
        const l = C.lgas[name], v = l.periods[period], ch = l.change;
        const ci = v.ci95[0] == null ? 'too few passes' : `${range(v.ci95)} °C`;
        $('#lga-info').innerHTML = `<p class="kick">${esc(period)}</p><h3>${esc(name)}</h3>
            <dl><dt>Heat island</dt><dd>${v.median == null ? 'no clear pass' : `${sf(v.median)} °C`}</dd>
            <dt>95% interval</dt><dd>${v.median == null ? '–' : ci}</dd>
            <dt>Usable passes</dt><dd>${v.n}</dd>
            <dt>Change, first to last period</dt><dd>${ch ? `${sf(ch.delta)} °C, ${ch.verdict.toLowerCase()}` : '–'}</dd>
            <dt>Land area</dt><dd>${f(l.land_km2, 0)} km²</dd></dl>
            <p class="hint">${selected ? 'Select it again to clear.' : 'Hover or select an LGA.'}</p><div class="ramp-legend" id="map-legend"></div>`;
        rampLegend($('#map-legend'));
        $('#map-legend').insertAdjacentHTML('beforeend', '<span class="nodata"><i></i>No clear pass</span>');
    }
    function initPeriods() {
        const seg = $('#period-seg'), P = C.periods.map(p => p.label);
        period = P[P.length - 1];
        seg.innerHTML = P.map(p => `<button type="button" data-p="${p}" aria-pressed="${p === period}">${p}</button>`).join('');
        seg.addEventListener('click', e => {
            const b = e.target.closest('button'); if (!b) return;
            period = b.dataset.p; $$('button', seg).forEach(x => x.setAttribute('aria-pressed', String(x === b))); paint();
        });
    }

    // ---------- small SVG helpers ----------
    function el(tag, attrs = {}, text) {
        const e = document.createElementNS(NS, tag);
        Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
        if (text != null) e.textContent = text;
        return e;
    }
    const ticks = (lo, hi, step) => { const t = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(6)); return t; };

    // ---------- Figure 2: Lagos heat island per period ----------
    function periodChart() {
        const W = 760, H = 300, m = { l: 48, r: 16, t: 14, b: 54 };
        const P = C.periods, st = C.state;
        const hi = Math.ceil(Math.max(...P.map(p => Math.max(st[p.label].ci95[1], st[p.label].all_observed.ci95[1])))) + 0.5;
        const y = v => m.t + (H - m.t - m.b) * (1 - v / hi), bw = (W - m.l - m.r) / P.length;
        const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'svgchart', role: 'img',
            'aria-label': P.map(p => `${p.label}: ${sf(st[p.label].weighted_suhi)} °C`).join('; ') });
        ticks(0, hi, 1).forEach(v => { svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'zero' : 'grid' })); svg.append(el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, sf(v, 0))); });
        svg.append(el('text', { x: 4, y: m.t - 2, class: 'axis-title' }, '°C'));
        P.forEach((p, i) => {
            const cx = m.l + bw * (i + 0.5), s = st[p.label], a = s.all_observed;
            svg.append(el('line', { x1: cx + 22, x2: cx + 22, y1: y(a.ci95[0]), y2: y(a.ci95[1]), class: 'ci-muted' }));
            svg.append(el('circle', { cx: cx + 22, cy: y(a.weighted_suhi), r: 5, class: 'pt-open' }));
            svg.append(el('line', { x1: cx, x2: cx, y1: y(s.ci95[0]), y2: y(s.ci95[1]), class: 'ci' }));
            svg.append(el('circle', { cx, cy: y(s.weighted_suhi), r: 6.5, class: 'pt' }));
            svg.append(el('text', { x: cx - 12, y: y(s.weighted_suhi) + 4, 'text-anchor': 'end', class: 'lab-strong' }, sf(s.weighted_suhi)));
            svg.append(el('text', { x: cx, y: H - m.b + 22, 'text-anchor': 'middle', class: 'lab-strong' }, p.label));
            svg.append(el('text', { x: cx, y: H - m.b + 40, 'text-anchor': 'middle' }, `${s.passes} passes`));
        });
        $('#periodchart').append(svg);
    }

    // ---------- Figure 3: change per LGA ----------
    function lgaChart() {
        const L = C.lgas, names = Object.keys(L).filter(n => L[n].change).sort((a, b) => L[b].change.delta - L[a].change.delta);
        const row = 26, m = { l: 132, r: 120, t: 26, b: 8 }, W = 860, H = m.t + m.b + row * names.length;
        const all = names.flatMap(n => [L[n].change.delta, ...L[n].change.ci95.filter(v => v != null)]);
        const lo = Math.floor(Math.min(...all)), hi = Math.ceil(Math.max(...all));
        const x = v => m.l + (W - m.l - m.r) * (v - lo) / (hi - lo);
        const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'svgchart', role: 'img', 'aria-label': 'Change in heat island per LGA with 95% intervals' });
        ticks(lo, hi, 2).forEach(v => { svg.append(el('line', { x1: x(v), x2: x(v), y1: m.t - 6, y2: H - m.b, class: v === 0 ? 'zero' : 'grid' })); svg.append(el('text', { x: x(v), y: m.t - 12, 'text-anchor': 'middle' }, sf(v, 0))); });
        names.forEach((n, i) => {
            const c = L[n].change, cy = m.t + row * (i + 0.5), on = c.verdict === 'Warmed';
            svg.append(el('text', { x: m.l - 10, y: cy + 4, 'text-anchor': 'end', class: on ? 'lab-strong' : '' }, n));
            if (c.ci95[0] != null) svg.append(el('line', { x1: x(c.ci95[0]), x2: x(c.ci95[1]), y1: cy, y2: cy, class: on ? 'ci' : 'ci-muted' }));
            svg.append(el('circle', { cx: x(c.delta), cy, r: 5.5, class: on ? 'pt' : 'pt-open' }));
            svg.append(el('text', { x: W - m.r + 10, y: cy + 4 }, `${sf(c.delta)}${c.verdict === 'Too few clear days' ? ', too few passes' : ''}`));
        });
        $('#lgachart').append(svg);
    }

    // ---------- Figure 4: period maps ----------
    function periodMaps() {
        $('#period-maps').innerHTML = C.periods.map(p => `<figure><div class="pm-head"><b>${p.label}</b><span>${p.n_scenes} passes · ${pct(p.share_above_3c)}% of land more than 3 °C hotter</span></div>
            <img src="data/${p.file}" alt="Heat-island map of Lagos State, ${p.label}" width="2053" height="422"></figure>`).join('');
        rampLegend($('#maps-legend'));
    }

    // ---------- Figure 5: urbanisation ----------
    function urbanChart() {
        const u = C.urbanisation, pts = u.points, W = 760, H = 380, m = { l: 48, r: 24, t: 16, b: 46 };
        const xs = pts.map(p => p.built_change_pp), ys = pts.map(p => p.suhi_change);
        const x0 = 0, x1 = Math.ceil(Math.max(...xs) / 2) * 2 + 1, y0 = Math.min(0, Math.floor(Math.min(...ys))), y1 = Math.ceil(Math.max(...ys)) + 0.5;
        const X = v => m.l + (W - m.l - m.r) * (v - x0) / (x1 - x0), Y = v => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0));
        const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'svgchart', role: 'img', 'aria-label': `Heat-island change against built-up change for ${pts.length} LGAs` });
        ticks(y0, y1, 1).forEach(v => { svg.append(el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'zero' : 'grid' })); svg.append(el('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, sf(v, 0))); });
        ticks(x0, x1, 2).forEach(v => svg.append(el('text', { x: X(v), y: H - m.b + 20, 'text-anchor': 'middle' }, f(v, 0))));
        svg.append(el('text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis-title' }, `Change in built-up share of land, percentage points, ${u.ghsl_years[0]} to ${u.ghsl_years[1]}`));
        svg.append(el('text', { x: 4, y: m.t - 4, class: 'axis-title' }, '°C'));
        // least-squares line through the mean point
        const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length, b = u.slope_c_per_10pp / 10;
        const xa = Math.min(...xs), xb = Math.max(...xs);
        svg.append(el('line', { x1: X(xa), y1: Y(my + b * (xa - mx)), x2: X(xb), y2: Y(my + b * (xb - mx)), class: 'fit' }));
        const label = new Set(u.without_most_built.dropped.concat(['Mushin', 'Surulere', 'Apapa', 'Badagry']));
        pts.forEach(p => {
            svg.append(el('circle', { cx: X(p.built_change_pp), cy: Y(p.suhi_change), r: 5.5, class: 'pt' }));
            if (label.has(p.lga)) svg.append(el('text', { x: X(p.built_change_pp) + (p.built_change_pp > x1 - 3 ? -9 : 9), y: Y(p.suhi_change) + 4, 'text-anchor': p.built_change_pp > x1 - 3 ? 'end' : 'start' }, p.lga));
        });
        $('#urbanchart').append(svg);
    }

    // ---------- Table 2 and the screening funnel ----------
    function tableNow() {
        const s = S, sa = s.spatial_autocorrelation, rg = s.regression, se = s.sensor_agreement, he = s.heat_exposure;
        const v = rg.lst_on_ndvi.coefficients.ndvi, vb = rg.lst_on_ndvi_ndbi.coefficients.ndvi;
        const rows = [
            ['Do hot LGAs sit together?', `Moran's <var>I</var> = ${f(sa.queen.I, 2)} with shared borders, ${f(sa.knn.k_5.I, 2)} with 5 nearest neighbours; permutation <var>p</var> = ${f(sa.knn.k_5.p_perm, 3)} <span class="cite">(Moran, 1950)</span>`, 'Yes'],
            ['Is any single LGA a hot or cold spot?', `${sa.knn.k_5.n_fdr_hot} hot and ${sa.knn.k_5.n_fdr_cold} cold spots after false-discovery-rate correction (Getis–Ord <var>G</var><sub>i</sub>*) <span class="cite">(Getis &amp; Ord, 1992)</span>`, 'No'],
            ['Are greener LGAs cooler?', `${sf(v.beta / 10)} °C per +0.1 NDVI (95% interval ${range(v.ci95.map(c => c / 10))}); <var>R</var>² = ${f(rg.lst_on_ndvi.r2, 2)}`, 'Yes'],
            ['Is it vegetation or built-up density?', `NDVI and NDBI correlate at <var>r</var> = ${f(rg.collinearity.r_ndvi_ndbi, 2)} (VIF ${f(rg.collinearity.vif, 1)}); with both in the model, NDVI's effect is ${sf(vb.beta / 10)} °C per +0.1 (95% interval ${range(vb.ci95.map(c => c / 10))})`, 'Cannot separate'],
            ['Does a second satellite agree?', `MODIS ranks the LGAs like Landsat (Spearman ρ = ${f(se.spearman_rho, 2)}) but reads ${f(se.mean_difference_c, 1)} °C cooler on average`, 'Yes, in ranking'],
            ['Where does heat meet the most people?', `${list(he.top5)} (temperature × population density, both scaled 0–1; rank version agrees, ρ = ${f(he.spearman_minmax_vs_rank, 2)})`, 'Ranking only'],
        ];
        $('#table-now tbody').innerHTML = rows.map(([q, r, v]) => `<tr><td class="text">${q}</td><td class="text">${r}</td><td class="text">${v}</td></tr>`).join('');
    }
    function funnel() {
        const sc = C.scenes, all = sc.considered;
        const rej = Object.entries(sc.rejected).sort((a, b) => b[1] - a[1]);
        const rows = [['Dry-season passes, 1985–2026', all, ''], ...rej.map(([k, n]) => [`Rejected: ${k}`, n, '']), ['Kept', sc.used, 'kept']];
        $('#funnel').innerHTML = rows.map(([t, n, cls]) => `<li class="${cls}"><span>${esc(t.charAt(0).toUpperCase() + t.slice(1))}</span><b>${n}</b><span class="fbar"><span style="--w:${(100 * n / all).toFixed(1)}%"></span></span></li>`).join('');
    }

    // ---------- page chrome: reading progress, contents, back to top, citation ----------
    function snack(msg) { const d = document.createElement('div'); d.className = 'snack'; d.setAttribute('role', 'status'); d.textContent = msg; document.body.append(d); setTimeout(() => d.remove(), 2000); }
    function initChrome() {
        const bar = $('#progress'), top = $('#to-top'), links = $$('.toc a[href^="#"]');
        const targets = links.map(a => $(a.getAttribute('href')));
        let queued = false;
        const update = () => {
            queued = false;
            const max = document.documentElement.scrollHeight - innerHeight;
            bar.style.width = `${max > 0 ? Math.min(100, 100 * scrollY / max) : 0}%`;
            top.hidden = scrollY < innerHeight * 1.5;
            let cur = -1; targets.forEach((t, i) => { if (t && t.getBoundingClientRect().top < innerHeight * 0.35) cur = i; });
            links.forEach((a, i) => { if (i === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
        };
        addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
        addEventListener('resize', update);
        update();
        top.addEventListener('click', () => { scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); $('.site-id').focus({ preventScroll: true }); });
        $('#copy-cite').addEventListener('click', () => {
            const t = $('#cite-text').textContent.replace(/\s+/g, ' ').trim();
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => snack('Citation copied'), () => window.prompt('Copy the citation:', t));
            else window.prompt('Copy the citation:', t);
        });
        const items = $$('.reveal, [data-reveal]');
        if (reduced || !('IntersectionObserver' in window)) { items.forEach(x => x.classList.add('in')); return; }
        document.documentElement.classList.add('js-reveal');
        const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
        items.forEach(x => io.observe(x));
    }

    // ---------- start ----------
    const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });
    Promise.all([get('data/change_summary.json'), get('data/summary.json'), get('data/lagos_uhi_processed.geojson')]).then(([c, s, g]) => {
        C = c; S = s; GEO = g;
        fill();
        initPeriods(); drawMap();
        periodChart(); lgaChart(); periodMaps(); urbanChart(); tableNow(); funnel();
        initChrome();
    }).catch(err => {
        console.error(err);
        $('#abstract').insertAdjacentHTML('afterbegin', '<p class="small" role="alert">The data files could not be loaded, so the numbers on this page are missing. Open the page through a web server (for example <code>python -m http.server -d docs</code>) or visit the published site.</p>');
        initChrome();
    });
})();
