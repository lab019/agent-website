"""Acceptance LIC-3791: the home's idle composer is wider and taller, and the chat state is unchanged.

criterion -> test
c1 | idle composer ~1000 px wide, textarea at least 2 lines tall (also on the phone); the chat keeps its width | HomeComposerSize::test_c1_idle_composer_is_wide_and_tall_and_the_chat_keeps_its_size

Stdlib only. Sizes were measured in the browser at 1440 and 390 px (see the PR).
"""
import re
import unittest
from pathlib import Path

CSS = (Path(__file__).resolve().parent.parent / "site" / "assets" / "home.css").read_text(encoding="utf-8")


def rule(selector: str) -> str:
    match = re.search(rf"(?m)^\s*{re.escape(selector)}\s*\{{([^}}]*)\}}", CSS)
    assert match, selector
    return match.group(1)


class HomeComposerSize(unittest.TestCase):
    def test_c1_idle_composer_is_wide_and_tall_and_the_chat_keeps_its_size(self):
        self.assertIn("--homew:1000px", CSS)
        self.assertIn("max-width:var(--homew)", rule(".composer-zone .composer"))
        self.assertIn("min-height:3em", rule(".composer textarea"))
        self.assertIn("min-height:3em", re.search(r"@media \(max-width: 640px\) \{.*?\.composer textarea \{([^}]*)\}", CSS, re.S).group(1))
        self.assertIn("min-height:28px", rule(".stage.is-chat .composer textarea"))
        self.assertIn("width:min(var(--chatw), 100% - 32px)", rule(".stage.is-chat .composer-zone"))


if __name__ == "__main__":
    unittest.main()
