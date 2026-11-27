"""Acceptance LIC-3792: on the home, "Conversar com a equipe" opens the conversation and asks for a person (no e-mail).

criterion -> test (max 2 per criterion; the SDK call is covered by tests/sdk/sdk.test.mjs)
c1 | the shortcut is not a mailto and the home's chat code shows no e-mail address | Equipe::test_c1_the_shortcut_is_not_a_mailto_and_shows_no_address
c2 | the click enters the chat and asks the product for a person; no text is sent for the visitor | Equipe::test_c2_the_click_opens_the_chat_and_requests_a_person_without_sending_text
c4 | a failed request still ends in a notice, never a blank screen, and the fallback link is no mailto | Equipe::test_c4_a_failure_ends_in_a_notice_and_the_fallback_is_not_a_mailto
c5 | the shortcut keeps the link look and does not widen the row on a phone | Equipe::test_c5_the_shortcut_looks_like_its_neighbour_link

(c3 and c6 are proved in production by the QA.)  Stdlib only.
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

    def test_c4_a_failure_ends_in_a_notice_and_the_fallback_is_not_a_mailto(self):
        body = re.search(r"async function talkToTeam\(\) \{.*?\n\}\n", HOME_JS, re.S).group(0)
        self.assertIn("catch", body)
        self.assertIn("release()", body)
        self.assertIn("addNotice(", body)
        self.assertNotIn("TEAM_URL", HOME_JS)

    def test_c5_the_shortcut_looks_like_its_neighbour_link(self):
        rule = re.search(r"\.alt-cta button[^{]*\{([^}]*)\}", HOME_CSS)
        self.assertIsNotNone(rule, ".alt-cta button rule is missing")
        for need in ("font:inherit", "background:none", "border:0", "cursor:pointer"):
            self.assertIn(need, rule.group(1).replace(" ", ""))


if __name__ == "__main__":
    unittest.main()
