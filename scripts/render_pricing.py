#!/usr/bin/env python3
"""Build-time pricing render for the static site (stdlib only, LIC-3178).

Reads the plan on sale from the billing's public endpoint and replaces tokens in
the HTML files, so no price is ever written in the repo or in a repo Variable:

    GET <PUBLIC_API_BASE>/billing/v1/public/plan
        price_brl_cents  integer, BRL cents of the monthly fee
        trial_credits    integer, micro-USD granted as trial franchise
        fx_brl_per_usd   decimal string, the stored USD/BRL rate

    {{plan_price|fallback}}      -> the monthly fee in reais
    {{plan_price_number|fallback}} -> the monthly fee as a plain decimal (dot, 2 places,
                                    no symbol), for structured data
    {{plan_franchise|fallback}}  -> the same amount: the whole monthly fee becomes credits
    {{trial_credit|fallback}}    -> trial credit in whole reais (micro-USD x rate, half-up)

PUBLIC_API_BASE defaults to https://api.lab019.ai. If the billing is unreachable or
answers something unusable, the build FAILS with a message naming the billing and no
file is touched: the site never publishes a price it could not read.

Usage: python3 scripts/render_pricing.py site
"""
import html
import json
import math
import os
import re
import sys
import urllib.request
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

TOKEN_PATTERN = re.compile(r"\{\{(plan_price_number|plan_price|plan_franchise|trial_credit)\|([^}]*)\}\}")
API_BASE_PATTERN = re.compile(r"https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?", re.ASCII)
DEFAULT_API_BASE = "https://api.lab019.ai"
PLAN_PATH = "/billing/v1/public/plan"
TIMEOUT_SECONDS = 20
MAX_BODY_BYTES = 65536
MICRO = Decimal("1000000")


class PlanUnavailable(Exception):
    """The billing did not give a usable plan; the message always names the billing."""


def format_brl(value):
    """Format a Decimal as pt-BR currency, dropping ",00" (e.g. R$ 40, R$ 1.240,50)."""
    cents = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    whole, frac = "{:.2f}".format(cents).split(".")
    whole = "{:,}".format(int(whole)).replace(",", ".")
    return "R$ %s" % whole if frac == "00" else "R$ %s,%s" % (whole, frac)


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _field(plan, name):
    if name not in plan:
        raise PlanUnavailable("billing plan has no %s" % name)
    return plan[name]


def build_config(plan):
    """Turn the billing's plan payload into {token: text}; raise PlanUnavailable if unusable."""
    if not isinstance(plan, dict):
        raise PlanUnavailable("billing plan is not an object")
    cents = _field(plan, "price_brl_cents")
    if not _is_int(cents) or cents <= 0:
        raise PlanUnavailable("billing plan price_brl_cents is not a positive integer")
    trial = _field(plan, "trial_credits")
    if not _is_int(trial) or trial <= 0:
        raise PlanUnavailable("billing plan trial_credits is not a positive integer")
    raw_fx = _field(plan, "fx_brl_per_usd")
    if not isinstance(raw_fx, str):
        raise PlanUnavailable("billing plan fx_brl_per_usd is absent or not a decimal string")
    try:
        fx = Decimal(raw_fx.strip())
    except ArithmeticError:
        raise PlanUnavailable("billing plan fx_brl_per_usd is not a number") from None
    if not fx.is_finite() or fx <= 0:
        raise PlanUnavailable("billing plan fx_brl_per_usd is not a positive number")
    try:
        price = format_brl(Decimal(cents) / 100)
        price_number = "{:.2f}".format((Decimal(cents) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        trial_brl = (Decimal(trial) / MICRO * fx).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        if trial_brl <= 0:
            raise PlanUnavailable("billing trial credit rounds to zero reais")
        return {"plan_price": price, "plan_price_number": price_number, "plan_franchise": price, "trial_credit": format_brl(trial_brl)}
    except ArithmeticError:
        raise PlanUnavailable("billing plan values are out of range") from None


def fetch_plan(base_url, opener=urllib.request.urlopen, timeout=TIMEOUT_SECONDS):
    """GET the plan on sale from the billing; raise PlanUnavailable on any failure."""
    url = base_url + PLAN_PATH
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with opener(request, timeout=timeout) as response:
            status = getattr(response, "status", None) or response.getcode()
            if status != 200:
                raise PlanUnavailable("billing answered HTTP %s at %s" % (status, url))
            payload = json.loads(response.read(MAX_BODY_BYTES).decode("utf-8"))
    except PlanUnavailable:
        raise
    except (OSError, ValueError) as exc:
        raise PlanUnavailable("billing unreachable or unreadable at %s (%s)" % (url, exc)) from exc
    if not isinstance(payload, dict):
        raise PlanUnavailable("billing answered something that is not a plan at %s" % url)
    return payload


def render(text, config):
    """Replace every known token with its value, or with its fallback text."""
    return TOKEN_PATTERN.sub(lambda m: config.get(m.group(1), html.escape(m.group(2))), text)


def _api_base(env):
    raw = (env.get("PUBLIC_API_BASE") or "").strip()
    if not raw:
        return DEFAULT_API_BASE
    if not API_BASE_PATTERN.fullmatch(raw):
        raise PlanUnavailable("PUBLIC_API_BASE is invalid (expected https://host), billing not queried")
    return raw


def main(argv, env=None, opener=urllib.request.urlopen):
    if len(argv) != 2:
        print("usage: render_pricing.py <site_dir>", file=sys.stderr)
        return 2
    env = os.environ if env is None else env
    try:
        config = build_config(fetch_plan(_api_base(env), opener=opener))
    except PlanUnavailable as exc:
        print("error: site not rendered: %s" % exc, file=sys.stderr)
        return 1
    rendered, failures = {}, []
    for path in sorted(Path(argv[1]).rglob("*.html")):
        try:
            original = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            failures.append("%s unreadable (%s)" % (path, type(exc).__name__))
            continue
        out = render(original, config)
        if "{{" in out:
            failures.append("%s still contains '{{' after rendering" % path)
        rendered[path] = (original, out)
    if failures:
        print("error: site not rendered: %s" % "; ".join(failures), file=sys.stderr)
        return 1
    for path, (original, out) in rendered.items():
        if out != original:
            path.write_text(out, encoding="utf-8")
    print("pricing rendered from billing: %s" % ", ".join(sorted(config)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
