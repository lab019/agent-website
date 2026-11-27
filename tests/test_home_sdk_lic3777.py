"""Acceptance LIC-3777: SDK JS v1 served by the site and a home built on it (no widget bubble on the home).

criterion -> test
c1 | the SDK is a static file at /sdk/v1/lab019.js, with no import and no loader other than the lazy LiveKit one | Sdk::test_c1_sdk_is_served_and_has_no_dependency
c1 | the SDK holds no fixed pt-BR phrase (the page owns every label) | Sdk::test_c1_sdk_has_no_fixed_phrase
c3 | the home keeps the mock's landmarks (stage, composer, panel, sections) and none of the mock's leftovers | Home::test_c3_home_has_the_mock_landmarks_and_no_leftovers
c3 | links other pages use to reach the home sections still resolve | Home::test_c3_anchors_used_by_other_pages_exist
c4 | the home talks to the gateway through the SDK and renders no chat.js | Home::test_c5_home_loads_the_sdk_page_and_not_chat_js
c5 | chat.js is still served and a page that loads it still finds it | Home::test_c5_other_pages_keep_the_widget
c4 | the deploy injects the widget key and API base into the home meta tags, not only into chat.js | Deploy::test_c4_deploy_injects_the_home_meta
c4 | without a key the home has the alternative path (signup and e-mail) | Home::test_c4_home_has_an_alternative_path_without_chat

Stdlib only.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
HOME = (SITE / "index.html").read_text(encoding="utf-8")
HOME_JS = (SITE / "assets" / "home.js").read_text(encoding="utf-8")
SDK = (SITE / "sdk" / "v1" / "lab019.js").read_text(encoding="utf-8")
DEPLOY = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")


class Sdk(unittest.TestCase):
    def test_c1_sdk_is_served_and_has_no_dependency(self):
        self.assertFalse(re.search(r"^\s*import\s.+from\s", SDK, re.M), "static import found")
        self.assertNotRegex(SDK, r"\bimport\s*\(", "dynamic import found")
        self.assertRegex(SDK, r"LIVEKIT_URL = 'https://cdn\.jsdelivr\.net/npm/livekit-client@\d+\.\d+\.\d+/")
        self.assertRegex(SDK, r"LIVEKIT_SRI = 'sha384-")
        urls = [line for line in SDK.split("\n") if re.search(r"https?://", line) and not line.lstrip().startswith(("*", "//", "/*"))]
        self.assertEqual([u for u in urls if "livekit" not in u.lower() and "DEFAULT_BASE_URL" not in u], [], "external URLs: the default API base and LiveKit's")
        self.assertRegex(SDK, r"export\s*\{\s*Lab019,\s*Lab019Error\s*\}")
        self.assertIn("export default Lab019", SDK)

    def test_c1_sdk_has_no_fixed_phrase(self):
        code = re.sub(r"/\*.*?\*/|//[^\n]*", "", SDK, flags=re.S)
        strings = re.findall(r"'([^'\n]*)'|\"([^\"\n]*)\"|`([^`]*)`", code)
        for parts in strings:
            text = "".join(parts)
            self.assertNotRegex(text, r"[À-ÿ]", f"accented (pt-BR) text in the SDK: {text!r}")
            self.assertNotRegex(text, r"\b(Olá|Erro|Tente|Digite|Enviar|Falha)\b", f"pt-BR phrase: {text!r}")


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

    def test_c4_home_has_an_alternative_path_without_chat(self):
        self.assertIn("mailto:contato@lab019.ai", HOME_JS + HOME)
        self.assertIn("data-signup", HOME)


class Deploy(unittest.TestCase):
    def test_c4_deploy_injects_the_home_meta(self):
        for token in ("__PUBLIC_WIDGET_KEY__", "__PUBLIC_API_BASE__"):
            self.assertRegex(DEPLOY, rf'sed -i "s\|{token}\|[^"]+" site/assets/chat\.js site/index\.html')


if __name__ == "__main__":
    unittest.main()
