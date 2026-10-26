"""Aceite LIC-2808: site inteiro v3.1 (home, paginas novas, menu, valores, escopo).

Somente stdlib. Rodar: python3 -m unittest discover -s tests
"""
import html
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
MOCK_PAGES = ["", "preco", "especialistas", "handoff", "integracoes",
              "modelos", "voz", "whatsapp", "automacoes", "seguranca"]
TAGLINE = "Automação com controle, do primeiro teste à operação."
BRAND = ("Agentes de IA para atendimento e operação, com controles para "
         "evoluir cada processo. Nascido em Campinas, feito para o Brasil.")
FIXED_VALUES = re.compile(
    r"R\$(?:\s|&nbsp;|&#160;|&#xa0;| )*(?:125|25|95|490|2\.490)(?![\d.,]*\d)",
    re.I)
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}


def page_path(slug):
    return SITE / slug / "index.html" if slug else SITE / "index.html"


def read(slug):
    return page_path(slug).read_text(encoding="utf-8")


class Doc(HTMLParser):
    def __init__(self, raw):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.h1 = []
        self.ids = set()
        self.classes = []
        self.nav_anchors = []   # (href, text) inside <nav class="nav-links...">
        self.visible = []
        self._stack = []        # (tag, hidden)
        self._in = None
        self._nav_depth = None
        self._cur_a = None
        self.feed(raw)

    def _hidden(self):
        return any(h for _, h in self._stack)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.ids.add(a["id"])
        if a.get("class"):
            self.classes.append(a["class"])
        if tag in VOID:
            return
        self._stack.append((tag, "hidden" in a))
        if tag in ("title", "h1", "script", "style"):
            self._in = tag
            if tag == "h1":
                self.h1.append("")
        if tag == "nav" and "nav-links" in (a.get("class") or "") \
                and self._nav_depth is None:
            self._nav_depth = len(self._stack)
        if tag == "a" and self._nav_depth is not None:
            self._cur_a = [a.get("href"), ""]

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag == "a" and self._cur_a:
            self.nav_anchors.append(tuple(self._cur_a))
            self._cur_a = None
        if tag == "nav" and self._nav_depth == len(self._stack):
            self._nav_depth = None
        if tag == self._in:
            self._in = None
        while self._stack:
            if self._stack.pop()[0] == tag:
                break

    def handle_data(self, data):
        if self._in == "title":
            self.title += data
        elif self._in == "h1":
            self.h1[-1] += data
        elif self._in in ("script", "style"):
            return
        if self._cur_a:
            self._cur_a[1] += data
        if not self._hidden():
            self.visible.append(data)

    def visible_text(self):
        return " ".join(" ".join(self.visible).split())


def norm(s):
    return " ".join(s.split())


class HomeContent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = read("")
        cls.doc = Doc(cls.raw)

    def test_title_is_the_v31_positioning(self):
        self.assertEqual(
            norm(self.doc.title),
            "Lab019 — Agentes de IA para operações que exigem controle")

    def test_h1_states_the_positioning(self):
        self.assertIn("Agentes de IA para operações que exigem controle.",
                      [norm(h) for h in self.doc.h1])

    def test_home_has_enterprise_offer_with_child_accounts(self):
        self.assertTrue(any("plan--enterprise" in c for c in self.doc.classes))
        self.assertIn("Enterprise com contas-filhas", self.doc.visible_text())

    def test_home_has_automations_and_governance_sections(self):
        self.assertIn("automacoes", self.doc.ids)
        self.assertIn("governanca", self.doc.ids)

    def test_home_does_not_show_tiers_openly(self):
        text = self.doc.visible_text()
        for tier in ("Starter", "Growth"):
            self.assertNotIn(tier, text)


class NewPages(unittest.TestCase):
    def test_new_pages_exist_with_h1(self):
        for slug in ("automacoes", "seguranca"):
            with self.subTest(slug=slug):
                self.assertTrue(page_path(slug).is_file(), f"missing {slug}")
                self.assertTrue(any(norm(h) for h in Doc(read(slug)).h1))

    def test_new_pages_listed_in_sitemap(self):
        sitemap = (SITE / "sitemap.xml").read_text(encoding="utf-8")
        for url in ("https://lab019.ai/automacoes/",
                    "https://lab019.ai/seguranca/"):
            with self.subTest(url=url):
                self.assertRegex(sitemap, r"<loc>\s*" + re.escape(url) + r"\s*</loc>")


class MenuAndFooter(unittest.TestCase):
    def test_every_mock_page_nav_links_automations_and_security(self):
        for slug in MOCK_PAGES:
            with self.subTest(page="/" + slug):
                nav = {(h, norm(t)) for h, t in Doc(read(slug)).nav_anchors}
                target = "/automacoes/"
                self.assertIn((target, "Automações"), nav)
                self.assertIn(("/seguranca/", "Segurança"), nav)

    def test_footer_tagline_on_every_mock_page(self):
        for slug in MOCK_PAGES:
            with self.subTest(page="/" + slug):
                self.assertIn(TAGLINE, norm(html.unescape(read(slug))))

    def test_footer_brand_sentence_on_preco(self):
        self.assertIn(BRAND, norm(html.unescape(read("preco"))))


class NoFixedValues(unittest.TestCase):
    def test_no_fixed_price_franchise_trial_or_tier_literal_outside_en(self):
        files = [p for p in SITE.rglob("*.html") if "en" not in
                 p.relative_to(SITE).parts[:1]]
        self.assertTrue(files)
        for p in files:
            with self.subTest(file=str(p.relative_to(SITE))):
                found = FIXED_VALUES.findall(html.unescape(
                    p.read_text(encoding="utf-8")))
                self.assertEqual(found, [])

    def test_home_uses_billing_tokens(self):
        raw = read("")
        for tok in ("{{plan_price|", "{{plan_franchise|", "{{trial_credit|"):
            with self.subTest(token=tok):
                self.assertIn(tok, raw)

    def test_whatsapp_uses_plan_price_token(self):
        self.assertIn("{{plan_price|", read("whatsapp"))

    def test_deploy_still_renders_pricing_on_site(self):
        deploy = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(
            encoding="utf-8")
        self.assertIn("scripts/render_pricing.py site", deploy)


class TiersBehindFlag(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = read("preco")

    def test_capacity_section_is_hidden_and_marked_pos_enforcement(self):
        m = re.search(r'<section\b[^>]*\bid="capacidade"[^>]*>', self.raw)
        self.assertIsNotNone(m)
        tag = m.group(0)
        self.assertRegex(tag, r"\shidden(\s|>|=)")
        self.assertIn("data-pos-enforcement", tag)

    def test_script_reveals_capacity_only_for_niveis_query(self):
        self.assertRegex(self.raw, r"niveis=1")
        self.assertRegex(self.raw, r"location\.search")
        self.assertRegex(self.raw, r"capacidade|data-pos-enforcement")


class ScopeGuards(unittest.TestCase):
    def test_en_has_only_privacy_and_terms(self):
        self.assertEqual(sorted(p.name for p in (SITE / "en").iterdir()),
                         ["privacy", "terms"])

    def test_no_consolidated_statement_anywhere(self):
        for p in SITE.rglob("*.html"):
            with self.subTest(file=str(p.relative_to(SITE))):
                self.assertNotIn("extrato consolidado",
                                 html.unescape(p.read_text(encoding="utf-8")).lower())


if __name__ == "__main__":
    unittest.main()


class PagesFollowMock(unittest.TestCase):
    """As paginas que o mock reescreve (especialistas, integracoes, modelos)
    trazem o h1 e a meta description do mock, nao os da main anterior."""
    EXPECTED = {
        "especialistas": (
            "Especialistas de IA com funções e ferramentas definidas.",
            None),
        "integracoes": (
            None,
            "Conecte agentes da Lab019 a ferramentas e sistemas via MCP e APIs, "
            "com escopo de acesso, credenciais protegidas e aprovação "
            "configurável para ações sensíveis."),
        "modelos": (
            "Modelos de IA para cada fluxo. Com escolha sob seu controle.",
            "Escolha automática ou fixa entre modelos de IA, incluindo Sabiá-4, "
            "Claude, Gemini, GPT e DeepSeek. Avalie custo, desempenho e o fluxo "
            "de dados de cada processo."),
    }

    def test_rewritten_pages_carry_mock_h1_and_description(self):
        for slug, (h1, desc) in self.EXPECTED.items():
            with self.subTest(page="/" + slug):
                text = html.unescape(read(slug))
                if h1:
                    self.assertEqual([norm(x) for x in Doc(read(slug)).h1], [h1])
                if desc:
                    self.assertIn('content="%s"' % desc, norm(text))

    def test_modelos_has_no_priority_selector_claim(self):
        text = norm(html.unescape(read("modelos"))).lower()
        for gone in ("equilibrado", "priorizar custo"):
            self.assertNotIn(gone, text)

    def test_no_page_says_the_plan_includes_a_number(self):
        for slug in MOCK_PAGES:
            raw = re.sub(r"<[^>]+>", "", read(slug))
            text = norm(html.unescape(raw)).lower()
            for phrase in ("plano padrão inclui um número",
                           "inclui um número de telefone"):
                self.assertNotIn(phrase, text, f"/{slug}: {phrase}")
