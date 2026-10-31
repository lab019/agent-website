"""Acceptance LIC-3218: pages by use case for long-tail SEO (cobrança, agendamento, reativação, atendimento).

critério -> teste
c1 | each page follows the channel-page pattern (problem, channel/integrations/handoff, FAQ with FAQPage, CTA) and home and channel pages link it | UseCasePages::test_c1_each_page_follows_the_channel_page_pattern, ::test_c1_home_and_channel_pages_link_every_use_case
c2 | every page is in sitemap.xml | covered by test_sitemap_lastmod_lic3216 (page count 18, one <loc> per page); FAQPage by test_seo_jsonld_lic3215 (FAQ_PAGES)
c3 | text rules: "Agente" (not "especialista"), no number, price, client or vertical not approved | TextRules::test_c3_text_rules
c_borda | internal links on the new pages resolve to files in site/ | UseCasePages::test_c_borda_internal_links_resolve
c_org, c_papel: not applicable (static site, no org and no role).

Stdlib only; HTML read with HTMLParser, never regex on <script>.
"""
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
ORIGIN = "https://lab019.ai"
SLUGS = ["cobranca-whatsapp", "agendamento-confirmacao", "reativacao-de-clientes", "atendimento-whatsapp"]
CHANNEL_LINKS = {
    "whatsapp": ["atendimento-whatsapp", "cobranca-whatsapp", "agendamento-confirmacao", "reativacao-de-clientes"],
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
    def test_c1_each_page_follows_the_channel_page_pattern(self):
        for slug in SLUGS:
            with self.subTest(page=slug):
                self.assertTrue(path_of(slug).is_file(), "missing page")
                p = load(slug)
                self.assertEqual(p.canonical, "%s/%s/" % (ORIGIN, slug))
                self.assertEqual(p.h1, 1)
                hrefs = set(p.hrefs)
                self.assertTrue(hrefs & {"/whatsapp/", "/automacoes/"}, "channel")
                self.assertIn("/integracoes/", hrefs)
                self.assertIn("/handoff/", hrefs)
                self.assertIn(APP, hrefs)
                self.assertGreaterEqual(len(p.faq), 3)
                self.assertTrue(any('"FAQPage"' in body for body in p.ld), "FAQPage JSON-LD")

    def test_c1_home_and_channel_pages_link_every_use_case(self):
        self.assertTrue(set("/%s/" % s for s in SLUGS) <= set(load("").hrefs), "home")
        for channel, slugs in CHANNEL_LINKS.items():
            with self.subTest(channel=channel):
                self.assertTrue(set("/%s/" % s for s in slugs) <= set(load(channel).hrefs))

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


class TextRules(unittest.TestCase):
    def test_c3_text_rules(self):
        claim = re.compile(r"(?i)nossos clientes|depoimento|case de sucesso|resultados? garantid|\bgarant[ie]")
        for slug in SLUGS:
            with self.subTest(page=slug):
                src = path_of(slug).read_text(encoding="utf-8")
                text = " ".join(load(slug).main.split())
                self.assertRegex(text, r"\bAgente\b")
                self.assertNotRegex(text, r"(?i)especialista")
                self.assertNotIn("R$", text)
                self.assertNotIn("%", text)
                self.assertNotIn("{{", src)
                self.assertIsNone(VERTICALS.search(src))
                self.assertIsNone(claim.search(src))


if __name__ == "__main__":
    unittest.main()
