"""Build docs/index.html from paper/paper.md. Numbers and figures come from the paper build (scripts/build_paper.py),
so the page and the paper cannot disagree.

    python scripts/build_paper.py && python scripts/build_page.py
"""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAPS = {  # paper figure image -> (desktop webp, phone webp or None)
    "paper/figures/fig1_population.png": ("assets/maps/m12_population.webp", "assets/maps/m12_population_phone.webp"),
    "paper/figures/fig2_landcover.png": ("assets/maps/m02_landcover.webp", "assets/maps/m02_landcover_phone.webp"),
}
FIG = re.compile(r"!\[(\*\*Figure (\d+)\.\*\* )?(.*?)\]\((paper/figures/[^)]+)\)")


def image_size(rel):
    from PIL import Image
    with Image.open(ROOT / "docs" / rel) as im:
        return im.size


def figure_html(m):
    caption, num, desc, src = m.group(0), m.group(2), m.group(3), m.group(4)
    desk, phone = MAPS[src]
    alt = re.sub(r"\*\*", "", desc).replace('"', "&quot;")
    src_tag = f'<source media="(max-width: 760px)" srcset="{phone}">' if phone else ""
    return (f'<figure class="wide reveal mapimg" id="fig-{num}">'
            f'<picture>{src_tag}<img src="{desk}" width="{image_size(desk)[0]}" height="{image_size(desk)[1]}" loading="lazy" alt="{alt}"></picture>'
            f'<figcaption><b>Figure {num}.</b> {desc}</figcaption></figure>')


EXPLORE = """<h3 id="explore">3.4 Map of the local government areas</h3>
<p>Pick a measure, then select an area on the map or from the list. Mean heat is averaged over the cells of an area that have a heat value. The shares count all residents of the area, and residents on cells without a heat value count as not hot. In the east, where a larger share of cells has no heat value, an area's values rest on a smaller share of its land.</p>
<div id="xp-buttons" class="xp-buttons" role="group" aria-label="Measure"></div>
<p class="xp-pick"><label for="xp-select">Area</label> <select id="xp-select"></select></p>
<div id="explore-map" class="xp-map"></div>
<div class="xp-legend"><span id="xp-min"></span><span id="xp-legend-bar" class="xp-legend-bar" aria-hidden="true"></span><span id="xp-max"></span></div>
<p id="xp-unit" class="xp-unit"></p>
<p id="xp-readout" class="xp-readout" role="status">Select an area on the map, on the list above it, or use Tab and Enter.</p>
<details class="xp-table"><summary>Show all areas as a table</summary><div id="xp-table"></div></details>
"""


def tidy(html):
    """Keep a number and its unit together on one line, and put the title and description on one line each."""
    import re
    parts = re.split(r"(<[^>]+>)", html)
    unit = re.compile(r"(\d) (°C|km\b|m\b|%)")
    parts = [p if p.startswith("<") else unit.sub("\\1\u00a0\\2", p) for p in parts]
    html = "".join(parts)
    html = re.sub(r"<title>(.*?)</title>", lambda m: "<title>" + " ".join(m.group(1).split()) + "</title>", html, flags=re.S)
    html = re.sub(r'(<meta name="description" content=")(.*?)(">)', lambda m: m.group(1) + " ".join(m.group(2).split()) + m.group(3), html, flags=re.S)
    return html


def main():
    md = (ROOT / "paper" / "paper.md").read_text(encoding="utf-8")
    # drop the YAML header: the page template prints the title and author itself
    m = re.match(r"^---\n(.*?)\n---\n", md, flags=re.S)
    meta = dict(re.findall(r'^(\w+): "?([^"\n]*)"?$', m.group(1), flags=re.M)) if m else {}
    body = md[m.end():] if m else md
    body = FIG.sub(figure_html, body)
    tmp = ROOT / "paper" / "_page_body.md"
    tmp.write_text(body, encoding="utf-8")
    out = ROOT / "docs" / "index.html"
    try:
        subprocess.run(["pandoc", str(tmp), "-f", "markdown-raw_html+raw_html", "-t", "html5", "--shift-heading-level-by=1",
                        "--template", str(ROOT / "scripts" / "page_template.html"), "-o", str(out),
                        "--metadata", f"pagetitle={meta.get('title', '')}", "--metadata", f"title={meta.get('title', '')}",
                        "--metadata", f"author={meta.get('author', '')}", "--metadata", f"date={meta.get('date', '')}",
                        "--metadata", "description=Urban heat island in Lagos State, 2020–2024: surface heat, population and distance to vegetation."],
                       check=True)
    finally:
        tmp.unlink(missing_ok=True)
    html = out.read_text(encoding="utf-8")
    marker = '<h2 id="discussion">'
    assert html.count(marker) == 1, "discussion heading not found"
    html = html.replace(marker, EXPLORE + marker)
    html = tidy(html)
    out.write_text(_study_links(_page_end(html), out.parent), encoding="utf-8")
    print("wrote", out)



def _study_links(html, docs):
    """Re-insert the cross-site links that the portfolio's tools/sync_nav.py keeps in docs/assets/study-*.html."""
    import re as _re
    for key, where in (("study-bar", "top"), ("study-nav", "end")):
        f = docs / "assets" / f"{key}.html"
        if not f.exists():
            continue
        block = f.read_text(encoding="utf-8").strip()
        html = _re.sub(rf"<!-- {key}:start -->.*?<!-- {key}:end -->\n?", "", html, flags=_re.S)
        if where == "top":
            html = _re.sub(r"(<body[^>]*>)", lambda m: m.group(1) + "\n" + block, html, count=1)
        else:
            html = html.replace("</body>", block + "\n</body>", 1)
    f = docs / "assets" / "study-others.html"  # the "Other studies" line in the footer, kept in place
    if f.exists():
        block = f.read_text(encoding="utf-8").strip()
        html = _re.sub(r"<!-- study-others:start -->.*?<!-- study-others:end -->", lambda m: block, html, flags=_re.S)
    return html


def _web_ending(html, end):
    """Shape the end of the page like the other study sites: the paper's own data-and-code section becomes the
    opening paragraph of "Data, code and citation" (so the page says it once), the page end goes before the
    references, and the references become the same compact list, with DOIs shown as doi:..."""
    import re as _re
    m = _re.search(r'<h2 id="[^"]*data-and-code[^"]*">.*?</h2>\s*(.*?)(?=<h2 )', html, flags=_re.S)
    if not m:
        raise SystemExit("page end: the paper's data-and-code section was not found (its heading id changed?)")
    html = html[:m.start()] + html[m.end():]
    end, n = _re.subn(r'(<h2 id="h-dc">.*?</h2>)', lambda k: k.group(1) + "\n    " + m.group(1).strip(), end, count=1, flags=_re.S)
    if not n:
        raise SystemExit('page end: page_end.html has no <h2 id="h-dc"> heading')
    anchor = '<h2 id="references">'
    if anchor not in html:
        raise SystemExit("page end: no References heading to place the end of the page before")
    html = html.replace(anchor, end + "\n" + anchor, 1)
    r = _re.search(r'(<h2 id="references">References</h2>\s*)((?:<p>.*?</p>\s*)+)', html, flags=_re.S)
    if not r:
        raise SystemExit("page end: no reference paragraphs after the References heading")
    else:
        def item(p):
            p = " ".join(p.split())  # pandoc wraps lines, even inside tags
            p = _re.sub(r'<a href="https://doi\.org/([^"]+)"[^>]*>[^<]*</a>', lambda k: f'<a href="https://doi.org/{k.group(1)}">doi:{k.group(1)}</a>', p)
            trim = lambda u: (u[:-1] if u.endswith(")") and u.count("(") < u.count(")") else u).rstrip(".,;:")
            def bare(k, doi):
                u = trim(k.group(1)); rest = k.group(1)[len(u):]
                return (f'<a href="https://doi.org/{u}">doi:{u}</a>' if doi else f'<a href="{u}">{u}</a>') + rest
            p = _re.sub(r'(?<![">/])https://doi\.org/([^\s<]+)', lambda k: bare(k, True), p)
            p = _re.sub(r'(?<![">/])(https?://[^\s<]+)', lambda k: bare(k, False), p)
            return "<li>" + p + "</li>"
        items = [item(p) for p in _re.findall(r"<p>(.*?)</p>", r.group(2), flags=_re.S)]
        html = html[:r.start(2)] + '<ol class="refs" role="list">\n' + "\n".join(items) + "\n</ol>\n" + html[r.end(2):]
    return html


def _page_end(html):
    """The end of the page (key terms, data and citation, a note, feedback) lives in page_end.html next to this script."""
    return _web_ending(html, Path(__file__).with_name("page_end.html").read_text(encoding="utf-8").strip())

if __name__ == "__main__":
    main()
