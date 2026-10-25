"""Aceite LIC-2808: site /preco e home na v3.1 (contrato de conteudo).

Somente stdlib. Rodar: python3 -m unittest discover -s tests
"""
import html
import re
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, unquote

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FIXTURE_PLAN = {  # billing payload: plan 137 (franchise = price), trial 5 USD x 4 = R$ 20
    "plan_id": "base",
    "price_brl_cents": 13700,
    "currency": "BRL",
    "trial_credits": 5000000,
    "fx_brl_per_usd": "4.000000",
}
PRICE_LITERAL = re.compile(r"R\$(?:\s|&nbsp;|&#160;|\u00a0)*1?25(?!\d)")


def find_price_literals(raw):
    """Price literals (old R$ 125 / R$ 25) found after decoding HTML entities."""
    return [m.group(0) for m in PRICE_LITERAL.finditer(html.unescape(raw))]


VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}


class Page(HTMLParser):
    """Coleta texto visivel (sem script/style/comentario), separando o que esta
    dentro de secao `hidden`; tambem coleta links, scripts e erros de estrutura."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.visible = []        # texto fora de secoes hidden
        self.hidden_text = []    # texto dentro de secoes hidden
        self.scripts = []
        self.links = []          # (attr, valor)
        self.hidden_sections = []  # attrs das secoes hidden
        self.problems = []
        self._stack = []
        self._skip = None
        self._hidden_depth = None
        self._buf_script = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for k in ("href", "src"):
            if a.get(k):
                self.links.append((k, a[k]))
        if tag in VOID:
            return
        self._stack.append(tag)
        if tag in ("script", "style"):
            self._skip = tag
        if "hidden" in a and self._hidden_depth is None:
            self._hidden_depth = len(self._stack)
            self.hidden_sections.append(a)

    def handle_startendtag(self, tag, attrs):
        for k, v in attrs:
            if k in ("href", "src") and v:
                self.links.append((k, v))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag in ("script", "style") and self._skip == tag:
            if tag == "script":
                self.scripts.append("".join(self._buf_script))
            self._buf_script = []
            self._skip = None
        if not self._stack or self._stack[-1] != tag:
            self.problems.append("tag de fechamento inesperada </%s> (linha %d), pilha: %s"
                                 % (tag, self.getpos()[0], self._stack[-3:]))
            if tag in self._stack:
                while self._stack and self._stack.pop() != tag:
                    pass
        else:
            self._stack.pop()
        if self._hidden_depth is not None and len(self._stack) < self._hidden_depth:
            self._hidden_depth = None

    def handle_data(self, data):
        if self._skip:
            if self._skip == "script":
                self._buf_script.append(data)
            return
        (self.hidden_text if self._hidden_depth is not None else self.visible).append(data)

    def close(self):
        super().close()
        if self._stack:
            self.problems.append("tags nao fechadas: %s" % self._stack)


def parse(rel):
    p = Page()
    p.feed((SITE / rel).read_text(encoding="utf-8"))
    p.close()
    return p


def parse_rendered(rel):
    """Parse the page rendered in memory with the fixture config (never writes to site/)."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import render_pricing
    html = (SITE / rel).read_text(encoding="utf-8")
    p = Page()
    p.feed(render_pricing.render(html, render_pricing.build_config(FIXTURE_PLAN)))
    p.close()
    return p


def text(page, hidden=False):
    return re.sub(r"\s+", " ", " ".join(page.hidden_text if hidden else page.visible))


class PrecoV31(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.preco = parse("preco/index.html")
        cls.home = parse("index.html")
        cls.wa = parse("whatsapp/index.html")
        cls.t_preco = text(cls.preco)
        cls.t_home = text(cls.home)
        cls.t_wa = text(cls.wa)

    def rendered_texts(self):
        return {"/preco": text(parse_rendered("preco/index.html")),
                "home": text(parse_rendered("index.html")),
                "whatsapp/": text(parse_rendered("whatsapp/index.html"))}

    # p1
    def test_p1_no_price_or_franchise_literal_in_site(self):
        found = []
        for f in sorted(SITE.rglob("*")):
            if not f.is_file():
                continue
            try:
                raw = f.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for lit in find_price_literals(raw):
                found.append("%s: %r" % (f.relative_to(SITE), lit))
        self.assertEqual(found, [], "price/franchise literal in site/:\n" + "\n".join(found[:20]))

    def test_p1_literal_helper_detects_entity_encoded_forms(self):
        for sample in ("R$&#xa0;125", "R$&#xA0;25", "R$ &#49;25"):
            self.assertTrue(find_price_literals(sample), "not detected: %r" % sample)
        self.assertEqual(find_price_literals("R$ 137 and R$ 1250"), [])

    def test_every_site_page_renders_without_leftover_tokens(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        import render_pricing
        pages = sorted(SITE.rglob("*.html"))
        self.assertTrue(pages, "no html pages found under site/")
        config = render_pricing.build_config(FIXTURE_PLAN)
        for f in pages:
            out = render_pricing.render(f.read_text(encoding="utf-8"), config)
            self.assertNotIn("{{", out, "%s: leftover token" % f.relative_to(SITE))

    def has(self, t, pattern, msg):
        self.assertTrue(re.search(pattern, t, re.I), msg)

    def hasnt(self, t, pattern, msg):
        m = re.search(pattern, t, re.I)
        self.assertIsNone(m, "%s (achei: %r)" % (msg, m.group(0) if m else ""))

    # 1
    def test_c01_niveis_ocultos_e_so_abrem_com_niveis_1(self):
        secs = [a for a in self.preco.hidden_sections if "data-pos-enforcement" in a]
        self.assertTrue(secs, "/preco: secao data-pos-enforcement com `hidden` ausente")
        js = " ".join(self.preco.scripts)
        self.assertRegex(js, r"niveis=1", "script deve desocultar so com ?niveis=1")
        self.hasnt(self.t_preco, r"\b(RPM|TPM|Growth)\b",
                   "texto de nivel fora da secao oculta em /preco")

    # 2
    def test_c02_teste_14_dias_creditos_sem_cartao_whatsapp_fora(self):
        rt = self.rendered_texts()
        for nome, t in (("/preco", rt["/preco"]), ("home", rt["home"])):
            self.has(t, r"14 dias", nome + ": falta '14 dias'")
            self.has(t, r"sem cart[aã]o", nome + ": falta 'sem cartão'")
        for nome, t in (("/preco", rt["/preco"]),):  # a home (main) so cita os 14 dias, sem valor
            self.has(t, r"R\$\s?20 em cr[eé]ditos", nome + ": falta 'R$ 20 em créditos' (trial da config)")
            self.has(t, r"sem cart[aã]o", nome + ": falta 'sem cartão'")
            self.has(t, r"whatsapp[^.]{0,80}(fora|n[aã]o (entra|entram|inclui|incluem|vale|valem))"
                        r"|(fora|n[aã]o inclui|n[aã]o incluem)[^.]{0,80}whatsapp",
                     nome + ": falta dizer que WhatsApp fica fora do teste")
        for s in re.split(r"(?<=[.!?])\s+", self.t_wa):
            if re.search(r"teste", s, re.I) and re.search(r"n[uú]mero", s, re.I) \
                    and re.search(r"API oficial", s, re.I):
                self.fail("whatsapp/: frase de teste promete WhatsApp: %r" % s)

    # 3
    def test_c03_sem_taxa_de_canal(self):
        for f in SITE.rglob("*.html"):
            self.assertNotRegex(f.read_text(encoding="utf-8").lower(), r"taxa de canal",
                                "'taxa de canal' em %s" % f.relative_to(SITE))

    # 4
    def test_c04_preco_do_plano_da_config_franquia_inteira_sem_95_nem_30(self):
        rt = self.rendered_texts()
        for nome, t in rt.items():
            self.has(t, r"R\$\s?137(?![\d.,]\d)", nome + ": falta o preco do plano vindo da config (R$ 137)")
            self.hasnt(t, r"R\$\s?95(?![\d.,]\d)", nome + ": sobrou 'R$ 95'")
            self.hasnt(t, r"R\$\s?30(?![\d.,]\d)", nome + ": sobrou 'R$ 30' de numero fixo")
            self.hasnt(t, r"R\$\s?125(?![\d.,]\d)", nome + ": sobrou literal antigo R$ 125")
        self.has(rt["/preco"], r"(mensalidade|R\$\s?137)[^.]{0,60}inteir[ao]|inteir[ao][^.]{0,60}(cr[eé]dito|franquia)",
                 "/preco: mensalidade inteira como franquia nao dita")

    # 5
    def test_c05_regra_de_consumo_sem_publicar_margem(self):
        t = self.t_preco
        self.has(t, r"custo do provedor", "/preco: falta 'custo do provedor'")
        self.has(t, r"margem", "/preco: falta 'margem'")
        self.has(t, r"em reais[^.]{0,60}antes (do uso|de usar)|antes (do uso|de usar)[^.]{0,60}em reais",
                 "/preco: falta 'em reais, antes do uso'")
        for nome, tx in (("/preco", self.t_preco), ("home", self.t_home), ("whatsapp/", self.t_wa)):
            self.hasnt(tx, r"margem[^.]{0,60}\d+\s?%|\d+\s?%[^.]{0,60}margem|[×x]\s?2\b|\bdobro\b|\(1\s?\+\s?m\)",
                       nome + " publica o percentual de margem")

    # 6
    def test_c06_numero_pelo_catalogo_da_carteira_sem_addon(self):
        self.has(self.t_preco, r"cat[aá]logo", "/preco: falta 'catálogo'")
        self.has(self.t_preco, r"carteira", "/preco: falta 'carteira'")
        for nome, t in (("/preco", self.t_preco), ("home", self.t_home)):
            self.hasnt(t, r"add-?on", nome + ": menciona add-on")

    # 7
    def test_c07_voz_whatsapp_byo_enterprise(self):
        t = self.t_preco
        for termo in (r"PSTN", r"transcri", r"voz sint[eé]tica", r"modelo"):
            self.has(t, termo, "/preco: voz decomposta sem '%s'" % termo)
        self.has(t, r"categorias? da Meta[^.]{0,120}marketing[^.]{0,60}utilidade[^.]{0,60}autentica[cç][aã]o[^.]{0,60}servi[cç]o",
                 "/preco: WhatsApp por categoria da Meta (marketing, utilidade, autenticacao, servico) nao dito numa frase")
        self.has(t, r"BYOK[^.]{0,120}BYO Twilio[^.]{0,60}BYO Meta.{0,200}cobra\s+10\s?%",
                 "/preco: BYOK/BYO Twilio/BYO Meta com 'cobra 10%' nao dito numa frase")
        self.has(t, r"cobra\s+10\s?%[^.]{0,80}\.\s*A exce[cç][aã]o[^.]{0,60}WhatsApp[^.]{0,40}Twilio[^.]{0,40}taxa fixa por mensagem",
                 "/preco: 10% sem a excecao do WhatsApp via BYO Twilio (taxa fixa por mensagem)")
        self.hasnt(t, r"taxa fixa por mensagem[^.]{0,80}\d", "/preco: valor numerico na taxa fixa por mensagem")
        self.has(t, r"p[oó]s-pago", "/preco: Enterprise sem 'pós-pago'")
        self.has(t, r"contas-filhas", "/preco: Enterprise sem 'contas-filhas'")

    # 8
    def test_c08_home_com_preco_da_config_sem_revenda(self):
        t = self.rendered_texts()["home"]
        for rot, pat in (("R$ 137 (plano da config)", r"R\$\s?137(?![\d.,]\d)"), ("teste 14 dias", r"14 dias")):
            self.has(t, pat, "home: falta %s" % rot)
        for nome, pg, tx in (("home", self.home, self.t_home), ("/preco", self.preco, self.t_preco)):
            self.hasnt(tx, r"revenda", nome + ": bloco/texto de Revenda")
            raw = (SITE / ("index.html" if nome == "home" else "preco/index.html")).read_text(encoding="utf-8")
            self.assertNotRegex(raw, r'(?i)(id|class)="[^"]*revenda', nome + ": id/class de Revenda")

    # 9
    def test_c09_valores_de_cambio_aproximados_no_texto_visivel(self):
        rt = self.rendered_texts()
        franquia = r"R\$\s?137(?![\d.,]\d)"   # franchise = plan price
        trial = r"R\$\s?20(?![\d.,]\d)"       # 5 USD x 4
        exemplos = [r"R\$\s?0,91", r"R\$\s?0,12", r"R\$\s?0,68", r"R\$\s?0,05", r"R\$\s?1,83"]
        for v in exemplos[1:]:
            self.has(rt["/preco"], v, "/preco: falta exemplo %s" % v)
        marca = re.compile(r"(≈|cerca de|a partir de)\s*$", re.I)
        for nome in ("/preco", "home"):
            t = rt[nome]
            self.has(t, franquia, nome + ": falta franquia renderizada (R$ 137)")
            if nome == "/preco":  # a home (main) cita o teste de 14 dias sem valor
                self.has(t, trial, nome + ": falta credito de teste renderizado (R$ 20)")
            for v in [trial] + exemplos:  # franchise == plan price, no approximation marker
                for m in re.finditer(v, t):
                    antes = t[max(0, m.start() - 12):m.start()]
                    self.assertRegex(antes, marca,
                                     "%s: %r sem '≈/cerca de/a partir de' (contexto: %r)"
                                     % (nome, m.group(0), t[max(0, m.start() - 30):m.end() + 20]))

    # 10
    def test_c10_cupom_fala_de_mensalidade_nao_de_desconto_no_consumo(self):
        for nome, t in (("/preco", self.t_preco), ("home", self.t_home)):
            self.hasnt(t, r"desconto no consumo", nome + ": cupom com 'desconto no consumo'")
        frases = [s for s in re.split(r"(?<=[.!?])\s+", self.t_preco) if re.search(r"cupom", s, re.I)]
        self.assertTrue(any(re.search(r"mensalidade", s, re.I) for s in frases),
                        "/preco: FAQ de cupom nao fala de 'mensalidade'")

    # 11
    def test_c11_html_valido_links_e_sitemap(self):
        problemas = []
        for f in sorted(SITE.rglob("*.html")):
            rel = f.relative_to(SITE)
            p = Page()
            p.feed(f.read_text(encoding="utf-8"))
            p.close()
            problemas += ["%s: %s" % (rel, x) for x in p.problems]
            for _, v in p.links:
                u = urlparse(v)
                if u.scheme or v.startswith(("//", "#", "mailto:", "tel:", "javascript:", "data:")) or not u.path:
                    continue
                alvo = SITE / u.path.lstrip("/") if u.path.startswith("/") else (f.parent / unquote(u.path))
                if alvo.is_dir():
                    alvo = alvo / "index.html"
                if not alvo.exists():
                    problemas.append("%s: link/asset nao resolve: %s" % (rel, v))
        base = {"", "modelos/", "whatsapp/", "voz/", "especialistas/",
                "integracoes/", "handoff/", "preco/", "privacidade/", "termos/", "en/privacy/", "en/terms/"}
        locs = set(re.findall(r"<loc>https://lab019\.ai/([^<]*)</loc>",
                              (SITE / "sitemap.xml").read_text(encoding="utf-8")))
        faltam = base - locs
        if faltam:
            problemas.append("sitemap perdeu URL(s): %s" % sorted(faltam))
        self.assertEqual(problemas, [], "\n".join(problemas[:20]))


if __name__ == "__main__":
    unittest.main()
