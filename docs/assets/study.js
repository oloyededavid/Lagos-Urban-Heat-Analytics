/* Study page chrome, shared by the study sites built from a paper: reading progress, the current section in the
   header, back to top, copy citation, and the reactions and page views at the end of the page.
   Counts use the public Abacus counter (abacus.jasoncameron.dev) on the live site only: a view once per browser
   session, a reaction once per browser. No names, addresses or cookies are stored. The counter namespace and the
   storage key come from <body data-counter="..." data-store="...">. */
(() => {
    'use strict';
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // storage can be blocked by the browser: even reading window.sessionStorage then throws, so it stays inside try
    const store = {
        get: (k, local) => { try { return (local ? localStorage : sessionStorage).getItem(k); } catch (e) { return null; } },
        set: (k, v, local) => { try { (local ? localStorage : sessionStorage).setItem(k, v); } catch (e) { /* storage blocked */ } },
    };

    // ---------- reading progress, current section, back to top ----------
    const bar = $('#progress'), top = $('#to-top');
    const links = $$('.toc a, .toc-phone a').filter(a => (a.getAttribute('href') || '').startsWith('#'));
    const targets = [...new Set(links.map(a => a.getAttribute('href')))].map(h => document.getElementById(h.slice(1))).filter(Boolean);
    let queued = false;
    const update = () => {
        queued = false;
        const max = document.documentElement.scrollHeight - innerHeight;
        if (bar) bar.style.width = `${max > 0 ? Math.min(100, 100 * scrollY / max) : 0}%`;
        if (top) top.hidden = scrollY < innerHeight * 1.5;
        let cur = null;
        targets.forEach(t => { if (t.getBoundingClientRect().top < innerHeight * 0.3) cur = t; });
        links.forEach(a => {
            if (cur && a.getAttribute('href') === `#${cur.id}`) a.setAttribute('aria-current', 'true');
            else a.removeAttribute('aria-current');
        });
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', update);
    update();
    if (top) top.addEventListener('click', () => {
        scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
        const id = $('.site-id'); if (id) id.focus({ preventScroll: true });
    });

    // ---------- copy citation ----------
    const copy = $('#copy-cite');
    if (copy) copy.addEventListener('click', () => {
        const t = $('#cite-text').textContent.replace(/\s+/g, ' ').trim();
        const done = () => { const was = copy.textContent; copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = was; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => window.prompt('Copy the citation:', t));
        else window.prompt('Copy the citation:', t);
    });

    // ---------- reactions and page views ----------
    const NS = document.body.dataset.counter, STORE = document.body.dataset.store || `${NS}-reaction`;
    if (!NS) return;
    const COUNTER = 'https://abacus.jasoncameron.dev';
    const LIVE = location.hostname === 'oloyededavid.github.io' && !navigator.webdriver;
    const KEY = { 'Useful': 'useful', 'Interesting': 'interesting', 'Needs clarity': 'clarity' };
    const fmt = n => Number(n).toLocaleString('en-GB');
    const count = (op, key) => fetch(`${COUNTER}/${op}/${NS}/${key}`)
        .then(r => (r.ok ? r.json() : r.status === 404 ? { value: 0 } : Promise.reject(r.status)))
        .then(j => Number(j.value) || 0);
    const show = (label, n) => { const el = $(`.react[data-react="${label}"] .rc`); if (el) el.textContent = n ? fmt(n) : ''; };
    if (LIVE) {
        const v = $('#views');
        if (v) {
            const seen = store.get(`${NS}-viewed`);
            count(seen ? 'get' : 'hit', 'views')
                .then(n => { if (!seen) store.set(`${NS}-viewed`, '1'); if (n) { v.textContent = `${fmt(n)} page views`; v.hidden = false; } })
                .catch(() => {});
        }
        Object.entries(KEY).forEach(([label, key]) => { if ($(`.react[data-react="${label}"]`)) count('get', key).then(n => show(label, n)).catch(() => {}); });
    }
    const buttons = $$('.react'), status = $('#react-status');
    if (!buttons.length || !status) return;
    let reaction = store.get(STORE, true) || '';
    const mark = () => buttons.forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.react === reaction));
        b.classList.toggle('is-other', !!reaction && b.dataset.react !== reaction);
    });
    mark();
    if (reaction) status.textContent = 'Thanks, your reaction is counted.';
    buttons.forEach(b => b.addEventListener('click', () => {
        if (reaction) {
            status.textContent = reaction === b.dataset.react ? 'Thanks, your reaction is counted.' : 'You have already reacted from this browser.';
            return;
        }
        reaction = b.dataset.react;
        store.set(STORE, reaction, true);
        mark();
        status.textContent = 'Thank you! Counted.';
        const rc = $('.rc', b);
        rc.textContent = fmt((Number((rc.textContent || '0').replace(/,/g, '')) || 0) + 1);
        b.classList.add('pop');
        if (LIVE) count('hit', KEY[reaction]).then(n => show(reaction, n)).catch(() => {});
    }));
})();
