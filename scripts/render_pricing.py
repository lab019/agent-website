#!/usr/bin/env python3
"""Deploy-time pricing render for the static site (stdlib only).

Replaces tokens in HTML files with values taken from environment variables
(repo Variables in the deploy workflow), so no price is ever written in the repo:

    {{plan_price|fallback}}      -> "R$ <PUBLIC_PLAN_PRICE_BRL>"
    {{plan_franchise|fallback}}  -> "R$ <PUBLIC_PLAN_FRANCHISE_USD x PUBLIC_FX_BRL_PER_USD>"
    {{trial_credit|fallback}}    -> "R$ <PUBLIC_TRIAL_CREDIT_USD x PUBLIC_FX_BRL_PER_USD>"

A missing or invalid input renders the token's fallback text (never a number).
Invalid values only warn on stderr; the script never fails the deploy.

Usage: python3 scripts/render_pricing.py site
"""
import os
import re
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

VALUE_PATTERN = re.compile(r"[0-9]{1,7}(?:[.,][0-9]{1,2})?", re.ASCII)
# PTAX has 4 decimals; exactly 3 decimals is rejected (looks like a thousands separator, e.g. "1.250")
FX_PATTERN = re.compile(r"[0-9]{1,3}(?:[.,](?:[0-9]{1,2}|[0-9]{4}))?", re.ASCII)
TOKEN_PATTERN = re.compile(r"\{\{(plan_price|plan_franchise|trial_credit)\|([^}]*)\}\}")

ENV_PLAN_PRICE = "PUBLIC_PLAN_PRICE_BRL"
ENV_FRANCHISE_USD = "PUBLIC_PLAN_FRANCHISE_USD"
ENV_TRIAL_USD = "PUBLIC_TRIAL_CREDIT_USD"
ENV_FX = "PUBLIC_FX_BRL_PER_USD"


def format_brl(value):
    """Format a Decimal as pt-BR currency, dropping ",00" (e.g. R$ 125, R$ 1.250,50)."""
    cents = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    whole, frac = "{:.2f}".format(cents).split(".")
    whole = "{:,}".format(int(whole)).replace(",", ".")
    return "R$ %s" % whole if frac == "00" else "R$ %s,%s" % (whole, frac)


def _parse(env, name, pattern=VALUE_PATTERN):
    """Return a positive Decimal, or None (with a warning if the value is set but invalid)."""
    raw = (env.get(name) or "").strip()
    if not raw:
        return None
    if pattern.fullmatch(raw):
        value = Decimal(raw.replace(",", "."))
        if value > 0:
            return value
    print("warning: %s has an invalid value; treated as absent" % name, file=sys.stderr)
    return None


def _whole(value):
    return value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def _derived(amount_usd, fx):
    """Return amount x fx rounded to whole reais, or None when it is not positive."""
    if amount_usd is None or fx is None:
        return None
    result = _whole(amount_usd * fx)
    return result if result > 0 else None


def load_config(env):
    """Build the rendered strings per token; a token is absent when its inputs are."""
    price = _parse(env, ENV_PLAN_PRICE)
    franchise_usd = _parse(env, ENV_FRANCHISE_USD)
    trial_usd = _parse(env, ENV_TRIAL_USD)
    fx = _parse(env, ENV_FX, FX_PATTERN)
    config = {}
    try:
        if price is not None:
            config["plan_price"] = format_brl(price)
        franchise = _derived(franchise_usd, fx)
        if franchise is not None:
            config["plan_franchise"] = format_brl(franchise)
        trial = _derived(trial_usd, fx)
        if trial is not None:
            config["trial_credit"] = format_brl(trial)
    except ArithmeticError:
        print("warning: pricing math failed; affected tokens use fallbacks", file=sys.stderr)
    return config


def render(html, config):
    """Replace every known token with its value, or with its fallback text."""
    return TOKEN_PATTERN.sub(lambda m: config.get(m.group(1), m.group(2)), html)


def main(argv):
    if len(argv) != 2:
        print("usage: render_pricing.py <site_dir>", file=sys.stderr)
        return 0
    config = load_config(os.environ)
    for path in sorted(Path(argv[1]).rglob("*.html")):
        original = path.read_text(encoding="utf-8")
        rendered = render(original, config)
        if rendered != original:
            path.write_text(rendered, encoding="utf-8")
        if "{{" in rendered:
            print("warning: %s still contains '{{' after rendering" % path, file=sys.stderr)
    print("pricing rendered: %s" % (", ".join(sorted(config)) or "no values (fallbacks only)"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
