"""LIC-3178 c2: /preco has no fixed monetary value in the consumption and tier-rules text."""
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

PAGE = Path(__file__).resolve().parent.parent / "site" / "preco" / "index.html"
MONEY = re.compile(r"(R\$|US\$)\s*(&nbsp;|&#160;| )?\s*\d")


def inner(raw, open_re):
    """Return the balanced inner HTML of the first div/section matching open_re."""
    m = re.search(open_re, raw)
    assert m, "block not found: %s" % open_re
    tag = re.match(r"<(\w+)", m.group(0)).group(1)
    depth, pos = 1, m.end()
    for t in re.finditer(r"<(/?)%s\b[^>]*>" % tag, raw[pos:]):
        depth += -1 if t.group(1) else 1
        if depth == 0:
            return raw[m.start():pos + t.end()]
    raise AssertionError("unbalanced block")


class PrecoSemValorEditorial(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = PAGE.read_text(encoding="utf-8")
        cls.consumo = inner(raw, r'<section id="consumo"[^>]*>')
        cls.rules = inner(raw, r'<div class="cap-rules[^"]*"[^>]*>')
        cls.raw = raw

    def test_consumo_has_no_money_value_or_fx_hypothesis(self):
        self.assertNotRegex(self.consumo, MONEY)
        self.assertNotRegex(self.consumo, r"por\s+US\$")

    def test_consumo_keeps_cost_margin_fx_rule(self):
        low = self.consumo.lower()
        for word in ("custo", "margem", "câmbio", "painel"):
            self.assertIn(word, low)

    def test_tier_rules_have_no_money_value(self):
        self.assertNotRegex(self.rules, MONEY)
        self.assertNotIn("Acima de R$", self.rules)

    def test_tier_rules_keep_tier_names_and_stay_hidden(self):
        for name in ("Growth", "Starter", "Enterprise"):
            self.assertIn(name, self.rules)
        sec = re.search(r'<section id="capacidade"[^>]*>', self.raw).group(0)
        self.assertRegex(sec, r"\bhidden\b")
        self.assertIn("data-pos-enforcement", sec)
        self.assertIn("niveis=1", self.raw)
