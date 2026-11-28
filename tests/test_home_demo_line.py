"""Acceptance: anonymous test through the site — WhatsApp and call buttons for the demo line, next to the site chat.

criterion -> test (max 2 per criterion)
c1 | the home has a wa.me and a tel: button with the full number visible, built from the platform's public route | DemoLine::test_c1_buttons_are_built_from_the_public_route_with_the_full_number
c2 | the number is not in the repo nor in the deploy config: nothing in site/ carries a phone, the page reads it live | DemoLine::test_c2_the_number_is_not_in_the_repo_and_is_read_live
c3 | the texts are pt-BR and say it is a test with AI | DemoLine::test_c3_texts_are_pt_br_and_say_it_is_a_test_with_ai
c4 | no "call me" form and no typed phone number | DemoLine::test_c4_no_call_me_form_and_no_typed_number
c5 | the block uses the DS tokens the home already has and hides in the chat state | DemoLine::test_c5_block_uses_existing_tokens_and_hides_in_chat_state
c6 | when the fetch fails the buttons do not appear and there is no fallback number | DemoLine::test_c6_when_the_fetch_fails_the_buttons_do_not_appear

Tests use a fictitious number only.  Prints at 1440 and 390 px are attached to the PR.  Stdlib only; Node runs the
config's functions with a fake fetch when present.
"""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
ASSETS = SITE / "assets"
HOME = (SITE / "index.html").read_text(encoding="utf-8")
HOME_JS = (ASSETS / "home.js").read_text(encoding="utf-8")
HOME_CSS = (ASSETS / "home.css").read_text(encoding="utf-8")
CONFIG_PATH = ASSETS / "demo-line.js"
DEPLOY = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
FICTITIOUS = "+5511900000000"


def _block() -> str:
    match = re.search(r'<section class="demo-line".*?</section>', HOME, re.S)
    assert match, "the demo-line block is missing from the home"
    return match.group(0)


def _node(expression: str):
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    script = (
        f"import('{CONFIG_PATH.as_uri()}').then(m => Promise.resolve({expression}))"
        ".then(v => console.log(JSON.stringify(v === undefined ? null : v)))"
    )
    return json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)


def _fake_fetch(e164, *, ok=True, status=200, record=None) -> str:
    """JS source of a fake ``fetch`` answering the public route with the fictitious number."""
    body = "{}" if e164 is None else json.dumps({"e164": e164})
    save = f"{record}.push({{ url, credentials: init.credentials }}); " if record else ""
    return f"((url, init) => {{ {save}return Promise.resolve({{ ok: {str(ok).lower()}, status: {status}, json: () => Promise.resolve({body}) }}) }})"


class DemoLine(unittest.TestCase):
    def test_c1_buttons_are_built_from_the_public_route_with_the_full_number(self):
        block = _block()
        self.assertRegex(block, r'<a[^>]*data-demo-line="whatsapp"')
        self.assertRegex(block, r'<a[^>]*data-demo-line="call"')
        self.assertRegex(block, r'<[^>]*data-demo-line="number"')
        self.assertIn("import { mountDemoLine }", HOME_JS)
        self.assertIn("mountDemoLine(", HOME_JS)
        out = _node(f"m.fetchDemoLine({_fake_fetch(FICTITIOUS)}).then(l => m.demoLineLinks(l))")
        self.assertEqual(out["whatsapp"], "https://wa.me/5511900000000")
        self.assertEqual(out["call"], "tel:+5511900000000")
        self.assertEqual(out["display"], "+55 11 90000-0000")  # the full, formatted number is what the visitor reads
        asked = _node(f"(async () => {{ const seen = []; await m.fetchDemoLine({_fake_fetch(FICTITIOUS, record='seen')}); return seen }})()")
        self.assertEqual(asked[0]["url"], "https://api.lab019.ai/gateway/v1/public/demo-line")
        self.assertEqual(asked[0]["credentials"], "omit")  # an open read: nothing of the visitor goes with it

    def test_c2_the_number_is_not_in_the_repo_and_is_read_live(self):
        for path in [p for p in SITE.rglob("*") if p.suffix in {".html", ".js", ".css", ".xml", ".txt", ".json"}]:
            text = path.read_text(encoding="utf-8", errors="ignore")
            self.assertNotRegex(text, r"\+55\s?\d{2}\s?9?\d{4}-?\d{4}", path)  # no Brazilian phone anywhere
            self.assertNotRegex(text, r"wa\.me/\d", path)
            self.assertNotRegex(text, r'href="tel:', path)
        source = CONFIG_PATH.read_text(encoding="utf-8")
        self.assertIn("/gateway/v1/public/demo-line", source)
        self.assertNotIn("__DEMO_LINE", source)  # no deploy-time token: the config lives nowhere in git or in Variables
        self.assertNotIn("DEMO_LINE", DEPLOY)

    def test_c3_texts_are_pt_br_and_say_it_is_a_test_with_ai(self):
        block = _block()
        text = re.sub(r"<[^>]+>", " ", block)
        self.assertRegex(text, r"(?i)teste")
        self.assertRegex(text, r"(?i)inteligência artificial|\bIA\b")
        self.assertRegex(block, r"(?i)WhatsApp")
        self.assertRegex(block, r"(?i)Ligar")
        self.assertNotRegex(text, r"(?i)\b(call|chat with|free)\b")  # no English copy

    def test_c4_no_call_me_form_and_no_typed_number(self):
        block = _block()
        self.assertNotRegex(block, r"<(form|input|textarea|select)\b")
        self.assertNotRegex(block, r'type="tel"')
        self.assertNotRegex(block, r"(?i)me liga")

    def test_c5_block_uses_existing_tokens_and_hides_in_chat_state(self):
        self.assertRegex(HOME_CSS, r"\.stage\.is-chat[^{]*\.demo-line")
        rules = "".join(re.findall(r"\.(?:demo-line|demo-btn)[^{]*\{[^}]*\}", HOME_CSS))
        self.assertIn("--support-ink", rules)
        for token in re.findall(r"var\((--[\w-]+)", rules):
            self.assertIn(f"{token}:", HOME_CSS + (ASSETS / "styles.css").read_text(encoding="utf-8"), token)
        self.assertNotRegex(rules, r"#[0-9a-fA-F]{3,6}\b")  # DS tokens only, no new colours

    def test_c6_when_the_fetch_fails_the_buttons_do_not_appear(self):
        self.assertRegex(_block(), r'<section class="demo-line" hidden')  # hidden until a number is mounted
        out = _node(
            "Promise.all([m.fetchDemoLine(%s), m.fetchDemoLine(%s), m.fetchDemoLine(%s), m.fetchDemoLine(%s),"
            " m.fetchDemoLine(%s), m.fetchDemoLine(undefined), m.mountDemoLine(%s, %s)])"
            % (
                "() => Promise.reject(new Error('offline'))",
                _fake_fetch(None, ok=False, status=503),
                _fake_fetch("+1 555 0100"),
                _fake_fetch("junk"),
                "() => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('bad json')) })",
                "{querySelectorAll: () => [], querySelector: () => null}",
                "() => Promise.reject(new Error('offline'))",
            )
        )
        self.assertEqual(out, [None, None, None, None, None, None, False])


if __name__ == "__main__":
    unittest.main()
