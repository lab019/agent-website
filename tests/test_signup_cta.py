"""Acceptance LIC-3415 + LIC-3407: "Testar grátis" and "Testar a plataforma" open /signup carrying the visit's utm_*, gclid
and fbclid (and the topic's theme on the topic pages); "Entrar" opens /login.

criterion -> test
c1 | every "Testar grátis" link on every page is a signup CTA and every page loads the script that points it at /signup | SignupCta::test_c1_every_free_trial_link_is_a_signup_cta_on_all_pages
c2 | page opened with utm_* -> /signup opens with the same utm_* | SignupCta::test_c2_c3_utm_params_are_forwarded_and_absent_when_missing
c3 | no utm_* -> /signup without params | SignupCta::test_c2_c3_utm_params_are_forwarded_and_absent_when_missing
c4 | "Testar a plataforma" is a signup CTA, "Entrar" goes to /login, "Quero começar" unchanged | SignupCta::test_c4_platform_button_signs_up_enter_goes_to_login
c6 | topic pages (support, collections, reactivation, scheduling, voice) carry their theme on the signup CTAs | SignupCta::test_c6_topic_pages_carry_their_theme
c5 | code, constants and params in English | SignupCta::test_c5_destination_lives_in_one_place_in_english

Stdlib only (the script's behavior is exercised through node when available).
"""
import json
import re
import shutil
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
SCRIPT = SITE / "assets" / "signup-link.js"
SIGNUP = "https://app.lab019.ai/signup"
LOGIN = "https://app.lab019.ai/login"
TOPICS = {
    "atendimento-whatsapp": "support",
    "cobranca-whatsapp": "collections",
    "reativacao-de-clientes": "reactivation",
    "agendamento-confirmacao": "scheduling",
    "voz": "voice",
}


class Anchors(HTMLParser):
    def __init__(self, src):
        super().__init__()
        self.links = []  # (text, attrs)
        self.scripts = []
        self._cur = None
        self.feed(src)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a":
            self._cur = [a, ""]
        elif tag == "script" and a.get("src"):
            self.scripts.append(a["src"])

    def handle_data(self, data):
        if self._cur is not None:
            self._cur[1] += data

    def handle_endtag(self, tag):
        if tag == "a" and self._cur is not None:
            a, text = self._cur
            self.links.append((" ".join(text.split()), a))
            self._cur = None


def pages():
    return sorted(SITE.rglob("*.html"))


class SignupCta(unittest.TestCase):
    def test_c1_every_free_trial_link_is_a_signup_cta_on_all_pages(self):
        total = 0
        for page in pages():
            doc = Anchors(page.read_text(encoding="utf-8"))
            self.assertIn("/assets/signup-link.js", doc.scripts, page)
            for text, a in doc.links:
                if text.startswith("Testar grátis"):
                    total += 1
                    self.assertIn("data-signup", a, (page, text))
        self.assertGreater(total, 0)

    def test_c2_c3_utm_params_are_forwarded_and_absent_when_missing(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node not available")
        code = (
            "const m = require(process.argv[1]);"
            "const cases = [['?utm_source=x&utm_campaign=y'], [''], ['?ref=z&utm_medium=m&foo=1&gclid=g&fbclid=f'], ['?utm_source=x', 'collections']];"
            "console.log(JSON.stringify(cases.map(c => m.buildSignupUrl(c[0], c[1]))));"
        )
        out = subprocess.run([node, "-e", code, str(SCRIPT)], capture_output=True, text=True, check=True)
        self.assertEqual(
            json.loads(out.stdout),
            [
                SIGNUP + "?utm_source=x&utm_campaign=y",
                SIGNUP,
                SIGNUP + "?utm_medium=m&gclid=g&fbclid=f",
                SIGNUP + "?utm_source=x&theme=collections",
            ],
        )

    def test_c4_platform_button_signs_up_enter_goes_to_login(self):
        for page in pages():
            doc = Anchors(page.read_text(encoding="utf-8"))
            for text, a in doc.links:
                if text == "Testar a plataforma":
                    self.assertIn("data-signup", a, (page, text))
                if text == "Entrar":
                    self.assertNotIn("data-signup", a, (page, text))
                    self.assertEqual(a.get("href"), LOGIN, (page, text))
                if text == "Quero começar":
                    self.assertNotIn("data-signup", a, (page, text))
                    self.assertEqual(a.get("href"), "https://app.lab019.ai", (page, text))

    def test_c6_topic_pages_carry_their_theme(self):
        for slug, theme in TOPICS.items():
            doc = Anchors((SITE / slug / "index.html").read_text(encoding="utf-8"))
            ctas = [a for _, a in doc.links if "data-signup" in a]
            self.assertTrue(ctas, slug)
            for a in ctas:
                self.assertEqual(a.get("data-theme"), theme, slug)

    def test_c5_destination_lives_in_one_place_in_english(self):
        src = SCRIPT.read_text(encoding="utf-8")
        self.assertEqual(src.count(SIGNUP), 1)
        self.assertRegex(src, r"SIGNUP_URL\s*=")
        for page in pages():
            self.assertNotIn(SIGNUP, page.read_text(encoding="utf-8"), page)


if __name__ == "__main__":
    unittest.main()
