"""Acceptance (LIC-3810): the home's split WhatsApp button (text | call) and a smaller phone call, above the composer.

criterion -> test (max 2 per criterion)
c1 | above the composer, one "Conversar no WhatsApp" button split in "Texto ou áudio" (wa.me) and "Ligação de voz · Novo" (wa.me/call), and a smaller "Ligar pelo telefone" with the number; the old block and the "Prefere ir direto?" line are gone | WhatsAppSplit::test_c1_split_whatsapp_button_and_smaller_phone_call_above_the_composer
c2 | the call half only with whatsapp_calls: true; without it the text half takes the whole button; the route down shows nothing | WhatsAppSplit::test_c2_without_calls_the_text_half_takes_the_whole_button + tests/sdk/demo-line.test.mjs
c3 | on a phone the call half opens WhatsApp; on a computer it shows a QR code of the same link | tests/sdk/demo-line.test.mjs c3 (handler, popover markup, lazy QR, no-popover fallback) + tests/sdk/qr.test.mjs c3
c4 | under the composer: the suggestions ("Falar com uma pessoa" in place of "Atende por telefone?", opening the handoff), a short proof row with the 14-day trial link, the models | WhatsAppSplit::test_c4_under_the_composer_suggestions_proof_row_and_models + tests/test_home_equipe_handoff.py
c5 | the demo number never enters the repo; the front only reads it from the public route | tests/test_home_demo_line.py c2 and c6
c6 | the layout holds at 1440 and 390 px | WhatsAppSplit::test_c6_one_column_on_the_phone + prints in the LIC-3810 comment

The QR code decode was checked in the browser (BarcodeDetector); the prints use a fictitious number.  Stdlib only.
"""
import re
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
HOME = (SITE / "index.html").read_text(encoding="utf-8")
CSS = (SITE / "assets" / "home.css").read_text(encoding="utf-8")


def block() -> str:
    return re.search(r'<nav class="try-ways".*?</nav>', HOME, re.S).group(0)


def rule(selector: str) -> str:
    match = re.search(rf"(?m)^\s*{re.escape(selector)}\s*\{{([^}}]*)\}}", CSS)
    assert match, selector
    return match.group(1)


def mobile_rule(selector: str) -> str:
    match = re.search(rf"@media \(max-width: 640px\) \{{.*?\n  {re.escape(selector)} \{{([^}}]*)\}}", CSS, re.S)
    assert match, selector
    return match.group(1)


class WhatsAppSplit(unittest.TestCase):
    def test_c1_split_whatsapp_button_and_smaller_phone_call_above_the_composer(self):
        self.assertLess(HOME.index('<nav class="try-ways"'), HOME.index('<div class="composer-zone">'))
        nav = block()
        wa = re.search(r'<div class="try-way wa-block".*?</span>\s*</span>\s*</div>', nav, re.S).group(0)
        self.assertIn("Conversar no WhatsApp", wa)
        halves = re.findall(r'<a class="wa-half"[^>]*>.*?</a>', wa, re.S)
        self.assertEqual(len(halves), 2)
        self.assertIn('data-demo-line="whatsapp"', halves[0])
        self.assertIn("Texto ou áudio", halves[0])
        self.assertIn('data-demo-line="whatsapp-call"', halves[1])
        self.assertRegex(re.sub(r"<[^>]+>", "", halves[1]), r"Ligação de voz\s*Novo")
        tel = re.search(r'<a class="try-way tel-way" data-demo-line="call".*?</a>', nav, re.S).group(0)
        self.assertIn("Ligar pelo telefone", tel)
        self.assertIn('data-demo-line="number"', tel)
        self.assertLess(float(re.search(r"width:(\d+)px", rule(".tel-way .try-ico")).group(1)), 40)  # smaller than the WhatsApp icon
        for gone in ('class="demo-line"', 'class="alt-cta"', "Prefere ir direto?", "Prefere testar pelo celular?"):
            self.assertNotIn(gone, HOME)
        self.assertNotRegex(CSS, r"\.(?:demo-line|demo-btn|alt-cta)\b")

    def test_c2_without_calls_the_text_half_takes_the_whole_button(self):
        self.assertRegex(block(), r'<a class="wa-half" data-demo-line="whatsapp-call" hidden')
        split = rule(".wa-split")
        self.assertIn("grid-auto-flow:column", split)  # one column per visible half
        self.assertIn("grid-auto-columns:1fr", split)
        self.assertNotIn("grid-template-columns", split)

    def test_c4_under_the_composer_suggestions_proof_row_and_models(self):
        chips = re.search(r'<div class="chips start" id="chips">.*?</div>', HOME, re.S).group(0)
        self.assertRegex(chips, r"<button[^>]*data-team[^>]*>[^<]*Falar com uma pessoa")
        self.assertNotIn("Atende por telefone?", chips)
        proof = re.search(r'<ul class="proof">.*?</ul>', HOME, re.S).group(0)
        self.assertEqual(proof.count("<li>"), 3)
        self.assertRegex(proof, r'<a href="https://app\.lab019\.ai" data-signup>14 dias grátis, sem cartão e sem CNPJ')
        order = [HOME.index(s) for s in ('<div class="composer-zone">', '<div class="chips start"', '<ul class="proof">', '<div class="models">')]
        self.assertEqual(order, sorted(order))

    def test_c6_one_column_on_the_phone(self):
        self.assertIn("grid-template-columns:1fr", mobile_rule(".try-ways"))
        self.assertIn("border-top:1px solid var(--border)", mobile_rule(".try-way + .try-way"))
        self.assertIn("display:none", mobile_rule(".wa-half .lg"))  # "Ligação" alone fits half of 390 px
        self.assertIn("grid-template-columns:1fr", mobile_rule(".proof"))


if __name__ == "__main__":
    unittest.main()
