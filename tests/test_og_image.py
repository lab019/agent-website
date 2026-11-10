"""Aceite da imagem de prévia de link (og-image): preço do billing, título e apoio da home, selos, fonte no repo, cache e preço antigo.

Somente stdlib. Rodar: python3 -m unittest discover -s tests
"""
import io
import json
import re
import struct
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import render_og_image  # noqa: E402
import render_pricing  # noqa: E402

SITE = ROOT / "site"
PLAN = {"plan_id": "base", "price_brl_cents": 13700, "currency": "BRL", "trial_credits": 5000000, "fx_brl_per_usd": "4.000000"}
OLD_PRICE = re.compile(r"R\$(?:\s|&nbsp;| )*(?:1?25)(?!\d)")


class FakeResponse(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def plan_opener(plan):
    return lambda request, timeout=None: FakeResponse(json.dumps(plan).encode())


def down_opener(request, timeout=None):
    raise OSError("billing down")


def og_refs():
    refs = []
    for page in sorted(SITE.rglob("*.html")):
        refs += [(page, v) for v in re.findall(r"og-image\.png\?v=(\w+)", page.read_text(encoding="utf-8"))]
    return refs


class OgImageTests(unittest.TestCase):
    def test_imagem_traz_preco_e_creditos_do_billing_e_falha_sem_billing(self):
        # Critério 1: valor e créditos vêm do billing; sem billing não troca o PNG.
        home = (SITE / "index.html").read_text(encoding="utf-8")
        page = render_og_image.render_html(render_og_image.TEMPLATE.read_text(encoding="utf-8"), {
            **render_pricing.build_config(PLAN), "headline_html": render_og_image.headline_html(home), "support_line": render_og_image.support_line(home),
            "eyebrow": render_og_image.eyebrow_text(home)})
        self.assertEqual(page.count("R$ 137"), 2)
        self.assertNotRegex(page, OLD_PRICE)
        png = (SITE / "assets" / "og-image.png").read_bytes()
        self.assertEqual(struct.unpack(">II", png[16:24]), (1200, 630))
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "assets").mkdir()
            target = Path(tmp) / "assets" / "og-image.png"
            target.write_bytes(b"antigo")
            self.assertEqual(render_og_image.main(["x", tmp], env={}, opener=down_opener), 1)
            self.assertEqual(target.read_bytes(), b"antigo")

    def test_fonte_da_imagem_fica_no_repo_e_o_deploy_redesenha(self):
        # Critério 2: HTML + script de render no repo; o deploy chama o script depois do preço.
        self.assertTrue(render_og_image.TEMPLATE.is_file())
        self.assertTrue((ROOT / "scripts" / "render_og_image.py").is_file())
        deploy = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        self.assertIn("python3 scripts/render_og_image.py site", deploy)
        self.assertLess(deploy.index("render_pricing.py site"), deploy.index("render_og_image.py site"))
        self.assertNotRegex(render_og_image.TEMPLATE.read_text(encoding="utf-8"), r"R\$\s*\d")

    def test_todas_as_paginas_apontam_a_versao_4_da_imagem(self):
        # Critérios 3 e 9: cache do WhatsApp/Facebook renovado em todas as páginas e no JSON-LD.
        refs = og_refs()
        self.assertGreaterEqual(len(refs), 30)
        self.assertEqual({v for _, v in refs}, {"4"})

    def test_titulo_e_apoio_da_imagem_vem_do_hero_da_home_e_o_build_falha_sem_h1(self):
        # Critérios 6 e 7: eyebrow, <h1> (com o destaque) e .hero-sub da home viram título e apoio; sem <h1> falha sem trocar o PNG.
        home = (SITE / "index.html").read_text(encoding="utf-8")
        self.assertEqual(render_og_image.headline_html(home), 'Agentes de IA para operações que <span class="accent">exigem controle.</span>')
        self.assertEqual(render_og_image.eyebrow_text(home), "Plataforma de agentes de IA para empresas")
        support = render_og_image.support_line(home)
        self.assertTrue(support.startswith("Atenda por <strong>WhatsApp</strong> e <strong>telefone</strong>, execute rotinas"))
        self.assertLessEqual(len(re.sub(r"<[^>]*>", "", support)), render_og_image.SUPPORT_MAX_CHARS)
        page = render_og_image.render_html(render_og_image.TEMPLATE.read_text(encoding="utf-8"), {
            **render_pricing.build_config(PLAN), "headline_html": render_og_image.headline_html(home), "support_line": support, "eyebrow": render_og_image.eyebrow_text(home)})
        self.assertIn("exigem controle.</span></h1>", page)
        self.assertNotIn("a preço de gente", page)
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "assets").mkdir()
            target = Path(tmp) / "assets" / "og-image.png"
            target.write_bytes(b"antigo")
            (Path(tmp) / "index.html").write_text("<html><body><p>sem titulo</p></body></html>", encoding="utf-8")
            self.assertEqual(render_og_image.main(["x", tmp], env={}, opener=plan_opener(PLAN)), 1)
            self.assertEqual(target.read_bytes(), b"antigo")

    def test_imagem_so_tem_o_que_o_hero_da_home_tem(self):
        # Critério 8: sem selos de modelo na imagem (o hero da home não tem); só marca, preço (billing), eyebrow, título e apoio.
        template = render_og_image.TEMPLATE.read_text(encoding="utf-8")
        self.assertNotIn("pill", template)
        for name in ("Sabiá", "Claude", "Gemini", "GPT"):
            self.assertNotIn(name, template)
        hero = (SITE / "index.html").read_text(encoding="utf-8").split("<h1>")[0].split("hero-grid")[-1]
        self.assertNotRegex(hero, r"Sabiá|Claude|Gemini|GPT")

    def test_meta_de_compartilhamento_sem_preco_antigo(self):
        # Critério 4: og:*/twitter:*/description das páginas sem o R$25 (ou R$125 escrito) do preço antigo.
        metas = re.compile(r'<meta\s+(?:property|name)="(?:og|twitter):[^"]*"\s+content="([^"]*)"|<meta\s+name="description"\s+content="([^"]*)"')
        for page in sorted(SITE.rglob("*.html")):
            for groups in metas.findall(page.read_text(encoding="utf-8")):
                self.assertNotRegex("".join(groups), OLD_PRICE, str(page))


if __name__ == "__main__":
    unittest.main()
