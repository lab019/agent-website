"""Acceptance LIC-3178: the site reads pricing from the billing at build time.

critério -> teste
c1 | billing answer drives the HTML (two answers, two outputs)    | Main::test_c1_two_billing_answers_produce_two_different_outputs
c1 | endpoint GET <base>/billing/v1/public/plan                    | FetchPlan::test_c1_fetch_uses_billing_public_plan_url, Main::test_c1_*_api_base_*
c1 | price/fx/trial from billing; franchise = price / fx * fx      | BuildConfig::test_c1_*
c2 | old PUBLIC_* price vars neither read nor in deploy.yml/CLAUDE | Main::test_c2_old_price_env_vars_have_no_effect, NoMonetaryLiterals::*
c2 | no fixed monetary value in site/ and scripts/                 | NoMonetaryLiterals::test_c2_*
c3 | billing down/invalid -> exit != 0, "billing" in message, no HTML touched | BuildConfig::test_c3_*, FetchPlan::test_c3_*, Main::test_c3_*
c4 | format_brl, render escapes, leftover-token check, non-utf8    | FormatAndRender::*, Main::test_c4_*

Contract (scripts/render_pricing.py): format_brl(Decimal), render(html, config),
build_config(plan_dict) -> {token: text}, fetch_plan(base_url, opener, timeout) -> dict,
PlanUnavailable, main(argv, env=os.environ, opener=urlopen) -> exit code.
Plan payload: price_brl_cents (int), trial_credits (int, micro-USD), fx_brl_per_usd (str).
No network: every test injects a fake opener at the HTTP edge. Stdlib only.
"""
import contextlib
import html as htmllib
import io
import json
import os
import re
import sys
import tempfile
import unittest
import urllib.error
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
SCRIPT = ROOT / "scripts" / "render_pricing.py"
sys.path.insert(0, str(ROOT / "scripts"))

import render_pricing  # noqa: E402

PLAN = {
    "plan_id": "base",
    "price_brl_cents": 13700,
    "currency": "BRL",
    "trial_credits": 5000000,
    "fx_brl_per_usd": "4.000000",
}
OTHER_PLAN = dict(PLAN, price_brl_cents=9990, trial_credits=7500000, fx_brl_per_usd="5.000000")
TEMPLATE = "<p>{{plan_price|PRICE_FB}} | {{plan_franchise|FRANCHISE_FB}} | {{trial_credit|TRIAL_FB}}</p>"
OLD_VARS = ("PUBLIC_PLAN_PRICE_BRL", "PUBLIC_PLAN_FRANCHISE_USD",
            "PUBLIC_TRIAL_CREDIT_USD", "PUBLIC_FX_BRL_PER_USD")
FALLBACKS = ("PRICE_FB", "FRANCHISE_FB", "TRIAL_FB")


class FakeResponse:
    def __init__(self, body, status=200):
        self.status = status
        self._body = body if isinstance(body, bytes) else body.encode("utf-8")

    def read(self, *a):
        return self._body

    def getcode(self):
        return self.status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeOpener:
    """HTTP edge double: records requested URLs; returns a response or raises."""

    def __init__(self, body=None, status=200, exc=None):
        self.body, self.status, self.exc, self.urls = body, status, exc, []

    def __call__(self, request, timeout=None):
        self.urls.append(getattr(request, "full_url", request))
        if self.exc is not None:
            raise self.exc
        if self.status != 200:
            raise urllib.error.HTTPError(self.urls[-1], self.status, "err", {}, None)
        return FakeResponse(self.body)


def plan_with(**changes):
    p = dict(PLAN)
    for k, v in changes.items():
        if v is KeyError:
            p.pop(k, None)
        else:
            p[k] = v
    return p


def run_main(site, opener, env=None):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = render_pricing.main(["render_pricing.py", str(site)], env=env if env is not None else {}, opener=opener)
    return code, err.getvalue()


def make_site(tmp):
    site = Path(tmp) / "site"
    (site / "sub").mkdir(parents=True)
    (site / "a.html").write_text(TEMPLATE, encoding="utf-8")
    (site / "sub" / "b.html").write_text(TEMPLATE, encoding="utf-8")
    (site / "note.txt").write_text(TEMPLATE, encoding="utf-8")
    return site


class FormatAndRender(unittest.TestCase):
    # c4
    def test_c4_format_brl_pt_br(self):
        self.assertEqual(render_pricing.format_brl(Decimal("125")), "R$ 125")
        self.assertEqual(render_pricing.format_brl(Decimal("1250.5")), "R$ 1.250,50")
        self.assertEqual(render_pricing.format_brl(Decimal("99.999")), "R$ 100")

    def test_c4_render_replaces_tokens(self):
        cfg = {"plan_price": "R$ 1", "plan_franchise": "R$ 2", "trial_credit": "R$ 3"}
        self.assertEqual(render_pricing.render(TEMPLATE, cfg), "<p>R$ 1 | R$ 2 | R$ 3</p>")

    def test_c4_render_escapes_fallback_text_of_missing_token(self):
        out = render_pricing.render("{{plan_price|<b>&x</b>}}", {})
        self.assertEqual(out, htmllib.escape("<b>&x</b>"))


class BuildConfig(unittest.TestCase):
    # c1
    def test_c1_price_is_cents_over_100_unrounded_decimals_kept(self):
        self.assertEqual(render_pricing.build_config(PLAN)["plan_price"], "R$ 137")
        self.assertEqual(render_pricing.build_config(plan_with(price_brl_cents=9990))["plan_price"], "R$ 99,90")

    def test_c1_franchise_is_price_over_fx_back_to_reais_without_rounding(self):
        # base rule: whole monthly fee is the franchise, no whole-real rounding
        self.assertEqual(render_pricing.build_config(plan_with(price_brl_cents=9990))["plan_franchise"], "R$ 99,90")
        self.assertEqual(render_pricing.build_config(plan_with(price_brl_cents=9990, fx_brl_per_usd="3"))["plan_franchise"],
                         "R$ 99,90")
        self.assertEqual(render_pricing.build_config(PLAN)["plan_franchise"], "R$ 137")

    def test_c1_franchise_does_not_need_franchise_credits_from_billing(self):
        cfg = render_pricing.build_config(dict(PLAN, franchise_credits=1))
        self.assertEqual(cfg["plan_franchise"], "R$ 137")

    def test_c1_trial_credit_is_micro_usd_times_fx_whole_reais_half_up(self):
        self.assertEqual(render_pricing.build_config(PLAN)["trial_credit"], "R$ 20")
        p = plan_with(trial_credits=25000000, fx_brl_per_usd="4.02")  # 100.5
        self.assertEqual(render_pricing.build_config(p)["trial_credit"], "R$ 101")

    # c3
    def test_c3_invalid_payloads_raise_plan_unavailable_mentioning_billing(self):
        bad = {
            "price zero": plan_with(price_brl_cents=0),
            "price negative": plan_with(price_brl_cents=-1),
            "price missing": plan_with(price_brl_cents=KeyError),
            "price string": plan_with(price_brl_cents="13700"),
            "price bool": plan_with(price_brl_cents=True),
            "fx null": plan_with(fx_brl_per_usd=None),
            "fx missing": plan_with(fx_brl_per_usd=KeyError),
            "fx zero": plan_with(fx_brl_per_usd="0"),
            "fx negative": plan_with(fx_brl_per_usd="-5"),
            "fx garbage": plan_with(fx_brl_per_usd="abc"),
            "fx nan": plan_with(fx_brl_per_usd="nan"),
            "fx number type": plan_with(fx_brl_per_usd=5.0377),
            "trial zero": plan_with(trial_credits=0),
            "trial negative": plan_with(trial_credits=-5),
            "trial missing": plan_with(trial_credits=KeyError),
            "trial null": plan_with(trial_credits=None),
        }
        for name, payload in bad.items():
            with self.subTest(name):
                with self.assertRaises(render_pricing.PlanUnavailable) as cm:
                    render_pricing.build_config(payload)
                self.assertIn("billing", str(cm.exception).lower())

    def test_c3_non_dict_payload_raises(self):
        for payload in ([], "x", None, 3):
            with self.assertRaises(render_pricing.PlanUnavailable):
                render_pricing.build_config(payload)


class FetchPlan(unittest.TestCase):
    # c1
    def test_c1_fetch_uses_billing_public_plan_url(self):
        op = FakeOpener(json.dumps(PLAN))
        plan = render_pricing.fetch_plan("https://api.example.test", opener=op)
        self.assertEqual(op.urls, ["https://api.example.test/billing/v1/public/plan"])
        self.assertEqual(plan["price_brl_cents"], 13700)

    # c3
    def test_c3_fetch_failures_raise_plan_unavailable_with_cause(self):
        cases = {
            "network": FakeOpener(exc=urllib.error.URLError("connection refused")),
            "timeout": FakeOpener(exc=TimeoutError("timed out")),
            "os error": FakeOpener(exc=OSError("boom")),
            "404": FakeOpener(status=404),
            "500": FakeOpener(status=500),
            "html body": FakeOpener("<html>oops</html>"),
            "empty body": FakeOpener(""),
            "json non-object": FakeOpener("[1, 2]"),
        }
        for name, op in cases.items():
            with self.subTest(name):
                with self.assertRaises(render_pricing.PlanUnavailable) as cm:
                    render_pricing.fetch_plan("https://api.example.test", opener=op)
                self.assertIn("billing", str(cm.exception).lower())

    def test_c3_fetch_non_200_status_without_exception_raises(self):
        class Odd(FakeOpener):
            def __call__(self, request, timeout=None):
                return FakeResponse(json.dumps(PLAN), status=204)
        with self.assertRaises(render_pricing.PlanUnavailable):
            render_pricing.fetch_plan("https://api.example.test", opener=Odd())


class Main(unittest.TestCase):
    # c1
    def test_c1_two_billing_answers_produce_two_different_outputs(self):
        outs = []
        for plan in (PLAN, OTHER_PLAN):
            with tempfile.TemporaryDirectory() as tmp:
                site = make_site(tmp)
                code, err = run_main(site, FakeOpener(json.dumps(plan)))
                self.assertEqual(code, 0, err)
                outs.append((site / "a.html").read_text(encoding="utf-8"))
                self.assertEqual((site / "sub" / "b.html").read_text(encoding="utf-8"), outs[-1])
                self.assertEqual((site / "note.txt").read_text(encoding="utf-8"), TEMPLATE)
        self.assertEqual(outs[0], "<p>R$ 137 | R$ 137 | R$ 20</p>")
        self.assertEqual(outs[1], "<p>R$ 99,90 | R$ 99,90 | R$ 38</p>")  # 7.5 USD x 5 = 37.5 -> 38

    def test_c1_default_api_base_is_lab019(self):
        with tempfile.TemporaryDirectory() as tmp:
            op = FakeOpener(json.dumps(PLAN))
            run_main(make_site(tmp), op, env={})
            self.assertEqual(op.urls, ["https://api.lab019.ai/billing/v1/public/plan"])

    def test_c1_uses_public_api_base_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            op = FakeOpener(json.dumps(PLAN))
            run_main(make_site(tmp), op, env={"PUBLIC_API_BASE": "https://api.staging.example.test"})
            self.assertEqual(op.urls, ["https://api.staging.example.test/billing/v1/public/plan"])

    # c2
    def test_c2_old_price_env_vars_have_no_effect(self):
        env = {"PUBLIC_PLAN_PRICE_BRL": "999", "PUBLIC_PLAN_FRANCHISE_USD": "999",
               "PUBLIC_TRIAL_CREDIT_USD": "999", "PUBLIC_FX_BRL_PER_USD": "9"}
        with tempfile.TemporaryDirectory() as tmp:
            site = make_site(tmp)
            code, err = run_main(site, FakeOpener(json.dumps(PLAN)), env=env)
            self.assertEqual(code, 0, err)
            self.assertEqual((site / "a.html").read_text(encoding="utf-8"), "<p>R$ 137 | R$ 137 | R$ 20</p>")

    # c3
    def test_c3_billing_down_fails_build_with_clear_message_and_no_fallback_text(self):
        cases = {
            "network": FakeOpener(exc=urllib.error.URLError("connection refused")),
            "timeout": FakeOpener(exc=TimeoutError("timed out")),
            "http 404": FakeOpener(status=404),
            "http 503": FakeOpener(status=503),
            "not json": FakeOpener("<html>nope</html>"),
            "price absent": FakeOpener(json.dumps(plan_with(price_brl_cents=KeyError))),
            "price zero": FakeOpener(json.dumps(plan_with(price_brl_cents=0))),
            "fx null": FakeOpener(json.dumps(plan_with(fx_brl_per_usd=None))),
            "trial missing": FakeOpener(json.dumps(plan_with(trial_credits=KeyError))),
        }
        for name, op in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as tmp:
                site = make_site(tmp)
                code, err = run_main(site, op)
                self.assertNotEqual(code, 0)
                self.assertIn("billing", err.lower())
                for f in ("a.html", "sub/b.html"):
                    self.assertEqual((site / f).read_text(encoding="utf-8"), TEMPLATE, "HTML rewritten on failure")

    def test_c3_old_env_vars_do_not_rescue_a_billing_failure(self):
        env = {"PUBLIC_PLAN_PRICE_BRL": "125", "PUBLIC_PLAN_FRANCHISE_USD": "25",
               "PUBLIC_TRIAL_CREDIT_USD": "5", "PUBLIC_FX_BRL_PER_USD": "5"}
        with tempfile.TemporaryDirectory() as tmp:
            site = make_site(tmp)
            code, _ = run_main(site, FakeOpener(status=404), env=env)
            self.assertNotEqual(code, 0)
            self.assertEqual((site / "a.html").read_text(encoding="utf-8"), TEMPLATE)

    def test_c3_invalid_api_base_fails_without_default_fallback(self):
        for bad in ("http://api.example.test", "api.example.test", "https://", "https://a.b/",
                    "https://a.b/path", "ftp://a.b", "https://a b", "javascript:alert(1)"):
            with self.subTest(bad), tempfile.TemporaryDirectory() as tmp:
                site = make_site(tmp)
                op = FakeOpener(json.dumps(PLAN))
                code, err = run_main(site, op, env={"PUBLIC_API_BASE": bad})
                self.assertNotEqual(code, 0)
                self.assertIn("PUBLIC_API_BASE", err)
                self.assertEqual(op.urls, [], "must not fetch (nor fall back to default)")
                self.assertEqual((site / "a.html").read_text(encoding="utf-8"), TEMPLATE)

    def test_c3_usage_error_is_nonzero(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = render_pricing.main(["render_pricing.py"], env={}, opener=FakeOpener(json.dumps(PLAN)))
        self.assertNotEqual(code, 0)

    # c4
    def test_c4_fails_if_token_survives_rendering(self):
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp)
            (site / "typo.html").write_text("<p>{{plan_price}}</p>", encoding="utf-8")
            code, err = run_main(site, FakeOpener(json.dumps(PLAN)))
            self.assertNotEqual(code, 0)
            self.assertIn("typo.html", err)

    def test_c4_non_utf8_file_is_left_intact_and_build_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp)
            (site / "good.html").write_text("<p>{{plan_price|x}}</p>", encoding="utf-8")
            (site / "bad.html").write_bytes(b"\xff\xfe<p>x</p>")
            code, err = run_main(site, FakeOpener(json.dumps(PLAN)))
            self.assertNotEqual(code, 0)
            self.assertIn("bad.html", err)
            self.assertEqual((site / "bad.html").read_bytes(), b"\xff\xfe<p>x</p>")

    def test_c4_real_site_pages_render_without_leftover_tokens(self):
        cfg = render_pricing.build_config(PLAN)
        pages = sorted(SITE.rglob("*.html"))
        self.assertTrue(pages)
        for f in pages:
            out = render_pricing.render(f.read_text(encoding="utf-8"), cfg)
            self.assertNotIn("{{", out, str(f))


class NoMonetaryLiterals(unittest.TestCase):
    # c2
    def test_c2_script_has_no_old_vars_or_price_literals(self):
        src = SCRIPT.read_text(encoding="utf-8")
        for var in OLD_VARS:
            self.assertNotIn(var, src, "script still references %s" % var)
        code = re.sub(r'"""[\s\S]*?"""', "", src)
        code = re.sub(r"#.*", "", code)
        self.assertNotRegex(code, r"\b(?:[2-9]|\d{2,})\.\d{2,}\b", "numeric price/fx literal in script")
        self.assertNotRegex(code, r"\b(?:2500|12500|13700|9990|5000000|4962582|5\.0377)\b")

    def test_c2_deploy_yml_has_no_old_variables_and_renders_before_upload(self):
        y = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        for var in OLD_VARS:
            self.assertNotIn(var, y, "deploy.yml still references %s" % var)
        step, upload = y.find("python3 scripts/render_pricing.py site"), y.find("actions/upload-pages-artifact")
        self.assertGreaterEqual(step, 0)
        self.assertLess(step, upload)

    def test_c2_claude_md_no_longer_documents_old_variables(self):
        md = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
        for var in OLD_VARS:
            self.assertNotIn(var, md, "CLAUDE.md still documents %s" % var)

    def test_c2_no_old_variable_or_fixed_price_anywhere_in_site_or_scripts(self):
        files = [p for d in (SITE, ROOT / "scripts") for p in d.rglob("*")
                 if p.is_file() and p.suffix in (".html", ".js", ".css", ".py", ".json", ".txt", ".xml")]
        self.assertTrue(files)
        offenders = []
        for p in files:
            txt = p.read_text(encoding="utf-8", errors="replace")
            for var in OLD_VARS:
                if var in txt:
                    offenders.append("%s: %s" % (p.relative_to(ROOT), var))
            # plan/franchise/trial amounts (old 125/25 and fixture values) must come from tokens
            for m in re.finditer(r"R\$(?:\s|&nbsp;|&#160;|\u00a0)*(?:1?25|137|99,90)(?![\d.,]\d)", htmllib.unescape(txt)):
                offenders.append("%s: %r" % (p.relative_to(ROOT), m.group(0)))
        self.assertEqual(offenders, [], "fixed monetary value / old var:\n" + "\n".join(offenders[:20]))


if __name__ == "__main__":
    unittest.main()
