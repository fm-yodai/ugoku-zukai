#!/usr/bin/env python3
"""VOICEVOX の利用規約への同意の記録（setup_voice.py --status と consent.json）の検査。VOICEVOX もネットワークも使わない。
python3 test_voice_consent.py で回す。"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..")
SETUP = os.path.join(SCRIPTS, "setup_voice.py")
sys.path.insert(0, SCRIPTS)
import setup_voice  # noqa: E402


class ConsentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "voicevox")

    def tearDown(self):
        self.tmp.cleanup()

    def status(self, *extra):
        return subprocess.run([sys.executable, SETUP, "--status", "--home", self.home, *extra], capture_output=True, text=True)

    def installed(self):
        os.makedirs(self.home, exist_ok=True)
        with open(os.path.join(self.home, "installed.json"), "w", encoding="utf-8") as f:
            json.dump({"home": self.home, "voices": []}, f)

    def test_not_installed(self):
        r = self.status()
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn("入っていない", r.stdout)
        self.assertFalse(os.path.exists(self.home))          # 調べるだけで、置き場を作らない

    def test_installed_without_record(self):                 # 記録の仕組みができる前に入れた置き場。もう一度だけ聞く
        self.installed()
        r = self.status()
        self.assertEqual(r.returncode, 3)
        self.assertIn("同意の記録がない", r.stdout)

    def test_recorded(self):
        self.installed()
        setup_voice.record_consent(self.home, now="2026-11-11T15:00:00")
        r = self.status()
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("2026-11-11", r.stdout)
        self.assertIn("聞かずに", r.stdout)
        j = json.loads(self.status("--json").stdout)
        self.assertEqual((j["installed"], j["consent"], j["ask"]), (True, "recorded", False))
        self.assertEqual(j["agreed_at"], "2026-11-11T15:00:00")
        self.assertEqual(j["terms"], setup_voice.TERMS_URL)

    def test_record_keeps_first_date(self):
        self.installed()
        setup_voice.record_consent(self.home, now="2026-11-11T15:00:00")
        setup_voice.record_consent(self.home, now="2026-12-01T09:00:00")
        with open(os.path.join(self.home, "consent.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["agreed_at"], "2026-11-11T15:00:00")

    def test_terms_changed_asks_again(self):                 # 規約の場所か、音声モデルの版が変わったら聞き直す
        self.installed()
        for change in ({"terms": "https://example.com/old-terms"}, {"vvm": "0.0.1"}):
            setup_voice.record_consent(self.home, now="2026-11-11T15:00:00")
            p = os.path.join(self.home, "consent.json")
            with open(p, encoding="utf-8") as f:
                rec = json.load(f)
            rec.update(change)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(rec, f)
            r = self.status()
            self.assertEqual(r.returncode, 3, change)
            self.assertIn("聞き直す", r.stdout)

    def test_broken_record_asks(self):
        self.installed()
        with open(os.path.join(self.home, "consent.json"), "w") as f:
            f.write("{")
        self.assertEqual(self.status().returncode, 3)

    def test_without_agree_still_refuses(self):
        r = subprocess.run([sys.executable, SETUP, "--home", self.home], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertFalse(os.path.exists(self.home))


if __name__ == "__main__":
    unittest.main()
