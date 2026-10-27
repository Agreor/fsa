import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import pii_scan  # noqa: E402

# Fakes are built at runtime so this file itself carries no matching text.
IBAN = "BE" + "68" + " " + "5390" + " " + "0754" + " " + "7034"
CARD = "4111" + "1111" + "1111" + "1111"
EMAIL = "someone" + "@" + "gmail" + ".com"
KEY = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2"
LONG = "1234" + "5678" + "9012"


def kinds(text, extra=()):
    return {kind for _, kind in pii_scan.scan_text(text, extra)}


class ScanText(unittest.TestCase):
    def test_flags_iban(self):
        self.assertIn("iban", kinds("account " + IBAN))

    def test_flags_iban_without_spaces(self):
        self.assertIn("iban", kinds(IBAN.replace(" ", "")))

    def test_flags_card_number_passing_luhn(self):
        self.assertIn("card", kinds("card " + CARD))

    def test_ignores_digit_run_failing_luhn_as_card(self):
        self.assertNotIn("card", kinds("id " + "1234" + "5678" + "9012" + "3456"))

    def test_flags_email(self):
        self.assertIn("email", kinds(EMAIL))

    def test_allows_example_domain_email(self):
        self.assertEqual(set(), kinds("a" + "@" + "example" + ".com"))

    def test_flags_key(self):
        self.assertIn("key", kinds(KEY))

    def test_flags_private_key_block(self):
        self.assertIn("key", kinds("-----BEGIN " + "RSA PRIVATE KEY-----"))

    def test_flags_long_digit_run(self):
        self.assertIn("digits", kinds("ref " + LONG))

    def test_passes_clean_text(self):
        self.assertEqual(set(), kinds("const total = 12.5; // dates 2026-10-27"))

    def test_extra_pattern_from_private_list(self):
        self.assertIn("extra", kinds("see Jane Doe here", extra=[r"Jane Doe"]))

    def test_finding_never_contains_the_value(self):
        for _, kind in pii_scan.scan_text(IBAN, ()):
            self.assertNotIn("BE68", kind)

    def test_allows_all_zero_digit_run(self):
        self.assertEqual(set(), kinds("!= " + "0" * 40))

    def test_allows_github_noreply_address(self):
        self.assertEqual(set(), kinds("$3 != " + "noreply" + "@" + "github.com"))

    def test_marker_skips_a_line(self):
        self.assertEqual(set(), kinds(IBAN + "  # pii-ok"))


class ScanCli(unittest.TestCase):
    def run_cli(self, *args, cwd):
        return subprocess.run(
            [sys.executable, os.path.join(ROOT, "scripts", "pii_scan.py"), *args],
            cwd=cwd, capture_output=True, text=True)

    def repo(self, tmp, content):
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=tmp, check=True)
        with open(os.path.join(tmp, "f.txt"), "w") as handle:
            handle.write(content)
        subprocess.run(["git", "add", "f.txt"], cwd=tmp, check=True)

    def test_staged_blocks_a_dirty_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.repo(tmp, EMAIL + "\n")
            done = self.run_cli("--staged", cwd=tmp)
            self.assertEqual(1, done.returncode)
            self.assertIn("f.txt:1:email", done.stdout)
            self.assertNotIn(EMAIL, done.stdout)

    def test_staged_passes_a_clean_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.repo(tmp, "hello\n")
            self.assertEqual(0, self.run_cli("--staged", cwd=tmp).returncode)

    def test_staged_reads_the_staged_blob_not_the_working_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.repo(tmp, EMAIL + "\n")
            with open(os.path.join(tmp, "f.txt"), "w") as handle:
                handle.write("clean\n")
            self.assertEqual(1, self.run_cli("--staged", cwd=tmp).returncode)

    def test_tracked_handles_a_file_added_but_not_yet_committed(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.repo(tmp, "clean\n")
            self.assertEqual(0, self.run_cli("--tracked", cwd=tmp).returncode)

    def test_history_finds_a_value_removed_later(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.repo(tmp, EMAIL + "\n")
            env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com",
                       GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.com")
            subprocess.run(["git", "commit", "-qm", "a"], cwd=tmp, check=True, env=env)
            with open(os.path.join(tmp, "f.txt"), "w") as handle:
                handle.write("clean\n")
            subprocess.run(["git", "commit", "-qam", "b"], cwd=tmp, check=True, env=env)
            self.assertEqual(1, self.run_cli("--history", cwd=tmp).returncode)
            self.assertEqual(0, self.run_cli("--tracked", cwd=tmp).returncode)


if __name__ == "__main__":
    unittest.main()
