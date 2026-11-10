#!/usr/bin/env python3
"""Build-time render of the link-preview image (og-image.png, 1200x630) (stdlib only).

The price and the included credits come from the same billing endpoint and tokens as
the pages (scripts/render_pricing.py), so a price change needs no edit of the PNG: the
next deploy redraws it. The source is og-image/og-image.template.html.

Needs a headless Chrome/Chromium: CHROME_BIN, or google-chrome / chromium on PATH, or
the macOS Chrome app. If the billing is unreachable or Chrome fails, the script FAILS
and leaves the existing PNG untouched: the site never publishes a stale or blank image.

Usage: python3 scripts/render_og_image.py <site_dir>
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import render_pricing  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "og-image" / "og-image.template.html"
OUTPUT_NAME = "assets/og-image.png"
WIDTH, HEIGHT = 1200, 630
MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class RenderFailed(Exception):
    """The image could not be drawn; the message says why."""


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
    """Fill the pricing tokens; refuse a result that still has an unreplaced '{{'."""
    out = render_pricing.render(template_text, config)
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
    print("og-image rendered from billing: %s" % config["plan_price"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
