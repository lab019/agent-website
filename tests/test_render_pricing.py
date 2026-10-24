"""Acceptance LIC-2808: deploy-time pricing render (scripts/render_pricing.py).

Contract under test: format_brl(Decimal), load_config(env), render(html, config), CLI.
Stdlib only. Run: python3 -m unittest discover -s tests
"""
import contextlib
import html
import io
import os
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
SCRIPT = ROOT / "scripts" / "render_pricing.py"
sys.path.insert(0, str(ROOT / "scripts"))

import render_pricing  # noqa: E402  (module does not exist yet: RED)

FIXTURE_ENV = {
    "PUBLIC_PLAN_PRICE_BRL": "137",
    "PUBLIC_PLAN_FRANCHISE_USD": "25",
    "PUBLIC_TRIAL_CREDIT_USD": "5",
    "PUBLIC_FX_BRL_PER_USD": "4",
}
TEMPLATE = "<p>{{plan_price|PRICE_FB}} | {{plan_franchise|FRANCHISE_FB}} | {{trial_credit|TRIAL_FB}}</p>"


def build(env):
    """load_config + render without leaking warnings to the test output."""
    with contextlib.redirect_stderr(io.StringIO()):
        return render_pricing.render(TEMPLATE, render_pricing.load_config(env))


def page_text(rel):
    return (SITE / rel).read_text(encoding="utf-8")


def num(pattern_value):
    return r"R\$[ \u00a0]%s(?![\d.,]\d)" % pattern_value


class RenderPricing(unittest.TestCase):
    # p2
    def test_p2_values_come_from_config(self):
        config = render_pricing.load_config(FIXTURE_ENV)
        for rel in ("preco/index.html", "index.html"):
            out = render_pricing.render(page_text(rel), config)
            self.assertNotIn("{{", out, rel + ": unresolved token")
            self.assertRegex(out, num("137"), rel + ": plan price from config missing")
            self.assertRegex(out, num("100"), rel + ": franchise (25 USD x 4) missing")
            if rel == "preco/index.html":  # a home so cita o teste de 14 dias, sem valor
                self.assertRegex(out, num("20"), rel + ": trial credit (5 USD x 4) missing")
            self.assertNotRegex(html.unescape(out), r"R\$(\s|&nbsp;|\u00a0)*1?25(?!\d)", rel + ": old literal survived")

    # p3
    def test_p3_without_config_publishes_no_price_number(self):
        config = render_pricing.load_config({})
        for rel in ("preco/index.html", "index.html", "whatsapp/index.html"):
            out = render_pricing.render(page_text(rel), config)
            self.assertNotIn("{{", out, rel + ": unresolved token")
            for v in ("125", "25", "137", "100", "20"):
                self.assertNotRegex(out, num(v), "%s: price number R$ %s without config" % (rel, v))
        for rel in ("preco/index.html", "index.html"):
            t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ",
                       render_pricing.render(page_text(rel), config)))
            self.assertRegex(t, r"14 dias", rel)
            self.assertRegex(t, r"sem cart[aã]o", rel)
        for rel in ("preco/index.html",):
            t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ",
                       render_pricing.render(page_text(rel), config)))
            self.assertRegex(t, r"(?i)whatsapp[^.]{0,80}(fora|n[aã]o (entra|entram|inclui|incluem|vale|valem))"
                                r"|(fora|n[aã]o inclui|n[aã]o incluem)[^.]{0,80}whatsapp", rel)

    # p4
    def test_p4_partial_and_invalid_config_falls_back_per_token(self):
        # sem PUBLIC_PLAN_FRANCHISE_USD a franquia é o próprio preço (a mensalidade inteira vira franquia)
        out = build({"PUBLIC_PLAN_PRICE_BRL": "137"})
        self.assertEqual(out, "<p>R$ 137 | R$ 137 | TRIAL_FB</p>")
        # sem preço e sem franquia, nenhum número
        self.assertEqual(build({}), "<p>PRICE_FB | FRANCHISE_FB | TRIAL_FB</p>")

        for bad_fx in (None, "abc", "0", "-5", ""):
            env = dict(FIXTURE_ENV)
            if bad_fx is None:
                del env["PUBLIC_FX_BRL_PER_USD"]
            else:
                env["PUBLIC_FX_BRL_PER_USD"] = bad_fx
            self.assertEqual(build(env), "<p>R$ 137 | FRANCHISE_FB | TRIAL_FB</p>", "fx=%r" % bad_fx)

        for var, expected in (
            ("PUBLIC_PLAN_PRICE_BRL", "<p>PRICE_FB | R$ 100 | R$ 20</p>"),
            ("PUBLIC_PLAN_FRANCHISE_USD", "<p>R$ 137 | FRANCHISE_FB | R$ 20</p>"),
            ("PUBLIC_TRIAL_CREDIT_USD", "<p>R$ 137 | R$ 100 | TRIAL_FB</p>"),
        ):
            for bad in ("0", "abc", "-5"):
                env = dict(FIXTURE_ENV, **{var: bad})
                self.assertEqual(build(env), expected, "%s=%r" % (var, bad))

    def test_p4_invalid_value_warns_on_stderr_and_never_raises(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            config = render_pricing.load_config(dict(FIXTURE_ENV, PUBLIC_FX_BRL_PER_USD="abc"))
            render_pricing.render(TEMPLATE, config)
        self.assertIn("PUBLIC_FX_BRL_PER_USD", err.getvalue())

    def test_p4_decimal_comma_is_accepted(self):
        self.assertEqual(build(dict(FIXTURE_ENV, PUBLIC_PLAN_PRICE_BRL="137,50")),
                         "<p>R$ 137,50 | R$ 100 | R$ 20</p>")

    # p6
    def test_p6_format_brl_pt_br(self):
        self.assertEqual(render_pricing.format_brl(Decimal("125")), "R$ 125")
        self.assertEqual(render_pricing.format_brl(Decimal("1250.5")), "R$ 1.250,50")
        self.assertEqual(render_pricing.format_brl(Decimal("99.999")), "R$ 100")

    def test_p6_franchise_rounds_half_up(self):
        env = dict(FIXTURE_ENV, PUBLIC_FX_BRL_PER_USD="4.1234")
        self.assertIn("| R$ 103 |", build(env))  # 25 x 4.1234 = 103.085
        env = dict(FIXTURE_ENV, PUBLIC_FX_BRL_PER_USD="4.02")
        self.assertIn("| R$ 101 |", build(env))  # 100.5 -> half-up, not banker's

    # CLI
    def test_p6_cli_rewrites_html_in_place_and_never_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp) / "site"
            (site / "sub").mkdir(parents=True)
            (site / "a.html").write_text(TEMPLATE, encoding="utf-8")
            (site / "sub" / "b.html").write_text(TEMPLATE, encoding="utf-8")
            (site / "note.txt").write_text(TEMPLATE, encoding="utf-8")
            base = {k: v for k, v in os.environ.items() if not k.startswith("PUBLIC_")}
            r = subprocess.run([sys.executable, str(SCRIPT), str(site)], env=dict(base, **FIXTURE_ENV),
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            for f in ("a.html", "sub/b.html"):
                self.assertEqual((site / f).read_text(encoding="utf-8"), "<p>R$ 137 | R$ 100 | R$ 20</p>")
            self.assertEqual((site / "note.txt").read_text(encoding="utf-8"), TEMPLATE)
            # invalid env: exit 0, fallbacks
            (site / "a.html").write_text(TEMPLATE, encoding="utf-8")
            r = subprocess.run([sys.executable, str(SCRIPT), str(site)],
                               env=dict(base, PUBLIC_PLAN_PRICE_BRL="abc"), capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual((site / "a.html").read_text(encoding="utf-8"),
                             "<p>PRICE_FB | FRANCHISE_FB | TRIAL_FB</p>")

    # p7
    def test_p7_deploy_renders_pricing_from_repo_variables(self):
        y = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        for var in ("PUBLIC_PLAN_PRICE_BRL", "PUBLIC_PLAN_FRANCHISE_USD",
                    "PUBLIC_TRIAL_CREDIT_USD", "PUBLIC_FX_BRL_PER_USD"):
            self.assertRegex(y, r"%s:\s*\$\{\{\s*vars\.%s\s*\}\}" % (var, var))
        step = y.find("python3 scripts/render_pricing.py site")
        upload = y.find("actions/upload-pages-artifact")
        self.assertGreaterEqual(step, 0, "deploy.yml does not run render_pricing.py site")
        self.assertLess(step, upload, "render must run before the pages upload step")


def build_with_err(env):
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        out = render_pricing.render(TEMPLATE, render_pricing.load_config(env))
    return out, err.getvalue()


class RenderPricingInputHardening(unittest.TestCase):
    # F1
    def test_f1_valid_amount_formats_are_accepted(self):
        for raw, shown in (("125", "R$ 125"), ("125.5", "R$ 125,50"), ("137,50", "R$ 137,50"),
                           ("  125  ", "R$ 125"), ("1234567", "R$ 1.234.567"), ("12.25", "R$ 12,25")):
            out, _ = build_with_err(dict(FIXTURE_ENV, PUBLIC_PLAN_PRICE_BRL=raw))
            self.assertTrue(out.startswith("<p>%s |" % shown), "%r -> %r" % (raw, out))

    def test_f1_invalid_amount_formats_are_absent_with_warning(self):
        invalid = ("1.250", "1,250", "0.001", "١٢٥", "1" * 30, "12\n5",
                   "12345678", "1.2345", "1.", ".5")
        for var, fb in (("PUBLIC_PLAN_PRICE_BRL", "<p>PRICE_FB | R$ 100 | R$ 20</p>"),
                        ("PUBLIC_PLAN_FRANCHISE_USD", "<p>R$ 137 | FRANCHISE_FB | R$ 20</p>"),
                        ("PUBLIC_TRIAL_CREDIT_USD", "<p>R$ 137 | R$ 100 | TRIAL_FB</p>")):
            for raw in invalid:
                out, err = build_with_err(dict(FIXTURE_ENV, **{var: raw}))
                self.assertEqual(out, fb, "%s=%r" % (var, raw))
                self.assertIn(var, err, "no warning naming %s for %r" % (var, raw))

    def test_f1_invalid_fx_makes_derived_tokens_fall_back(self):
        for raw in ("1.250", "٤", "1" * 30, "4\n4"):
            out, err = build_with_err(dict(FIXTURE_ENV, PUBLIC_FX_BRL_PER_USD=raw))
            self.assertEqual(out, "<p>R$ 137 | FRANCHISE_FB | TRIAL_FB</p>", repr(raw))
            self.assertIn("PUBLIC_FX_BRL_PER_USD", err)

    # F2
    def test_f2_result_rounding_to_zero_is_absent(self):
        out, _ = build_with_err(dict(FIXTURE_ENV, PUBLIC_PLAN_FRANCHISE_USD="0.1", PUBLIC_FX_BRL_PER_USD="0.1"))
        self.assertIn("| FRANCHISE_FB |", out)
        self.assertNotIn("R$ 0", out)
        out, _ = build_with_err(dict(FIXTURE_ENV, PUBLIC_TRIAL_CREDIT_USD="1", PUBLIC_FX_BRL_PER_USD="0.2"))
        self.assertTrue(out.endswith("| TRIAL_FB</p>"), out)
        self.assertNotIn("R$ 0", out)

    def test_f2_zero_plan_price_stays_absent(self):
        for raw in ("0", "0.00", "0,0"):
            out, _ = build_with_err(dict(FIXTURE_ENV, PUBLIC_PLAN_PRICE_BRL=raw))
            self.assertTrue(out.startswith("<p>PRICE_FB |"), repr(raw))
            self.assertNotIn("R$ 0", out)

    # F3
    def test_f3_never_raises_for_any_env_value(self):
        weird = ("1" * 30, "١٢٥", "12\n5", "\x00", "1e400", "nan", "inf", "-0", "R$ 5", "9" * 5000)
        for var in ("PUBLIC_PLAN_PRICE_BRL", "PUBLIC_PLAN_FRANCHISE_USD",
                    "PUBLIC_TRIAL_CREDIT_USD", "PUBLIC_FX_BRL_PER_USD"):
            for raw in weird:
                try:
                    out, _ = build_with_err(dict(FIXTURE_ENV, **{var: raw}))
                except Exception as exc:  # noqa: BLE001
                    self.fail("%s=%r raised %r" % (var, raw[:40], exc))
                self.assertNotIn("{{", out)
        out, _ = build_with_err(dict(FIXTURE_ENV, PUBLIC_PLAN_PRICE_BRL="1" * 30))
        self.assertTrue(out.startswith("<p>PRICE_FB |"), out)

    # F4
    def test_f4_cli_warns_about_leftover_braces_and_exits_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp)
            (site / "typo.html").write_text("<p>{{plan_price}} {{ plan_price|x}}</p>", encoding="utf-8")
            (site / "ok.html").write_text(TEMPLATE, encoding="utf-8")
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                code = render_pricing.main(["render_pricing.py", str(site)])
            self.assertEqual(code, 0)
            self.assertIn("typo.html", err.getvalue())
            self.assertNotIn("ok.html", err.getvalue())

    # F5
    def _run_main_with_bad_file(self, make_bad):
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp)
            good = site / "good.html"
            bad = site / "bad.html"
            good.write_text("<p>{{plan_price|x}}</p>", encoding="utf-8")
            original = make_bad(bad)
            err = io.StringIO()
            with mock.patch.dict(os.environ, {"PUBLIC_PLAN_PRICE_BRL": "137"}), \
                    contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                code = render_pricing.main(["render_pricing.py", str(site)])
            self.assertEqual(code, 0)
            self.assertIn("137", good.read_text(encoding="utf-8"))
            self.assertNotIn("{{", good.read_text(encoding="utf-8"))
            bad.chmod(0o644)
            self.assertEqual(bad.read_bytes(), original)
            self.assertIn("bad.html", err.getvalue())

    def test_f5_cli_skips_non_utf8_file_warns_and_exits_zero(self):
        def make_bad(path):
            path.write_bytes(b"\xff\xfe<p>x</p>")
            return b"\xff\xfe<p>x</p>"
        self._run_main_with_bad_file(make_bad)

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0, "root ignores file permissions")
    def test_f5_cli_skips_unreadable_file_warns_and_exits_zero(self):
        def make_bad(path):
            path.write_bytes(b"<p>x</p>")
            path.chmod(0o000)
            return b"<p>x</p>"
        self._run_main_with_bad_file(make_bad)


if __name__ == "__main__":
    unittest.main()
