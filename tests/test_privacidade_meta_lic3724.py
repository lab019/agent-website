"""Acceptance LIC-3724 (criterion 1): the privacy policy names Meta, the data, the purpose, the legal basis and
how to withdraw consent, with the new date, in both languages.

criterion -> test
c1 | PT policy cites Meta, data, purpose, legal basis, withdrawal and the new date | PrivacyMeta::test_c1_pt_policy_covers_meta
c1 | EN policy says the same, with the same version | PrivacyMeta::test_c1_en_policy_covers_meta
c1 | the policy does not claim to send e-mail or phone to Meta (the real payload has neither) | PrivacyMeta::test_c1_policy_never_claims_email_or_phone_go_to_meta

Stdlib only.
"""
import re
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
VERSION = "2026-11-26"


def _text(page: str) -> str:
    html = (SITE / page / "index.html").read_text(encoding="utf-8")
    html = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", html)


class PrivacyMeta(unittest.TestCase):
    def test_c1_pt_policy_covers_meta(self):
        t = _text("privacidade")
        self.assertIn(f"Versão: {VERSION}", t)
        self.assertIn("26 de novembro de 2026", t)
        for needle in (
            "Meta Platforms",
            "identificador do clique no anúncio",
            "endereço IP",
            "medir e otimizar",
            "consentimento (art. 7º, I",
            "Como retirar o consentimento",
            "Configurações",
            "desmarcada",
        ):
            self.assertIn(needle, t, needle)

    def test_c1_en_policy_covers_meta(self):
        t = _text("en/privacy")
        self.assertIn(f"Version: {VERSION}", t)
        self.assertIn("November 26, 2026", t)
        for needle in (
            "Meta Platforms",
            "ad click identifier",
            "IP address",
            "measure and optimize",
            "consent (art. 7, I",
            "How to withdraw consent",
            "Settings",
            "unticked",
        ):
            self.assertIn(needle, t, needle)

    def test_c1_policy_never_claims_email_or_phone_go_to_meta(self):
        self.assertIn("Não enviamos seu e-mail, seu telefone nem seu nome", _text("privacidade"))
        self.assertIn("We do not send your email, phone number or name", _text("en/privacy"))


if __name__ == "__main__":
    unittest.main()
