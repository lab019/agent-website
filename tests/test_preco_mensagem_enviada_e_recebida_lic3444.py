"""LIC-3444 c8: /preco and /whatsapp say "por mensagem enviada e recebida" before charging turns on."""
import json
import re
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
PHRASE = "por mensagem enviada e recebida"
MONEY = re.compile(r"(R\$|US\$)\s*(&nbsp;|&#160;| )?\s*\d")


def section(raw, open_re):
    start = re.search(open_re, raw).start()
    return raw[start:raw.index("</section>", start)]


class MensagemEnviadaERecebida(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.preco = (SITE / "preco" / "index.html").read_text(encoding="utf-8")
        cls.whatsapp = (SITE / "whatsapp" / "index.html").read_text(encoding="utf-8")

    def test_preco_consumo_says_charge_per_sent_and_received_message(self):
        consumo = section(self.preco, r'<section id="consumo"[^>]*>')
        self.assertTrue(PHRASE in consumo, 'consumo section lacks the phrase')
        # every channel and both senders, so the price shown is the price charged
        for word in ("canais", "agente", "pessoa"):
            self.assertTrue(word in consumo, word)
        self.assertNotRegex(consumo, MONEY)  # price stays in the panel, never in the page

    def test_preco_faq_json_ld_says_the_same_as_the_visible_page(self):
        blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', self.preco, re.S)
        answers = [
            q["acceptedAnswer"]["text"]
            for b in blocks
            for q in json.loads(re.sub(r"\{\{[^}]*\}\}", "x", b)).get("mainEntity", [])
        ]
        self.assertTrue(any(PHRASE in a for a in answers))

    def test_whatsapp_page_says_attendance_is_charged_per_sent_and_received_message(self):
        self.assertTrue(PHRASE in self.whatsapp, 'whatsapp page lacks the phrase')
        self.assertFalse("Os disparos ativos são cobrados por mensagem enviada, de forma transparente" in self.whatsapp)


if __name__ == "__main__":
    unittest.main()
