"""Acceptance LIC-3217: titles and descriptions follow one SEO pattern on every page.

critério -> teste
c1 | every page: <title> <= 60 chars and ends with " — Lab019" | Pattern::test_c1_title_fits_and_ends_with_brand
c2 | every indexable page: meta description present and <= 155 chars | Pattern::test_c2_description_fits
c3 | og:title / og:description equal <title> / meta description | Pattern::test_c3_open_graph_matches
c_borda | 404 and other noindex pages are exempt from description/og (title still checked) | Pattern::test_c_borda_noindex_exempt
c_org, c_papel: not applicable (static site, no org and no role).

Stdlib only; HTML read with HTMLParser, never regex on <script>.
"""
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
BRAND = " — Lab019"
MAX_TITLE = 60
MAX_DESCRIPTION = 155


class _Head(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.meta = {}
        self._in = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self._in = tag
        elif tag == "meta":
            key = a.get("name") or a.get("property")
            if key:
                self.meta[key] = a.get("content") or ""

    def handle_endtag(self, tag):
        if tag == self._in:
            self._in = None

    def handle_data(self, data):
        if self._in == "title":
            self.title += data


def parse(path):
    p = _Head()
    p.feed(path.read_text(encoding="utf-8"))
    p.title = " ".join(p.title.split())
    return p


def pages():
    return sorted(SITE.rglob("index.html")) + [SITE / "404.html"]


def indexable(head):
    return "noindex" not in head.meta.get("robots", "").lower() and "404" not in head.title


class Pattern(unittest.TestCase):
    def test_c1_title_fits_and_ends_with_brand(self):
        for path in pages():
            t = parse(path).title
            self.assertTrue(t.endswith(BRAND), f"{path.relative_to(SITE)}: {t!r}")
            self.assertLessEqual(len(t), MAX_TITLE, f"{path.relative_to(SITE)}: {len(t)} chars")

    def test_c2_description_fits(self):
        for path in pages():
            h = parse(path)
            if not indexable(h):
                continue
            d = h.meta.get("description", "")
            self.assertTrue(d, f"{path.relative_to(SITE)}: no description")
            self.assertLessEqual(len(d), MAX_DESCRIPTION, f"{path.relative_to(SITE)}: {len(d)} chars")

    def test_c3_open_graph_matches(self):
        for path in pages():
            h = parse(path)
            if not indexable(h):
                continue
            self.assertEqual(h.meta.get("og:title"), h.title, str(path.relative_to(SITE)))
            self.assertEqual(h.meta.get("og:description"), h.meta.get("description"), str(path.relative_to(SITE)))

    def test_c_borda_noindex_exempt(self):
        h = parse(SITE / "404.html")
        self.assertFalse(indexable(h))
        self.assertTrue(h.title.endswith(BRAND))


if __name__ == "__main__":
    unittest.main()
