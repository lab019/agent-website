"""LIC-3444 c8: /preco and /whatsapp say "por mensagem enviada e recebida" before charging turns on."""
import html
import json
import re
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
PHRASE = "por mensagem enviada e recebida"
MONEY = re.compile(r"(R\$|US\$)\s*(&nbsp;|&#160;| )?\s*\d")


def text(fragment):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def token_free(fragment):
    return re.sub(r"\{\{[^}]*\}\}", "x", fragment)


def faq_answers(raw):
    """JSON-LD answer text by question name (tokens neutralised, they are not JSON)."""
    out = {}
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', raw, re.S):
        for q in json.loads(token_free(block)).get("mainEntity", []):
            out[q["name"]] = q["acceptedAnswer"]["text"]
    return out


class MensagemEnviadaERecebida(unittest.TestCase):
    def test_preco_and_whatsapp_say_it_in_visible_text_and_json_ld_alike(self):
        """LIC-3444 criterion 8 (site half)."""
        preco = (SITE / "preco" / "index.html").read_text(encoding="utf-8")
        whatsapp = (SITE / "whatsapp" / "index.html").read_text(encoding="utf-8")

        # /preco consumption card: every channel, agent or person, and no money value on the page
        start = preco.index('<section id="consumo"')
        consumo = preco[start:preco.index("</section>", start)]
        self.assertTrue(PHRASE in text(consumo), "consumo card lacks the phrase")
        for word in ("canais", "agente", "pessoa"):
            self.assertTrue(word in text(consumo), word)
        self.assertNotRegex(consumo, MONEY)

        # JSON-LD answer equals the visible FAQ answer (what the page says is what search shows)
        for raw, question in ((preco, "O que está incluso na mensalidade?"), (whatsapp, "Quanto custa?")):
            answer = faq_answers(raw)[question]
            self.assertTrue(PHRASE in answer, question)
            visible = re.search(r"<summary>%s</summary>\s*<p>(.*?)</p>" % re.escape(question), raw, re.S)
            self.assertEqual(text(token_free(visible.group(1))), " ".join(answer.split()), question)
            self.assertTrue(PHRASE in text(visible.group(1)), question)


if __name__ == "__main__":
    unittest.main()
