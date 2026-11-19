"""Aceite: a página de automações não diz mais que a ligação pelo WhatsApp está indisponível (LIC-2207).

Somente stdlib. Rodar: python3 -m unittest discover -s tests
"""
import re
import unittest
from pathlib import Path

PAGINA = Path(__file__).resolve().parent.parent / "site" / "automacoes" / "index.html"
INDISPONIVEL = re.compile(r"WhatsApp[^.<\"]{0,40}(ainda não|não está) dispon", re.IGNORECASE)
DISPONIVEL = "Também há ligação pelo WhatsApp, para quem autorizou a chamada."


class LigacaoWhatsAppDisponivelTest(unittest.TestCase):
    def test_nao_diz_que_esta_indisponivel(self):
        self.assertIsNone(INDISPONIVEL.search(PAGINA.read_text(encoding="utf-8")))

    def test_faq_visivel_e_json_ld_dizem_que_existe(self):
        # a resposta aparece duas vezes: no JSON-LD de FAQ e no <p> da página
        self.assertEqual(PAGINA.read_text(encoding="utf-8").count(DISPONIVEL), 2)


if __name__ == "__main__":
    unittest.main()
