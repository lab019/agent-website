"""Acceptance LIC-3777: SDK JS v1 served by the site and a home built on it (no widget bubble on the home).

criterion -> test (max 2 per criterion; the SDK itself is covered by tests/sdk/sdk.test.mjs)
c3 | the home keeps the mock's landmarks (stage, composer, panel, sections) and none of the mock's leftovers | Home::test_c3_home_has_the_mock_landmarks_and_no_leftovers
c3 | links other pages use to reach the home sections still resolve | Home::test_c3_anchors_used_by_other_pages_exist
c5 | the home talks to the gateway through the SDK and renders no chat.js | Home::test_c5_home_loads_the_sdk_page_and_not_chat_js
c5 | chat.js is still served and a page that loads it still finds it | Home::test_c5_other_pages_keep_the_widget

Stdlib only.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
HOME = (SITE / "index.html").read_text(encoding="utf-8")
HOME_JS = (SITE / "assets" / "home.js").read_text(encoding="utf-8")


class Home(unittest.TestCase):
    def test_c3_home_has_the_mock_landmarks_and_no_leftovers(self):
        for ident in ("stage", "feed", "composer", "recursos", "casos", "seguranca", "como-funciona", "preco", "faq"):
            self.assertRegex(HOME, rf'id="{ident}"', ident)
        for leftover in ("mockbar", "limpo", "agente-aura.mp4</", "P-home"):
            self.assertNotIn(leftover, HOME + (SITE / "assets" / "home.css").read_text(encoding="utf-8"))

    def test_c3_anchors_used_by_other_pages_exist(self):
        wanted = set()
        for page in SITE.rglob("*.html"):
            if page == SITE / "index.html":
                continue
            wanted |= set(re.findall(r'href="(?:https://lab019\.ai)?/#([A-Za-z0-9_-]+)"', page.read_text(encoding="utf-8")))
        for ident in sorted(wanted):
            self.assertRegex(HOME, rf'id="{re.escape(ident)}"', f"home has no #{ident}")

    def test_c5_home_loads_the_sdk_page_and_not_chat_js(self):
        self.assertIn('<script type="module" src="/assets/home.js"></script>', HOME)
        self.assertNotIn("chat.js", HOME)
        self.assertRegex(HOME_JS, r"/sdk/v1/lab019\.js")
        self.assertIn('name="lab019-widget-key"', HOME)
        self.assertIn('name="lab019-api-base"', HOME)

    def test_c5_other_pages_keep_the_widget(self):
        self.assertTrue((SITE / "assets" / "chat.js").is_file())
        # On the previous main only the home loaded the widget; any page that loads it keeps working because the file stays.
        for page in SITE.rglob("*.html"):
            if page != SITE / "index.html" and "chat.js" in page.read_text(encoding="utf-8"):
                self.assertRegex(page.read_text(encoding="utf-8"), r'src="/?(?:\.\./)*assets/chat\.js')


if __name__ == "__main__":
    unittest.main()
