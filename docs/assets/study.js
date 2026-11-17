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

})();
