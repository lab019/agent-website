"""Acceptance LIC-3218: pages by use case for long-tail SEO (cobrança, agendamento, reativação, atendimento).

critério -> teste
c1 | each use-case page exists, has its canonical and exactly one H1 | UseCasePages::test_c1_page_has_canonical_and_one_h1
c2 | each page explains problem, how the Agent solves it (channel, integrations, handoff) and has a FAQ with FAQPage JSON-LD | UseCasePages::test_c2_page_links_channel_integrations_and_handoff, ::test_c2_faq_has_visible_questions_and_faqpage
c3 | each page has a CTA to app.lab019.ai | UseCasePages::test_c3_page_has_cta_to_app
c4 | home and channel pages link to the use-case pages | InternalLinks::test_c4_home_links_every_page, ::test_c4_channel_pages_link_their_use_cases
c5 | every indexable page is in sitemap.xml | Sitemap::test_c5_sitemap_lists_every_page
c6 | text rules: "Agente" (not "especialista"), no number, price, client or vertical not approved | TextRules::test_c6_*
c_borda | internal links on the new pages resolve to files in site/ | UseCasePages::test_c_borda_internal_links_resolve
c_org, c_papel: not applicable (static site, no org and no role).

Stdlib only; HTML read with HTMLParser, never regex on <script>.
"""
import re
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
ORIGIN = "https://lab019.ai"
SLUGS = ["cobranca-whatsapp", "agendamento-confirmacao", "reativacao-de-clientes", "atendimento-whatsapp"]
CHANNEL_LINKS = {
    "whatsapp": ["atendimento-whatsapp", "cobranca-whatsapp", "reativacao-de-clientes"],
    "automacoes": ["cobranca-whatsapp", "agendamento-confirmacao", "reativacao-de-clientes"],
}
APP = "https://app.lab019.ai"
# Not approved by Marcelino for this first batch; the site has no text for them.
VERTICALS = re.compile(r"cl[ií]nica|imobili[aá]ri|feegow|consult[oó]rio", re.I)


class Page(HTMLParser):
    def __init__(self, src):
        super().__init__()
        self.canonical = None
        self.h1 = 0
        self.hrefs = []
        self.faq = []
        self.ld = []
        self.main = ""
        self._main = 0
        self._ld = None
        self._summary = False
        self._answer = False
        self._cur = None
        self.feed(src)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        elif tag == "h1":
            self.h1 += 1
        elif tag == "a" and a.get("href"):
            self.hrefs.append(a["href"])
        elif tag == "main":
            self._main += 1
        elif tag == "script" and a.get("type") == "application/ld+json":
            self._ld = ""
        elif tag == "summary":
            self._summary = True
            self._cur = {"q": "", "a": ""}
        elif tag == "p" and self._cur is not None and not self._summary:
            self._answer = True

    def handle_endtag(self, tag):
        if tag == "main":
            self._main -= 1
        elif tag == "script" and self._ld is not None:
            self.ld.append(self._ld)
            self._ld = None
        elif tag == "summary":
            self._summary = False
        elif tag == "p":
            self._answer = False
        elif tag == "details" and self._cur is not None:
            self.faq.append(self._cur)
            self._cur = None

    def handle_data(self, data):
        if self._ld is not None:
            self._ld += data
        elif self._main > 0:
            self.main += " " + data
        if self._cur is not None:
            if self._summary:
                self._cur["q"] += data
            elif self._answer:
                self._cur["a"] += data


def path_of(slug):
    return SITE / slug / "index.html" if slug else SITE / "index.html"


def load(slug):
    return Page(path_of(slug).read_text(encoding="utf-8"))


def internal_target(href):
    href = href.split("#")[0].split("?")[0]
    if not href.startswith("/") or href.startswith("//"):
        return None
    return href


class UseCasePages(unittest.TestCase):
    def test_c1_page_has_canonical_and_one_h1(self):
        for slug in SLUGS:
            with self.subTest(page=slug):
                self.assertTrue(path_of(slug).is_file(), "missing page")
                p = load(slug)
                self.assertEqual(p.canonical, "%s/%s/" % (ORIGIN, slug))
                self.assertEqual(p.h1, 1)

    def test_c2_page_links_channel_integrations_and_handoff(self):
        for slug in SLUGS:
            with self.subTest(page=slug):
                hrefs = set(load(slug).hrefs)
                self.assertTrue(hrefs & {"/whatsapp/", "/automacoes/"}, "channel")
                self.assertIn("/integracoes/", hrefs)
                self.assertIn("/handoff/", hrefs)

    def test_c2_faq_has_visible_questions_and_faqpage(self):
        for slug in SLUGS:
            with self.subTest(page=slug):
                p = load(slug)
                self.assertGreaterEqual(len(p.faq), 3)
                self.assertTrue(any('"FAQPage"' in body for body in p.ld), "FAQPage JSON-LD")

    def test_c3_page_has_cta_to_app(self):
        for slug in SLUGS:
            with self.subTest(page=slug):
                self.assertIn(APP, load(slug).hrefs)

    def test_c_borda_internal_links_resolve(self):
        for slug in SLUGS:
            for href in load(slug).hrefs:
                target = internal_target(href)
                if target is None:
                    continue
                with self.subTest(page=slug, href=href):
                    rel = target.lstrip("/")
                    ok = (SITE / rel).is_file() or (SITE / rel / "index.html").is_file() or rel == ""
                    self.assertTrue(ok, "broken internal link")


class InternalLinks(unittest.TestCase):
    def test_c4_home_links_every_page(self):
        hrefs = set(load("").hrefs)
        for slug in SLUGS:
            with self.subTest(page=slug):
                self.assertIn("/%s/" % slug, hrefs)

    def test_c4_channel_pages_link_their_use_cases(self):
        for channel, slugs in CHANNEL_LINKS.items():
            hrefs = set(load(channel).hrefs)
            for slug in slugs:
                with self.subTest(channel=channel, page=slug):
                    self.assertIn("/%s/" % slug, hrefs)


class Sitemap(unittest.TestCase):
    def test_c5_sitemap_lists_every_page(self):
        ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
        root = ET.fromstring((SITE / "sitemap.xml").read_text(encoding="utf-8"))
        locs = {u.find(ns + "loc").text for u in root.findall(ns + "url")}
        for slug in SLUGS:
            with self.subTest(page=slug):
                self.assertIn("%s/%s/" % (ORIGIN, slug), locs)


class TextRules(unittest.TestCase):
    def _texts(self):
        for slug in SLUGS:
            yield slug, " ".join(load(slug).main.split())

    def test_c6_says_agente_never_especialista(self):
        for slug, text in self._texts():
            with self.subTest(page=slug):
                self.assertRegex(text, r"\bAgente\b")
                self.assertNotRegex(text, r"(?i)especialista")

    def test_c6_no_price_percentage_or_billing_token(self):
        for slug, text in self._texts():
            with self.subTest(page=slug):
                self.assertNotIn("R$", text)
                self.assertNotIn("%", text)
                self.assertNotIn("{{", text)
                src = path_of(slug).read_text(encoding="utf-8")
                self.assertNotIn("{{", src)

    def test_c6_no_vertical_not_approved(self):
        for slug in SLUGS:
            with self.subTest(page=slug):
                src = path_of(slug).read_text(encoding="utf-8")
                self.assertIsNone(VERTICALS.search(src))

    def test_c6_no_client_testimonial_or_result_claim(self):
        claim = re.compile(r"(?i)nossos clientes|depoimento|case de sucesso|resultados? garantid|\bgarant[ie]")
        for slug in SLUGS:
            with self.subTest(page=slug):
                self.assertIsNone(claim.search(path_of(slug).read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
