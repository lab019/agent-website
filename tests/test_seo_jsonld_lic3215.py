"""Acceptance LIC-3215: structured data (JSON-LD) and Open Graph on lab019.ai.

Scope: only <head> and JSON-LD; visible text does not change.
c_org and c_papel do not apply: static site, no org and no role.
Stdlib only, no network. Run: python3 -m unittest tests.test_seo_jsonld_lic3215 -v
"""
import html
import json
import re
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
sys.path.insert(0, str(ROOT / "scripts"))

import render_pricing  # noqa: E402

PLAN = {
    "plan_id": "base",
    "price_brl_cents": 13700,
    "currency": "BRL",
    "trial_credits": 5000000,
    "fx_brl_per_usd": "4.000000",
}
OTHER_PLAN = dict(PLAN, price_brl_cents=9990, trial_credits=7500000, fx_brl_per_usd="5.000000")

# Only what is written in a Lab019 file. LinkedIn/Instagram enter when Marcelino
# provides the URLs; never invent.
ALLOWED_SAMEAS = {"https://github.com/lab019"}

HOME = SITE / "index.html"
PRICING = SITE / "preco" / "index.html"
FAQ_PAGES = ["", "automacoes", "especialistas", "handoff", "integracoes", "modelos", "preco", "voz", "whatsapp"]
NO_FAQ_PAGES = ["seguranca", "privacidade", "termos", "en/privacy", "en/terms"]
LEGAL = ["privacidade", "termos", "en/privacy", "en/terms"]
VIDEOS = {
    "": ("agente-aura.jpg", "agente-aura.mp4"),
    "handoff": ("handoff.jpg", "handoff.mp4"),
    "voz": ("voz-handoff.jpg", "voz-handoff.mp4"),
}
TOKEN_ANY = re.compile(r"\{\{")
PRICE_TOKEN = re.compile(r"^\{\{plan_price_number\|[^}]*\}\}$")


def page_path(slug):
    return SITE / slug / "index.html" if slug else HOME


def read(slug):
    return page_path(slug).read_text(encoding="utf-8")


def rendered(src, plan=PLAN):
    return render_pricing.render(src, render_pricing.build_config(plan))


def all_pages():
    return sorted(SITE.rglob("index.html"))


class Page(HTMLParser):
    """Collects JSON-LD blocks, meta, canonical, video poster and visible FAQ."""

    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.ld, self.ld_in_body = [], 0
        self.meta, self.canonical, self.posters = {}, None, []
        self.faq = []
        self._in_head = self._in_body = False
        self._ld_open = False
        self._faq_depth = 0
        self._cur = None
        self._field = None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "head":
            self._in_head = True
        elif tag == "body":
            self._in_head, self._in_body = False, True
        elif tag == "script" and a.get("type") == "application/ld+json":
            self._ld_open = True
            self.ld.append("")
            if self._in_body:
                self.ld_in_body += 1
        elif tag == "meta" and a.get("property"):
            self.meta[a["property"]] = a.get("content")
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        elif tag == "video" and a.get("poster"):
            self.posters.append(a["poster"])
        elif tag == "div":
            if self._faq_depth:
                self._faq_depth += 1
            elif "faq" in (a.get("class") or "").split():
                self._faq_depth = 1
        elif tag == "details" and self._faq_depth:
            self._cur = {"q": "", "a": ""}
            self.faq.append(self._cur)
        elif tag == "summary" and self._cur is not None:
            self._field = "q"
        elif tag == "p" and self._cur is not None:
            self._field = "a"

    def handle_endtag(self, tag):
        if tag == "head":
            self._in_head = False
        elif tag == "script":
            self._ld_open = False
        elif tag == "div" and self._faq_depth:
            self._faq_depth -= 1
        elif tag == "details":
            self._cur = None
            self._field = None
        elif tag in ("summary", "p"):
            self._field = None

    def _data(self, data):
        if self._ld_open:
            self.ld[-1] += data
        elif self._cur is not None and self._field:
            self._cur[self._field] += data

    def handle_data(self, data):
        self._data(data)

    def handle_entityref(self, name):
        self._data("&%s;" % name)

    def handle_charref(self, name):
        self._data("&#%s;" % name)


def norm(text):
    return " ".join(html.unescape(text).split())


def entities(src):
    """Flatten every JSON-LD block (object, list or @graph) into a list of entities."""
    out = []

    def add(node):
        if isinstance(node, list):
            for n in node:
                add(n)
        elif isinstance(node, dict):
            if "@graph" in node:
                add(node["@graph"])
            else:
                out.append(node)

    for body in Page(src).ld:
        add(json.loads(body))
    return out


def of_type(src, kind):
    def match(e):
        t = e.get("@type")
        return kind in t if isinstance(t, list) else t == kind
    return [e for e in entities(src) if match(e)]


def one(src, kind):
    found = of_type(src, kind)
    assert len(found) == 1, "expected exactly one %s, found %d" % (kind, len(found))
    return found[0]


def asset_exists(url, prefix="https://lab019.ai/assets/"):
    assert isinstance(url, str) and url.startswith(prefix), url
    rel = url.split("?")[0][len("https://lab019.ai/"):]
    return (SITE / rel).is_file()


class C1Home(unittest.TestCase):
    def test_c1_home_has_organization_with_logo_and_confirmed_sameas(self):
        org = one(read(""), "Organization")
        self.assertEqual(org.get("name"), "Lab019")
        self.assertEqual(org.get("url"), "https://lab019.ai/")
        self.assertTrue(asset_exists(org.get("logo")), org.get("logo"))
        same = org.get("sameAs")
        self.assertTrue(isinstance(same, list) and same)
        for u in same:
            self.assertTrue(u.startswith("https://"), u)
            self.assertIn(u, ALLOWED_SAMEAS)

    def test_c1_home_has_website_with_name_and_url(self):
        site = one(read(""), "WebSite")
        self.assertTrue(site.get("name"))
        self.assertEqual(site.get("url"), "https://lab019.ai/")


class C2Pricing(unittest.TestCase):
    PRICING_URL = "https://lab019.ai/preco/"

    def _offer(self, src):
        return one(src, "Product").get("offers")

    def test_c2_pricing_has_product_with_brl_offer(self):
        product = one(read("preco"), "Product")
        self.assertTrue(product.get("name"))
        self.assertTrue(product.get("description"))
        self.assertEqual(product.get("url"), self.PRICING_URL)
        image = product.get("image")
        self.assertIsInstance(image, str)
        self.assertTrue(asset_exists(image), image)
        offer = product.get("offers")
        self.assertIsInstance(offer, dict)
        self.assertEqual(offer.get("@type"), "Offer")
        self.assertEqual(offer.get("priceCurrency"), "BRL")
        self.assertEqual(offer.get("url"), self.PRICING_URL)
        self.assertEqual(offer.get("availability"), "https://schema.org/InStock")

    def test_c2_product_only_on_pricing_page(self):
        for path in all_pages():
            slug = path.parent.relative_to(SITE).as_posix()
            expected = 1 if slug == "preco" else 0
            with self.subTest(page=slug):
                self.assertEqual(len(of_type(path.read_text(encoding="utf-8"), "Product")), expected)

    def test_c2_no_software_application_and_no_invented_ratings(self):
        def keys(node):
            if isinstance(node, dict):
                for k, v in node.items():
                    yield k
                    yield from keys(v)
            elif isinstance(node, list):
                for v in node:
                    yield from keys(v)

        for path in all_pages():
            page = str(path.relative_to(SITE))
            src = path.read_text(encoding="utf-8")
            self.assertEqual(of_type(src, "SoftwareApplication"), [], page)
            for body in Page(src).ld:
                found = {"aggregateRating", "review"} & set(keys(json.loads(body)))
                self.assertFalse(found, "%s has %s" % (page, sorted(found)))

    def test_c2_raw_price_is_a_token_with_non_numeric_fallback(self):
        price = self._offer(read("preco")).get("price")
        self.assertIsInstance(price, str)
        self.assertRegex(price, PRICE_TOKEN)
        self.assertFalse(re.search(r"\d", price.split("|", 1)[1]), price)

    def test_c2_build_config_has_plan_price_number(self):
        self.assertEqual(render_pricing.build_config(PLAN).get("plan_price_number"), "137.00")
        self.assertEqual(render_pricing.build_config(OTHER_PLAN).get("plan_price_number"), "99.90")

    def test_c2_rendered_price_follows_the_plan(self):
        src = read("preco")
        self.assertEqual(self._offer(rendered(src, PLAN)).get("price"), "137.00")
        self.assertEqual(self._offer(rendered(src, OTHER_PLAN)).get("price"), "99.90")


class C3Faq(unittest.TestCase):
    def _compare(self, slug, src):
        visible = [(norm(i["q"]), norm(i["a"])) for i in Page(src).faq]
        self.assertTrue(visible, slug)
        faqs = of_type(src, "FAQPage")
        self.assertEqual(len(faqs), 1, "%s: FAQPage count" % slug)
        main = faqs[0].get("mainEntity")
        self.assertIsInstance(main, list)
        got = []
        for q in main:
            self.assertEqual(q.get("@type"), "Question")
            ans = q.get("acceptedAnswer") or {}
            self.assertEqual(ans.get("@type"), "Answer")
            self.assertNotIn("<", ans.get("text", ""))
            got.append((norm(q.get("name", "")), norm(ans.get("text", ""))))
        self.assertEqual(got, visible, slug)

    def test_c3_faqpage_matches_visible_faq_with_raw_tokens(self):
        for slug in FAQ_PAGES:
            with self.subTest(page=slug or "home"):
                self._compare(slug, read(slug))

    def test_c3_faqpage_matches_visible_faq_after_render(self):
        for slug in FAQ_PAGES:
            with self.subTest(page=slug or "home"):
                self._compare(slug, rendered(read(slug)))


class C4Videos(unittest.TestCase):
    def test_c4_each_video_page_has_videoobject_for_its_poster_and_mp4(self):
        seen = []
        for slug, (poster, mp4) in VIDEOS.items():
            with self.subTest(page=slug or "home"):
                src = read(slug)
                v = one(src, "VideoObject")
                self.assertTrue(v.get("name") and v.get("description"))
                seen.append((v["name"], v["description"]))
                thumb = "https://lab019.ai/assets/videos/" + poster
                self.assertEqual(v.get("thumbnailUrl"), thumb)
                self.assertTrue(asset_exists(thumb))
                page_poster = Page(src).posters[0]
                self.assertEqual(page_poster.lstrip("/").split("?")[0], "assets/videos/" + poster)
                self.assertRegex(v.get("uploadDate", ""), r"^\d{4}-\d{2}-\d{2}$")
                content = "https://lab019.ai/assets/videos/" + mp4
                self.assertEqual(v.get("contentUrl"), content)
                self.assertTrue(asset_exists(content))
        self.assertEqual(len(seen), 3)
        self.assertEqual(len({n for n, _ in seen}), 3)
        self.assertEqual(len({d for _, d in seen}), 3)


class C5LegalOpenGraph(unittest.TestCase):
    def test_c5_legal_pages_have_complete_open_graph(self):
        for slug in LEGAL:
            with self.subTest(page=slug):
                p = Page(read(slug))
                for prop in ("og:title", "og:description", "og:image", "og:url"):
                    self.assertTrue(p.meta.get(prop), prop)
                self.assertTrue(p.canonical)
                self.assertEqual(p.meta["og:url"], p.canonical)
                self.assertTrue(asset_exists(p.meta["og:image"]), p.meta["og:image"])


class Edges(unittest.TestCase):
    def test_c_vazio_only_the_nine_faq_pages_have_faqpage(self):
        for slug in NO_FAQ_PAGES:
            with self.subTest(page=slug):
                self.assertEqual(of_type(read(slug), "FAQPage"), [])
        for path in all_pages():
            slug = path.parent.relative_to(SITE).as_posix()
            slug = "" if slug == "." else slug
            if slug in FAQ_PAGES:
                continue
            with self.subTest(page=slug):
                self.assertEqual(of_type(path.read_text(encoding="utf-8"), "FAQPage"), [])

    def test_c_vazio_the_nine_faq_pages_do_have_faqpage(self):
        for slug in FAQ_PAGES:
            with self.subTest(page=slug or "home"):
                self.assertEqual(len(of_type(read(slug), "FAQPage")), 1)

    def test_c_falha_every_block_is_valid_safe_and_in_head(self):
        total = 0
        for path in all_pages():
            raw = path.read_text(encoding="utf-8")
            for state, src in (("raw", raw), ("rendered", rendered(raw))):
                p = Page(src)
                total += len(p.ld)
                with self.subTest(page=str(path.relative_to(SITE)), state=state):
                    self.assertEqual(p.ld_in_body, 0)
                    if state == "rendered":
                        self.assertNotRegex(src, TOKEN_ANY)
                    for body in p.ld:
                        data = json.loads(body)
                        self.assertNotIn("</", body)
                        self.assertNotIn("<script", body)
                        for e in (data if isinstance(data, list) else [data]):
                            self.assertEqual(e.get("@context"), "https://schema.org")
        self.assertGreater(total, 0, "no JSON-LD anywhere")

    def test_c_repete_render_is_idempotent(self):
        for path in all_pages():
            once = rendered(path.read_text(encoding="utf-8"))
            with self.subTest(page=str(path.relative_to(SITE))):
                self.assertEqual(rendered(once), once)

    def test_c_repete_each_entity_type_appears_once_per_page(self):
        found = 0
        for path in all_pages():
            src = path.read_text(encoding="utf-8")
            for kind in ("Organization", "WebSite", "Product", "VideoObject"):
                n = len(of_type(src, kind))
                found += n
                with self.subTest(page=str(path.relative_to(SITE)), kind=kind):
                    self.assertLessEqual(n, 1)
        self.assertGreater(found, 0, "no entity found")


if __name__ == "__main__":
    unittest.main()
