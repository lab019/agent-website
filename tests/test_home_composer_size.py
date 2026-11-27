"""Acceptance: the home's idle composer size, the hero fills the first screen, the stop button and minimizing the chat.

criterion -> test
c1 | idle composer ~800 px wide, textarea 2 lines at rest growing to 3 with the screen height (the phone keeps its 2-line floor); the chat keeps its width | HomeComposerSize::test_c1_idle_composer_size_and_the_chat_keeps_its_size
c2 | the hero block is centred in the first screen: no free space pushed below the model cards | HomeComposerSize::test_c2_hero_has_no_blank_strip_at_the_bottom
c3 | while the agent answers, the send button turns into a stop button that calls the SDK stop (once more if the run was not registered yet) | tests/sdk/home-controls.test.mjs
c3 | a stopped answer stays as it was: late events of that question never reopen it nor close the next one | tests/sdk/turn-ids.test.mjs
c4 | the bubble's send button turns into the same stop button | HomeComposerSize::test_c4_the_bubble_has_the_same_stop_button + tests/sdk/home-controls.test.mjs
c5 | "Minimizar" in the chat header hands the screen back to the site; the conversation stays in the corner bubble, also after a reload | HomeComposerSize::test_c5_minimize_returns_to_the_site_with_the_conversation_in_the_bubble + tests/sdk/home-controls.test.mjs

The rules (stop retry, button state, bubble, the minimized memory) are proven in node against site/assets/home-controls.js
and site/assets/turn-ids.js; here, the markup and the styles they act on.
Stdlib only. Sizes were measured in the browser at 1440, 1790 and 390 px (see the PR).
"""
import re
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
CSS = (SITE / "assets" / "home.css").read_text(encoding="utf-8")
HTML = (SITE / "index.html").read_text(encoding="utf-8")


def rule(selector: str) -> str:
    match = re.search(rf"(?m)^\s*{re.escape(selector)}\s*\{{([^}}]*)\}}", CSS)
    assert match, selector
    return match.group(1)


def mobile_rule(selector: str) -> str:
    match = re.search(rf"@media \(max-width: 640px\) \{{.*?{re.escape(selector)} \{{([^}}]*)\}}", CSS, re.S)
    assert match, selector
    return match.group(1)


class HomeComposerSize(unittest.TestCase):
    def test_c1_idle_composer_size_and_the_chat_keeps_its_size(self):
        self.assertIn("--homew:800px", CSS)
        self.assertIn("max-width:var(--homew)", rule(".composer-zone .composer"))
        self.assertIn("min-height:clamp(3em, 8svh, 4.5em)", rule(".composer textarea"))
        self.assertIn("min-height:3em", mobile_rule(".composer textarea"))  # 2 lines of 1.5em
        self.assertIn("min-height:28px", rule(".stage.is-chat .composer textarea"))
        self.assertIn("width:min(var(--chatw), 100% - 32px)", rule(".stage.is-chat .composer-zone"))

    def test_c2_hero_has_no_blank_strip_at_the_bottom(self):
        models = rule(".models")
        self.assertNotIn("margin-top:auto", models)
        self.assertIn("margin-top:clamp(", models)

    def test_c4_the_bubble_has_the_same_stop_button(self):
        panel_form = re.search(r'<form class="pfoot" id="pform">(.*?)</form>', HTML, re.S)
        self.assertTrue(panel_form, "bubble composer")
        self.assertIn('class="send-btn"', panel_form.group(1))
        # the stop face both send buttons switch to
        self.assertIn('<symbol id="i-stop"', HTML)
        self.assertIn("background:var(--ink)", rule(".send-btn.is-stop"))

    def test_c5_minimize_returns_to_the_site_with_the_conversation_in_the_bubble(self):
        button = re.search(r'<button[^>]*id="minimize"[^>]*>(.*?)</button>', HTML, re.S)
        self.assertTrue(button, "minimize button in the chat header")
        self.assertIn('aria-label="Minimizar a conversa"', button.group(0))
        self.assertIn('href="#i-minimize"', button.group(1))
        self.assertIn('<symbol id="i-minimize"', HTML)
        self.assertNotIn('id="to-corner"', HTML)
        # the voice call has its own end button: minimizing is a chat thing
        self.assertIn("display:none", rule(".stage.is-voice #minimize"))
        # on the phone the minimized bubble leaves the live badge (top corner) alone
        self.assertIn("top:auto", mobile_rule(".fab.is-low"))
        self.assertIn("bottom:", mobile_rule(".fab.is-low"))


if __name__ == "__main__":
    unittest.main()
