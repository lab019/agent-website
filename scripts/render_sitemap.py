#!/usr/bin/env python3
"""Render <lastmod> into <site_dir>/sitemap.xml from git history.

Usage: python3 scripts/render_sitemap.py <site_dir>

For each <url> the lastmod is the date (YYYY-MM-DD) of the last commit that
touched the route's index.html, read from the repository that contains
<site_dir> (its parent directory is the repo root). Existing <lastmod> are
replaced, never duplicated; other tags (changefreq, priority) are preserved.

Fails loudly (exit 1, sitemap untouched) when the sitemap is missing or empty,
a <loc> has no index.html, an indexable page is absent from the sitemap, a
route has no commit, or the clone is shallow.
"""
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

URL_RE = re.compile(r"<url>.*?</url>", re.S)
LOC_RE = re.compile(r"<loc>\s*(.*?)\s*</loc>", re.S)
LASTMOD_RE = re.compile(r"[ \t]*<lastmod>.*?</lastmod>[ \t]*\n?", re.S)


class RenderError(Exception):
    pass


class _Robots(HTMLParser):
    def __init__(self):
        super().__init__()
        self.noindex = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and (a.get("name") or "").lower() == "robots" \
                and "noindex" in (a.get("content") or "").lower():
            self.noindex = True


def is_noindex(path):
    parser = _Robots()
    parser.feed(path.read_text(encoding="utf-8"))
    return parser.noindex


def git(repo, *args):
    try:
        r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    except OSError as exc:
        raise RenderError("git unavailable (%s)" % exc)
    if r.returncode != 0:
        raise RenderError("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout.strip()


def route_of(loc):
    path = urlparse(loc).path or "/"
    return path if path.endswith("/") else path + "/"


def page_of(site, route):
    rel = route.strip("/")
    return site / rel / "index.html" if rel else site / "index.html"


def render(site):
    sitemap = site / "sitemap.xml"
    if not sitemap.is_file():
        raise RenderError("%s not found" % sitemap)
    xml = sitemap.read_text(encoding="utf-8")
    blocks = URL_RE.findall(xml)
    if not blocks:
        raise RenderError("%s has no <url>" % sitemap)

    routes = []
    for block in blocks:
        m = LOC_RE.search(block)
        if not m:
            raise RenderError("<url> without <loc> in %s" % sitemap)
        route = route_of(m.group(1))
        if not page_of(site, route).is_file():
            raise RenderError("<loc> %s has no index.html (%s)" % (route, page_of(site, route)))
        routes.append(route)

    listed = set(routes)
    for page in sorted(site.rglob("index.html")):
        rel = page.parent.relative_to(site).as_posix()
        route = "/" if rel == "." else "/%s/" % rel
        if route not in listed and not is_noindex(page):
            raise RenderError("indexable page missing from sitemap: %s" % page)

    repo = site.parent
    if git(repo, "rev-parse", "--is-shallow-repository") == "true":
        raise RenderError("shallow clone has incomplete history; "
                          "use actions/checkout with fetch-depth: 0")

    dates = {}
    for route in routes:
        rel = page_of(site, route).relative_to(repo).as_posix()
        date = git(repo, "log", "-1", "--format=%cs", "--", rel)
        if not date:
            raise RenderError("route %s has no commit (%s)" % (route, rel))
        dates[route] = date

    def rewrite(match):
        block = match.group(0)
        route = route_of(LOC_RE.search(block).group(1))
        block = LASTMOD_RE.sub("", block)
        loc_end = LOC_RE.search(block).end()
        line_start = block.rfind("\n", 0, block.find("<loc>")) + 1
        indent = block[line_start:block.find("<loc>")]
        return "%s\n%s<lastmod>%s</lastmod>%s" % (
            block[:loc_end], indent, dates[route], block[loc_end:])

    out = URL_RE.sub(rewrite, xml)
    sitemap.write_text(out, encoding="utf-8")
    return len(routes)


def main(argv):
    if len(argv) != 2:
        print("usage: render_sitemap.py <site_dir>", file=sys.stderr)
        return 2
    try:
        count = render(Path(argv[1]).resolve())
    except RenderError as exc:
        print("error: sitemap not rendered: %s" % exc, file=sys.stderr)
        return 1
    print("sitemap lastmod rendered for %d urls" % count)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
