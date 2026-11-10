#!/usr/bin/env python3
"""Build-time render of the link-preview image (og-image.png, 1200x630) (stdlib only).

The price and the included credits come from the same billing endpoint and tokens as
the pages (scripts/render_pricing.py), and the headline and the supporting line come from
the home itself (<site_dir>/index.html: its <h1> and its og:description), so neither a price
change nor a copy change needs an edit of the PNG: the next deploy redraws it. If the home
has no <h1> (or no og:description) the script FAILS. The source is
og-image/og-image.template.html.

Needs a headless Chrome/Chromium: CHROME_BIN, or google-chrome / chromium on PATH, or
the macOS Chrome app. If the billing is unreachable or Chrome fails, the script FAILS
and leaves the existing PNG untouched: the site never publishes a stale or blank image.

Usage: python3 scripts/render_og_image.py <site_dir>
"""
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import render_pricing  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "og-image" / "og-image.template.html"
OUTPUT_NAME = "assets/og-image.png"
WIDTH, HEIGHT = 1200, 630
MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
SUPPORT_MAX_CHARS = 110
H1_PATTERN = re.compile(r"<h1\b[^>]*>(.*?)</h1>", re.DOTALL | re.IGNORECASE)
OG_DESCRIPTION_PATTERN = re.compile(r'<meta\s+property="og:description"\s+content="([^"]*)"', re.IGNORECASE)


class RenderFailed(Exception):
    """The image could not be drawn; the message says why."""


class _Headline(HTMLParser):
    """The <h1> text, with the home's highlight span (class "hl") kept as the image's accent."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.open_spans = [], []

    def handle_starttag(self, tag, attrs):
        if tag == "span":
            highlighted = "hl" in (dict(attrs).get("class") or "").split()
            self.open_spans.append(highlighted)
            if highlighted:
                self.parts.append('<span class="accent">')

    def handle_endtag(self, tag):
        if tag == "span" and self.open_spans and self.open_spans.pop():
            self.parts.append("</span>")

    def handle_data(self, data):
        self.parts.append(html.escape(data))


def headline_html(home_text):
    """The home's <h1> as safe HTML for the image; fails if the home has no <h1>."""
    found = H1_PATTERN.search(home_text)
    parser = _Headline()
    if found:
        parser.feed(found.group(1))
        parser.close()
    text = re.sub(r"\s+", " ", "".join(parser.parts)).strip()
    if not found or not re.sub(r"<[^>]*>", "", text).strip():
        raise RenderFailed("home has no <h1> to use as the og-image title")
    return text


def support_line(home_text):
    """The home's og:description, cut to fit the image: first sentence, then a word boundary."""
    found = OG_DESCRIPTION_PATTERN.search(home_text)
    text = re.sub(r"\s+", " ", html.unescape(found.group(1))).strip() if found else ""
    if not text:
        raise RenderFailed("home has no og:description to use as the og-image supporting line")
    if len(text) > SUPPORT_MAX_CHARS and ". " in text:
        text = text.split(". ")[0].rstrip(".") + "."
    if len(text) > SUPPORT_MAX_CHARS:
        text = text[: SUPPORT_MAX_CHARS - 1].rsplit(" ", 1)[0].rstrip(",;:.") + "…"
    return html.escape(text)


def find_chrome(env):
    explicit = (env.get("CHROME_BIN") or "").strip()
    if explicit:
        return explicit
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    return MAC_CHROME if os.path.exists(MAC_CHROME) else None


def render_html(template_text, config):
    """Fill the pricing tokens and the home's headline and supporting line (already safe HTML);
    refuse a result that still has an unreplaced '{{'."""
    out = render_pricing.render(template_text, config)
    for key in ("headline_html", "support_line"):
        if key in config:
            out = out.replace("{{%s}}" % key, config[key])
    if "{{" in out:
        raise RenderFailed("og-image template still contains '{{' after rendering")
    return out


def screenshot(chrome, html_path, png_path, run=subprocess.run):
    cmd = [
        chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", "--window-size=%d,%d" % (WIDTH, HEIGHT),
        "--virtual-time-budget=15000", "--screenshot=%s" % png_path, "file://%s" % html_path,
    ]
    try:
        run(cmd, check=True, capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        raise RenderFailed("chrome failed to draw the og-image (%s)" % type(exc).__name__) from exc
    data = Path(png_path).read_bytes() if Path(png_path).exists() else b""
    if not data.startswith(PNG_MAGIC) or len(data) < 5000:
        raise RenderFailed("chrome did not produce a valid og-image png")


def main(argv, env=None, opener=render_pricing.urllib.request.urlopen, run=subprocess.run):
    if len(argv) != 2:
        print("usage: render_og_image.py <site_dir>", file=sys.stderr)
        return 2
    env = os.environ if env is None else env
    try:
        config = render_pricing.build_config(render_pricing.fetch_plan(render_pricing._api_base(env), opener=opener))
        home = Path(argv[1], "index.html").read_text(encoding="utf-8")
        config = {**config, "headline_html": headline_html(home), "support_line": support_line(home)}
        page = render_html(TEMPLATE.read_text(encoding="utf-8"), config)
        chrome = find_chrome(env)
        if not chrome:
            raise RenderFailed("no Chrome/Chromium found (set CHROME_BIN)")
        with tempfile.TemporaryDirectory() as tmp:
            html_path, png_path = Path(tmp, "og-image.html"), Path(tmp, "og-image.png")
            html_path.write_text(page, encoding="utf-8")
            screenshot(chrome, html_path, png_path, run=run)
            target = Path(argv[1], OUTPUT_NAME)
            shutil.copyfile(png_path, target)
    except (render_pricing.PlanUnavailable, RenderFailed, OSError) as exc:
        print("error: og-image not rendered: %s" % exc, file=sys.stderr)
        return 1
    print("og-image rendered from billing and the home: %s" % config["plan_price"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
