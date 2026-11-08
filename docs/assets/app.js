/* Lagos surface heat: study page.
   Every number and map is drawn from docs/data (summary.json, change_summary.json,
   lagos_uhi_processed.geojson, context_countries.geojson). */
(() => {
    'use strict';
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
    const NS = 'http://www.w3.org/2000/svg';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let S, C, GEO, CTRY;

    // ---------- formatting ----------
    const f = (x, d = 1) => Number(x).toFixed(d).replace(/^-/, '−');
    const sf = (x, d = 1) => (x > 0 ? '+' : '') + f(x, d);
    const pct = x => String(Math.round(x * 100));
    const int = x => Math.round(x).toLocaleString('en-GB');
    const list = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
    const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    const el = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
    const prop = n => GEO.features.find(ft => ft.properties.lga_name === n).properties;

    function fill() {
        const P = C.periods, L = C.lgas, lst = S.lst, labels = P.map(p => p.label);
        const names = Object.keys(L);
        const common = names.filter(n => labels.every(l => L[n].periods[l].enough));
        const excl = names.filter(n => !common.includes(n));
        const area = ns => ns.reduce((a, n) => a + L[n].land_km2, 0);
        const warmed = names.filter(n => L[n].change && L[n].change.verdict === 'Warmed').sort((a, b) => L[b].change.delta - L[a].change.delta);
        const few = names.filter(n => L[n].change && L[n].change.verdict === 'Too few clear days');
        const smallest = [...GEO.features].sort((a, b) => a.properties.land_area_km2 - b.properties.land_area_km2)[0].properties;
        const rank = [...GEO.features].map(ft => ft.properties).sort((a, b) => b.hei - a.hei).map(p => p.lga_name);
        const ao = labels.map(l => C.state[l].all_observed.weighted_suhi);
        const v = {
            nLga: String(GEO.features.length),
            lstRange: f(lst.max - lst.min), lstMin: f(lst.min), lstMax: f(lst.max), coolest: lst.coolest, hottest: lst.hottest,
            dState: f(C.state_change.delta), dCi: `${f(C.state_change.ci95[0])} to ${f(C.state_change.ci95[1])}`,
            hot1: pct(P[0].share_above_3c), hot3: pct(P[P.length - 1].share_above_3c),
            smallKm: int(smallest.land_area_km2), epeKm: int(prop('Epe').land_area_km2),
            refKm: String(C.method.reference_buffer_m / 1000),
            top3: list(S.heat_exposure.top5.slice(0, 3)), alimRank: String(rank.indexOf('Alimosho') + 1),
            scUsed: String(C.scenes.used), scAll: String(C.scenes.considered), nCommon: String(common.length),
            warmedList: list(warmed), nWarmedWord: WORDS[warmed.length] || String(warmed.length), fewList: list(few),
            exclList: list(excl), exclShare: pct(area(excl) / area(names)),
            a1: sf(ao[0]), a3: sf(ao[ao.length - 1]),
            urbDrop: list(C.urbanisation.without_most_built.dropped), pass1: String(P[0].n_scenes),
            modisOff: f(S.sensor_agreement.mean_difference_c),
        };
        $$('[data-v]').forEach(e => { if (e.dataset.v in v) e.textContent = v[e.dataset.v]; });
    }

    // ---------- colour (data scales; the interface blue is never used for data) ----------
    const RAMPS = {
        heat: ['#fdeee2', '#f9a05a', '#f2711c', '#d9500b', '#a93a08', '#6b2406'],   // same family as the exported heat-island maps
        green: ['#eef6ee', '#7fc283', '#4ea455', '#2f8a3f', '#1b6a30', '#0b461e'],
        grey: ['#f2f2f0', '#d0cfca', '#a8a7a1', '#7d7c76', '#53524d', '#2b2a27'],
    };
    // hot is orange and cool is blue, the same pair as the heat-island maps (Figure 6)
    const DIV = { neg: ['#f1eee6', '#86b6ef', '#1c5cab'], pos: ['#f1eee6', '#f2711c', '#a93a08'] };
    const NEUTRAL = '#ece9e2';
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    function interp(cols, t) {
        t = Math.max(0, Math.min(1, t));
        const x = t * (cols.length - 1), i = Math.min(Math.floor(x), cols.length - 2), u = x - i, a = hex(cols[i]), b = hex(cols[i + 1]);
        return `rgb(${a.map((v, k) => Math.round(v + u * (b[k] - v))).join(',')})`;
    }
    // domain: optional fixed [lo, hi]; otherwise the range of the values
    function scale(vals, kind, ramp, domain) {
        const ok = vals.filter(v => v != null);
        if (kind === 'div') {
            const m = domain ? domain[1] : Math.max(...ok.map(Math.abs));
            return { lo: -m, hi: m, mid: 0, col: v => v < 0 ? interp(DIV.neg, -v / m) : interp(DIV.pos, v / m), grad: `linear-gradient(to right, ${DIV.neg[2]}, ${DIV.neg[1]} 25%, ${DIV.neg[0]} 50%, ${DIV.pos[1]} 75%, ${DIV.pos[2]})` };
        }
        const cols = RAMPS[ramp || 'heat'], lo = domain ? domain[0] : Math.min(...ok), hi = domain ? domain[1] : Math.max(...ok);
        return { lo, hi, mid: (lo + hi) / 2, col: v => interp(cols, (v - lo) / (hi - lo)), grad: `linear-gradient(to right, ${cols.join(', ')})` };
    }

    // ---------- projection (equirectangular, scaled by cos latitude) ----------
    function frame(width, pad = 8) {
        let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
        GEO.features.forEach(ft => ft.geometry.coordinates.forEach(r => r.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); })));
        const k = Math.cos((y0 + y1) / 2 * Math.PI / 180), s = (width - 2 * pad) / ((x1 - x0) * k);
        // s is pixels per degree of latitude; one degree is 111.32 km, so pixels per km is s / 111.32
        return { w: width, h: Math.round((y1 - y0) * s + 2 * pad), pxPerKm: s / 111.32, p: ([x, y]) => [pad + (x - x0) * k * s, pad + (y1 - y) * s] };
    }
    const pathOf = (ft, p) => ft.geometry.coordinates.map(r => `M${r.map(c => p(c).map(v => v.toFixed(1)).join(',')).join('L')}Z`).join('');
    function centroid(ft, p) {
        const ring = ft.geometry.coordinates.reduce((a, b) => (b.length > a.length ? b : a)).map(p);
        let A = 0, cx = 0, cy = 0;
        for (let i = 0; i < ring.length - 1; i++) { const [x0, y0] = ring[i], [x1, y1] = ring[i + 1], c = x0 * y1 - x1 * y0; A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c; }
        return [cx / (3 * A), cy / (3 * A)];
    }

    // scale bar and north arrow, top right (empty on every map of this state)
    function scaleBar(svg, fr) {
        const km = 25, len = km * fr.pxPerKm, x = fr.w - 14 - len, y = 24, g = el('g', { class: 'scalebar' });
        g.append(el('line', { x1: x, x2: x + len, y1: y, y2: y, stroke: '#111', 'stroke-width': 2 }));
        [0, 1].forEach(i => g.append(el('line', { x1: x + i * len, x2: x + i * len, y1: y - 5, y2: y + 5, stroke: '#111', 'stroke-width': 2 })));
        g.append(el('text', { x, y: y - 9, 'text-anchor': 'start', class: 'sb' }, '0'));
        g.append(el('text', { x: x + len, y: y - 9, 'text-anchor': 'end', class: 'sb' }, `${km} km`));
        g.append(el('path', { d: `M${x - 22} ${y + 8} l-6 -20 l6 5 l6 -5 z`, fill: '#111' }));
        g.append(el('text', { x: x - 22, y: y - 15, 'text-anchor': 'middle', class: 'sb' }, 'N'));
        svg.append(g);
    }

    // ---------- LGA map ----------
    // spec: {id, title, value(props) -> number|null, fmt, kind: 'seq'|'div'|'plain', ramp, domain, unit,
    //        state(props) -> 'none'|'nodata'|null (for LGAs drawn neutral or hatched), readout, locator, labels}
    function lgaMap(spec) {
        const box = $(`#${spec.id}`), fr = frame(900);
        const vals = GEO.features.map(ft => spec.value ? spec.value(ft.properties) : null);
        const sc = spec.kind === 'plain' ? null : scale(vals, spec.kind, spec.ramp, spec.domain);
        box.innerHTML = spec.title ? `<p class="t">${spec.title}</p>` : '';
        const svg = el('svg', { viewBox: `0 0 ${fr.w} ${fr.h}`, role: 'group', 'aria-label': `${spec.title || 'Map'} by LGA. Select an LGA, or use the arrow keys, for its value.` });
        const defs = el('defs'), pat = el('pattern', { id: `hatch-${spec.id}`, width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
        pat.append(el('rect', { width: 7, height: 7, fill: '#f4f4f2' })); pat.append(el('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: '#b9b8b2', 'stroke-width': 2 }));
        defs.append(pat); svg.append(defs);
        if (spec.locator) locator(svg);
        const readout = document.createElement('p'); readout.className = 'readout'; readout.setAttribute('aria-live', 'polite');
        const paths = [];
        let on = null;
        const show = i => {
            const pr = GEO.features[i].properties, v = vals[i];
            readout.innerHTML = spec.readout ? spec.readout(pr, v) : `<b>${pr.lga_name}</b> ${v == null ? 'no value' : spec.fmt(v)}`;
        };
        const hint = () => { readout.textContent = matchMedia('(hover: hover)').matches ? 'Hover over or select an LGA.' : 'Tap an LGA.'; };
        const pick = i => { paths.forEach(x => x.classList.remove('on')); paths[i].classList.add('on'); on = i; show(i); };
        GEO.features.forEach((ft, i) => {
            const v = vals[i], st = spec.state ? spec.state(ft.properties) : null;
            const fillc = spec.kind === 'plain' ? '#e6e4de' : st === 'none' ? NEUTRAL : (st === 'nodata' || v == null) ? `url(#hatch-${spec.id})` : sc.col(v);
            const path = el('path', { d: pathOf(ft, fr.p), class: 'u', tabindex: i === 0 ? '0' : '-1', role: 'button', fill: fillc,
                'aria-label': `${ft.properties.lga_name}${spec.kind === 'plain' ? '' : ': ' + (v == null ? 'no value' : spec.fmt(v))}` });
            path.addEventListener('mouseenter', () => show(i));
            path.addEventListener('mouseleave', () => (on == null ? hint() : show(on)));
            path.addEventListener('click', () => { pick(i); });
            path.addEventListener('keydown', e => {
                const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
                if (k) { e.preventDefault(); const j = (i + k + paths.length) % paths.length; paths[i].tabIndex = -1; paths[j].tabIndex = 0; paths[j].focus(); show(j); }
                else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); }
            });
            paths.push(path); svg.append(path);
        });
        if (spec.labels) GEO.features.forEach(ft => {
            if (ft.properties.land_area_km2 < 100) return;
            const [x, y] = centroid(ft, fr.p); svg.append(el('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'lab' }, ft.properties.lga_name));
        });
        scaleBar(svg, fr);
        box.append(svg);
        if (sc) {
            const key = document.createElement('div'); key.className = 'ramp-key';
            key.innerHTML = `<span>${spec.fmt(sc.lo)}</span><span class="bar" style="background:${sc.grad}"></span><span>${spec.fmt(sc.hi)}</span><span class="u">${spec.unit || ''}</span>${(spec.keyExtra || '')}`;
            box.append(key);
        }
        box.append(readout); hint();
    }

    function locator(svg) {
        // Inset in the empty north-west corner: south-west Nigeria and neighbours, Lagos marked.
        const g = el('g', { transform: 'translate(8 8)', class: 'locator-inset' }), W = 170, lo0 = 0.5, lo1 = 9.5, la0 = 5.6, la1 = 10.4;
        const k = Math.cos(8 * Math.PI / 180), s = W / ((lo1 - lo0) * k), H = (la1 - la0) * s;
        const p = ([x, y]) => [(x - lo0) * k * s, (la1 - y) * s];
        g.append(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff', stroke: '#d6d6d2' }));
        const clip = el('clipPath', { id: 'loc-clip' }); clip.append(el('rect', { x: 0, y: 0, width: W, height: H })); g.append(clip);
        const inner = el('g', { 'clip-path': 'url(#loc-clip)' });
        CTRY.features.forEach(ft => {
            const polys = ft.geometry.type === 'Polygon' ? [ft.geometry.coordinates] : ft.geometry.coordinates;
            inner.append(el('path', { d: polys.map(pg => pg.map(r => `M${r.map(c => p(c).map(v => v.toFixed(1)).join(',')).join('L')}Z`).join('')).join(''), class: 'ctx', fill: ft.properties.name === 'Nigeria' ? '#e6e4de' : '#f4f4f2' }));
        });
        GEO.features.forEach(ft => inner.append(el('path', { d: pathOf(ft, p), fill: '#d9500b', stroke: 'none' })));
        g.append(inner);
        const lab = (x, y, t) => g.append(el('text', { x, y, class: 'lab' }, t));
        lab(...p([6.2, 9.4]), 'NIGERIA'); lab(...p([1.3, 9.6]), 'BENIN'); lab(...p([3.0, 6.25]).map((v, i) => i ? v + 14 : v), 'Lagos');
        svg.append(g);
    }

    // ---------- Figure 3b: temperature against vegetation ----------
    function ndviChart() {
        const pts = GEO.features.map(ft => ft.properties), W = 640, H = 300, m = { l: 46, r: 16, t: 14, b: 42 };
        const xs = pts.map(p => p.ndvi), ys = pts.map(p => p.mean_lst);
        const x0 = Math.floor(Math.min(...xs) * 10) / 10, x1 = Math.ceil(Math.max(...xs) * 10) / 10, y0 = Math.floor(Math.min(...ys)) - 1, y1 = Math.ceil(Math.max(...ys)) + 1;
        const X = v => m.l + (W - m.l - m.r) * (v - x0) / (x1 - x0), Y = v => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0));
        const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'svgchart', role: 'img', 'aria-label': 'Surface temperature against vegetation, one dot per LGA; greener LGAs are cooler' });
        for (let v = Math.ceil(y0); v <= y1; v += 2) { svg.append(el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' })); svg.append(el('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, String(v))); }
        for (let v = x0; v <= x1 + 1e-9; v += 0.1) svg.append(el('text', { x: X(v), y: H - m.b + 18, 'text-anchor': 'middle' }, f(v, 1)));
        svg.append(el('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle', class: 'axis-t' }, 'Vegetation index (NDVI)'));
        svg.append(el('text', { x: 2, y: m.t - 2, class: 'axis-t' }, '°C'));
        const c = S.regression.lst_on_ndvi.coefficients, a = c.intercept.beta, b = c.ndvi.beta;
        svg.append(el('line', { x1: X(x0), y1: Y(a + b * x0), x2: X(x1), y2: Y(a + b * x1), class: 'fit' }));
        pts.forEach(p => svg.append(el('circle', { cx: X(p.ndvi), cy: Y(p.mean_lst), r: 5, class: 'pt' })));
        [S.lst.hottest, S.lst.coolest].forEach(n => { const p = prop(n); const right = p.ndvi < (x0 + x1) / 2; svg.append(el('text', { x: X(p.ndvi) + (right ? 9 : -9), y: Y(p.mean_lst) + (right ? -9 : 4), 'text-anchor': right ? 'start' : 'end', class: 'lab' }, n)); });
        $('#ndvichart').append(svg);
    }

    // ---------- Figure 6: the three heat-island maps (the only place they appear) ----------
    function periods() {
        const box = $('#periods'), [[la0, lo0], [la1, lo1]] = C.map.bounds, W = 2053, H = 422;
        const p = ([x, y]) => [(x - lo0) / (lo1 - lo0) * W, (la1 - y) / (la1 - la0) * H];
        const outlines = GEO.features.map(ft => pathOf(ft, p)).join('');
        const body = C.periods.map(per => `<p class="pt-head">${per.label.replace('-', '–')} <span>· ${per.n_scenes} clear passes · ${pct(per.share_above_3c)}% of land more than 3 °C above the countryside</span></p>
            <div class="pstack"><img src="data/${per.file}" alt="Heat-island map of Lagos State, ${per.label}" width="${W}" height="${H}" loading="lazy">
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${outlines}"/></svg></div>`).join('');
        const st = C.map.stops, lo = st[0][0], hi = st[st.length - 1][0];
        const grad = st.map(([v, col]) => `${col} ${((v - lo) / (hi - lo) * 100).toFixed(1)}%`).join(', ');
        box.innerHTML = `<div class="pscroll" tabindex="0" role="region" aria-label="Heat-island maps for the three periods; scroll sideways on small screens"><div class="pinner">${body}</div></div>
            <div class="ramp-key" style="margin-top:12px"><span>${sf(lo, 0)}</span><span class="bar" style="background:linear-gradient(to right, ${grad})"></span><span>${sf(hi, 0)}</span><span class="u">°C above the countryside</span><span class="nd"><i style="background:#fff;border:1px solid #d6d6d2"></i>no clear pass</span></div>`;
    }

    // ---------- page behaviour ----------
    function snack(msg) { const d = document.createElement('div'); d.className = 'snack'; d.setAttribute('role', 'status'); d.textContent = msg; document.body.append(d); setTimeout(() => d.remove(), 2000); }
    function chrome() {
        const bar = $('#progress'), top = $('#to-top'), links = $$('.toc a[href^="#"]'), targets = links.map(a => $(a.getAttribute('href')));
        let queued = false;
        const update = () => {
            queued = false;
            const max = document.documentElement.scrollHeight - innerHeight;
            bar.style.width = `${max > 0 ? Math.min(100, 100 * scrollY / max) : 0}%`;
            top.hidden = scrollY < innerHeight * 1.5;
            let cur = -1; targets.forEach((t, i) => { if (t && t.getBoundingClientRect().top < innerHeight * 0.35) cur = i; });
            links.forEach((a, i) => (i === cur ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
        };
        addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
        addEventListener('resize', update); update();
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

    const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });
    Promise.all([get('data/summary.json'), get('data/change_summary.json'), get('data/lagos_uhi_processed.geojson'), get('data/context_countries.geojson')])
        .then(([s, c, g, ctry]) => {
            S = s; C = c; GEO = g; CTRY = ctry;
            fill();
            const chg = n => C.lgas[n] && C.lgas[n].change;
            const changeState = pr => { const ch = chg(pr.lga_name); return !ch || ch.verdict === 'Too few clear days' ? 'nodata' : ch.verdict === 'Warmed' ? null : 'none'; };
            lgaMap({ id: 'map-area', kind: 'plain', locator: true, labels: true, fmt: () => '',
                readout: pr => `<b>${pr.lga_name}</b> · ${int(pr.land_area_km2)} km² of land · ${int(pr.population)} people (2020)` });
            lgaMap({ id: 'map-lst', kind: 'seq', value: pr => pr.mean_lst, fmt: v => `${f(v)} °C`, unit: 'hotter' });
            lgaMap({ id: 'map-ndvi', title: 'Vegetation index (NDVI)', kind: 'seq', ramp: 'green', value: pr => pr.ndvi, fmt: v => f(v, 2), unit: 'greener' });
            lgaMap({ id: 'map-ndbi', title: 'Built-up index (NDBI)', kind: 'seq', ramp: 'grey', value: pr => pr.ndbi, fmt: v => f(v, 2), unit: 'more built up' });
            lgaMap({ id: 'map-gi', kind: 'div', domain: [-2, 2], value: pr => pr.gi_zscore_k5, fmt: v => sf(v, 1), unit: 'z score, cool to hot',
                readout: (pr, v) => `<b>${pr.lga_name}</b> z = ${sf(v, 2)} · ${Math.abs(v) < 1.96 ? 'not a hot or cold spot' : 'beyond ±1.96'}` });
            lgaMap({ id: 'map-people', kind: 'seq', value: pr => pr.hei, fmt: v => f(v, 2), unit: 'higher exposure',
                readout: (pr, v) => `<b>${pr.lga_name}</b> index ${f(v, 2)} · ${f(pr.mean_lst)} °C · ${int(pr.pop_density)} people per km²` });
            lgaMap({ id: 'map-change', kind: 'seq', domain: [0, 3.5], state: changeState, fmt: v => `${sf(v)} °C`, unit: 'warmer',
                keyExtra: '<span class="nd"><i style="background:#ece9e2"></i>no clear change</span><span class="nd"><i class="hatch"></i>too few passes</span>',
                value: pr => { const ch = chg(pr.lga_name); return ch && ch.verdict !== 'Too few clear days' ? ch.delta : null; },
                readout: (pr, v) => { const ch = chg(pr.lga_name); return `<b>${pr.lga_name}</b> ${v == null ? 'too few clear passes to test' : `${sf(v)} °C (95% interval ${sf(ch.ci95[0])} to ${sf(ch.ci95[1])}) · ${ch.verdict === 'Warmed' ? 'clear change' : 'no clear change'}`}`; } });
            ndviChart(); periods();
            chrome();
        })
        .catch(err => { console.error(err); $('#abstract').insertAdjacentHTML('afterbegin', '<p class="small" role="alert">The data files could not be loaded. Open the page through a web server or visit the published site.</p>'); chrome(); });
})();
