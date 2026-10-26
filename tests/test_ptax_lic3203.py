"""Aceite LIC-3203: valores em reais dos creditos sem "cerca de", com * e nota,
e pergunta da PTAX no FAQ da home e da /preco.

Somente stdlib. Rodar: python3 -m unittest discover -s tests
"""
import html
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
PAGES = {"home": SITE / "index.html", "preco": SITE / "preco" / "index.html"}
CREDIT_TOKENS = re.compile(r"\{\{(?:trial_credit|plan_franchise)\|[^}]*\}\}")


def raw(name):
    return PAGES[name].read_text(encoding="utf-8")


def text(name):
    """Texto da pagina sem tags, entidades decodificadas, espacos normalizados."""
    no_tags = re.sub(r"<[^>]+>", " ", raw(name))
    return " ".join(html.unescape(no_tags).split())


def faq_item(name):
    """O <details> do FAQ cujo summary fala da PTAX, ou None."""
    for m in re.finditer(r"<details\b[^>]*>.*?</details>", raw(name), re.S):
        if re.search(r"<summary>[^<]*PTAX", m.group(0)):
            return m.group(0)
    return None


class NoApproximation(unittest.TestCase):
    def test_no_cerca_de_or_approx_sign_anywhere_on_home_and_preco(self):
        for name in PAGES:
            with self.subTest(page=name):
                t = text(name)
                self.assertNotRegex(t, r"(?i)\bcerca de\b")
                self.assertNotIn("≈", t)
                self.assertNotIn("&asymp;", raw(name).lower())


class AsteriskAndNote(unittest.TestCase):
    def test_every_credit_value_carries_an_asterisk(self):
        for name in PAGES:
            with self.subTest(page=name):
                tokens = list(CREDIT_TOKENS.finditer(raw(name)))
                self.assertTrue(tokens, "a pagina nao usa tokens de credito")
                for m in tokens:
                    self.assertEqual(raw(name)[m.end():m.end() + 1], "*",
                                     f"sem * depois de {m.group(0)}")

    def test_footnote_with_asterisk_links_to_the_faq_question(self):
        for name in PAGES:
            with self.subTest(page=name):
                m = re.search(r'<p[^>]*\bid="nota-ptax"[^>]*>(.*?)</p>',
                              raw(name), re.S)
                self.assertIsNotNone(m, "falta a nota de rodape #nota-ptax")
                body = m.group(1)
                self.assertTrue(re.sub(r"<[^>]+>", "", body).lstrip()
                                .startswith("*"))
                self.assertRegex(body, r'href="(?:/)?#ptax"')

    def test_footnote_sits_near_the_price_block(self):
        for name in PAGES:
            with self.subTest(page=name):
                r = raw(name)
                credit = r.index('class="credit-line"')
                note = r.index('id="nota-ptax"')
                self.assertLess(abs(note - credit), 1500)


class PtaxFaq(unittest.TestCase):
    def test_faq_has_the_ptax_question_with_anchor(self):
        for name in PAGES:
            with self.subTest(page=name):
                item = faq_item(name)
                self.assertIsNotNone(item, "falta a pergunta da PTAX no FAQ")
                self.assertRegex(item, r'<details\b[^>]*\bid="ptax"')
                self.assertIn("*", re.search(r"<summary>(.*?)</summary>",
                                             item, re.S).group(1))

    def test_answer_cites_banco_central_selling_ptax_and_exchange_variation(self):
        for name in PAGES:
            with self.subTest(page=name):
                ans = " ".join(html.unescape(
                    re.sub(r"<[^>]+>", " ", faq_item(name) or "")).split())
                self.assertIn("PTAX de venda do Banco Central", ans)
                self.assertRegex(ans, r"(?i)dólar")
                self.assertRegex(ans, r"(?i)câmbio")
                self.assertRegex(ans, r"(?i)varia")


class StillNoFixedValues(unittest.TestCase):
    # aplicado depois de html.unescape: &nbsp; e &#160; ja viraram U+00A0
    FIXED = re.compile(
        r"R\$[\s\u00a0]*(?:125|25|95|490|2\.490)(?![\d.,]*\d)")

    def test_no_fixed_price_literal_on_home_and_preco(self):
        for name in PAGES:
            with self.subTest(page=name):
                self.assertEqual(self.FIXED.findall(html.unescape(raw(name))), [])

    def test_credit_tokens_still_come_from_billing(self):
        for name in PAGES:
            with self.subTest(page=name):
                self.assertRegex(raw(name), r"\{\{trial_credit\|")
                self.assertRegex(raw(name), r"\{\{plan_franchise\|")


if __name__ == "__main__":
    unittest.main()
