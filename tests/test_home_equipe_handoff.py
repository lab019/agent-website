"""Acceptance LIC-3792: on the home, "Conversar com a equipe" opens the conversation and asks for a person (no e-mail).

criterion -> test (max 2 per criterion; the SDK call is covered by tests/sdk/sdk.test.mjs)
c1 | the shortcut is not a mailto and the home's chat code shows no e-mail address | Equipe::test_c1_the_shortcut_is_not_a_mailto_and_shows_no_address
c2 | the click enters the chat and asks the product for a person; no text is sent for the visitor | Equipe::test_c2_the_click_opens_the_chat_and_requests_a_person_without_sending_text

(c3 and c6 are proved in production by the QA; c4 by the gateway tests and the QA; c5 by the QA's prints at 1440 and 390 px.)  Stdlib only.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
HOME = (SITE / "index.html").read_text(encoding="utf-8")
HOME_JS = (SITE / "assets" / "home.js").read_text(encoding="utf-8")
HOME_CSS = (SITE / "assets" / "home.css").read_text(encoding="utf-8")


def _alt_cta() -> str:
    return re.search(r'<p class="alt-cta">.*?</p>', HOME, re.S).group(0)


class Equipe(unittest.TestCase):
    def test_c1_the_shortcut_is_not_a_mailto_and_shows_no_address(self):
        cta = _alt_cta()
        self.assertIn("Conversar com a equipe", cta)
        self.assertNotIn("mailto:", cta)
        self.assertNotIn("@lab019.ai", cta)
        self.assertRegex(cta, r"<button[^>]*data-team[^>]*>\s*Conversar com a equipe")
        self.assertNotIn("mailto:", HOME_JS)

    def test_c2_the_click_opens_the_chat_and_requests_a_person_without_sending_text(self):
        self.assertRegex(HOME_JS, r"querySelectorAll\('\[data-team\]'\)|closest\('\[data-team\]'\)")
        fn = re.search(r"async function talkToTeam\(\) \{.*?\n\}\n", HOME_JS, re.S)
        self.assertIsNotNone(fn, "talkToTeam() is missing")
        body = fn.group(0)
        self.assertIn("enterChat(", body)
        self.assertIn(".requestHuman()", body)
        self.assertNotIn(".send(", body)  # nothing typed, nothing sent for the visitor


if __name__ == "__main__":
    unittest.main()
