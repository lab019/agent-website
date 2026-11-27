"""Acceptance: the home's idle composer size, the hero fills the first screen, and the stop button.

criterion -> test
c1 | idle composer ~800 px wide, textarea at least 2 lines tall and growing with the screen height (3 lines floor on the phone); the chat keeps its width | HomeComposerSize::test_c1_idle_composer_size_and_the_chat_keeps_its_size
c2 | the hero block is centred in the first screen: no free space pushed below the model cards | HomeComposerSize::test_c2_hero_has_no_blank_strip_at_the_bottom
c3 | while the agent answers, the send button turns into a stop button that calls the SDK stop | HomeComposerSize::test_c3_send_button_turns_into_stop_while_answering
c3 | a stopped answer stays as it was: late events of that question never reopen it nor close the next one | tests/sdk/turn-ids.test.mjs

Stdlib only. Sizes were measured in the browser at 1440, 1790 and 390 px (see the PR).
"""
import re
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
CSS = (SITE / "assets" / "home.css").read_text(encoding="utf-8")
JS = (SITE / "assets" / "home.js").read_text(encoding="utf-8")
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
        self.assertIn("min-height:3em", mobile_rule(".composer textarea"))
        self.assertIn("min-height:28px", rule(".stage.is-chat .composer textarea"))
        self.assertIn("width:min(var(--chatw), 100% - 32px)", rule(".stage.is-chat .composer-zone"))

    def test_c2_hero_has_no_blank_strip_at_the_bottom(self):
        models = rule(".models")
        self.assertNotIn("margin-top:auto", models)
        self.assertIn("margin-top:clamp(", models)

    def test_c3_send_button_turns_into_stop_while_answering(self):
        self.assertIn('<symbol id="i-stop"', HTML)
        self.assertIn(".send-btn.is-stop", CSS)
        self.assertIn("chat.stop()", JS)
        self.assertIn("classList.toggle('is-stop'", JS)
        # the late-event rule itself is proven in tests/sdk/turn-ids.test.mjs; here, that the three stream handlers use it
        self.assertIn("from './turn-ids.js'", JS)
        self.assertEqual(JS.count("ids.stale(event)"), 3)


if __name__ == "__main__":
    unittest.main()
