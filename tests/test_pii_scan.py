import hashlib
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
ETH = "0x" + "ab12" * 10
BECH = "bc1" + "q" + "w5x" * 10
XPUB = "xpub" + "6Cq" * 40
OWN = "Zq" + "9Lm4" * 8


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


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

    def test_flags_ethereum_style_address(self):
        self.assertIn("wallet", kinds("addr " + ETH))

    def test_flags_bech32_address(self):
        self.assertIn("wallet", kinds("addr " + BECH))

    def test_flags_extended_public_key(self):
        self.assertIn("wallet", kinds(XPUB))

    def test_allows_a_plain_git_sha(self):
        self.assertEqual(set(), kinds("commit " + "ab12" * 10))

    def test_allows_short_hex_literal(self):
        self.assertEqual(set(), kinds("mask = 0xff00ff"))

    def test_flags_a_token_whose_hash_is_listed(self):
        found = {kind for _, kind in pii_scan.scan_text("addr " + OWN, (), [digest(OWN)])}
        self.assertIn("owner-id", found)

    def test_flags_the_lowercase_form_of_a_listed_token(self):
        found = {kind for _, kind in pii_scan.scan_text(OWN.lower(), (), [digest(OWN.lower())])}
        self.assertIn("owner-id", found)

    def test_passes_a_token_whose_hash_is_not_listed(self):
        self.assertEqual([], pii_scan.scan_text("addr " + OWN, (), [digest("other")]))

    def test_listed_hash_does_not_flag_short_words(self):
        self.assertEqual([], pii_scan.scan_text("hello world", (), [digest("hello")]))

    def test_marker_inside_a_trailing_comment_skips_the_line(self):
        self.assertEqual(set(), kinds(IBAN + "  // pii-ok: invented placeholder"))

    def test_marker_skips_a_line(self):
        self.assertEqual(set(), kinds(IBAN + "  # pii-ok"))


class ScanCli(unittest.TestCase):
    def test_hash_command_prints_hashes_not_the_value(self):
        done = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "pii_scan.py"), "--hash"],
                              input=OWN + "\n", capture_output=True, text=True)
        self.assertEqual(0, done.returncode)
        self.assertIn(digest(OWN), done.stdout)
        self.assertIn(digest(OWN.lower()), done.stdout)
        self.assertNotIn(OWN, done.stdout + done.stderr)

    def test_user_level_hash_file_applies_in_any_worktree(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as home:
            self.repo(tmp, "x " + OWN + "\n")
            os.makedirs(os.path.join(home, ".config", "fsa-scan"))
            with open(os.path.join(home, ".config", "fsa-scan", "scan-hashes.txt"), "w") as handle:
                handle.write(digest(OWN) + "\n")
            done = subprocess.run(
                [sys.executable, os.path.join(ROOT, "scripts", "pii_scan.py"), "--staged"],
                cwd=tmp, capture_output=True, text=True, env=dict(os.environ, HOME=home))
            self.assertEqual(1, done.returncode)
            self.assertIn("owner-id", done.stdout)

    def test_staged_blocks_a_listed_token_from_the_hash_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.repo(tmp, "x " + OWN + "\n")
            os.makedirs(os.path.join(tmp, "private"))
            with open(os.path.join(tmp, "private", "scan-hashes.txt"), "w") as handle:
                handle.write("# owner ids\n" + digest(OWN) + "\n")
            done = self.run_cli("--staged", cwd=tmp)
            self.assertEqual(1, done.returncode)
            self.assertIn("f.txt:1:owner-id", done.stdout)
            self.assertNotIn(OWN, done.stdout)

    def test_paths_scans_an_untracked_file_and_hides_the_value(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "runs", "r1"))
            with open(os.path.join(tmp, "runs", "r1", "console.log"), "w") as handle:
                handle.write("ok\n" + EMAIL + "\n")
            done = self.run_cli("--paths", "runs", cwd=tmp)
            self.assertEqual(1, done.returncode)
            self.assertIn(os.path.join("runs", "r1", "console.log") + ":2:email", done.stdout)
            self.assertNotIn(EMAIL, done.stdout)

    def test_paths_passes_clean_text_and_lists_binary_files_as_not_scanned(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "runs"))
            with open(os.path.join(tmp, "runs", "a.txt"), "w") as handle:
                handle.write("clean\n")
            with open(os.path.join(tmp, "runs", "shot.png"), "wb") as handle:
                handle.write(b"\x89PNG\0\0" + EMAIL.encode())
            done = self.run_cli("--paths", "runs", cwd=tmp)
            self.assertEqual(0, done.returncode)
            self.assertIn("not scanned", done.stdout)
            self.assertIn("shot.png", done.stdout)

    def test_paths_rejects_a_missing_path_instead_of_passing(self):
        with tempfile.TemporaryDirectory() as tmp:
            done = self.run_cli("--paths", "nowhere", cwd=tmp)
            self.assertEqual(2, done.returncode)
            self.assertIn("nowhere", done.stderr)

    def test_paths_rejects_an_empty_directory_and_a_binary_only_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "empty"))
            self.assertEqual(2, self.run_cli("--paths", "empty", cwd=tmp).returncode)
            os.makedirs(os.path.join(tmp, "shots"))
            with open(os.path.join(tmp, "shots", "a.png"), "wb") as handle:
                handle.write(b"\x89PNG\0\0")
            self.assertEqual(2, self.run_cli("--paths", "shots", cwd=tmp).returncode)

    def test_paths_fails_on_an_unreadable_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            locked = os.path.join(tmp, "runs", "locked")
            os.makedirs(locked)
            with open(os.path.join(tmp, "runs", "ok.txt"), "w") as handle:
                handle.write("clean\n")
            os.chmod(locked, 0)
            try:
                done = self.run_cli("--paths", "runs", cwd=tmp)
            finally:
                os.chmod(locked, 0o700)
            self.assertEqual(2, done.returncode)

    def test_paths_scans_bom_marked_utf16_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "runs"))
            with open(os.path.join(tmp, "runs", "console.log"), "wb") as handle:
                handle.write(("ok\n" + EMAIL + "\n").encode("utf-16"))
            done = self.run_cli("--paths", "runs", cwd=tmp)
            self.assertEqual(1, done.returncode)
            self.assertIn("console.log:2:email", done.stdout)
            self.assertNotIn("not scanned", done.stdout)

    def test_paths_scans_bom_marked_utf32_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "runs"))
            with open(os.path.join(tmp, "runs", "console.log"), "wb") as handle:
                handle.write(("ok\n" + EMAIL + "\n").encode("utf-32"))
            done = self.run_cli("--paths", "runs", cwd=tmp)
            self.assertEqual(1, done.returncode)
            self.assertIn("console.log:2:email", done.stdout)

    def test_paths_follows_a_symlinked_directory_and_survives_a_loop(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "runs"))
            os.makedirs(os.path.join(tmp, "elsewhere"))
            with open(os.path.join(tmp, "elsewhere", "console.log"), "w") as handle:
                handle.write(EMAIL + "\n")
            os.symlink(os.path.join(tmp, "elsewhere"), os.path.join(tmp, "runs", "linked"))
            os.symlink(os.path.join(tmp, "runs"), os.path.join(tmp, "runs", "loop"))
            done = self.run_cli("--paths", "runs", cwd=tmp)
            self.assertEqual(1, done.returncode)
            self.assertIn("console.log:1:email", done.stdout)

    def test_paths_lists_undecodable_files_instead_of_passing_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "runs"))
            with open(os.path.join(tmp, "runs", "ok.txt"), "w") as handle:
                handle.write("clean\n")
            with open(os.path.join(tmp, "runs", "latin.log"), "wb") as handle:
                handle.write(("jos\u00e9" + "@" + "gmail.com\n").encode("cp1252"))  # not valid UTF-8
            with open(os.path.join(tmp, "runs", "short16.log"), "wb") as handle:
                handle.write(b"\xff\xfea")  # BOM-marked UTF-16 cut off mid-character
            done = self.run_cli("--paths", "runs", cwd=tmp)
            self.assertEqual(0, done.returncode)
            self.assertIn("latin.log", done.stdout)
            self.assertIn("short16.log", done.stdout)
            self.assertIn("not scanned", done.stdout)

    def test_paths_without_a_path_is_a_usage_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(2, self.run_cli("--paths", cwd=tmp).returncode)

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

    def allow(self, tmp, path, digest):
        os.makedirs(os.path.join(tmp, "scripts"), exist_ok=True)
        with open(os.path.join(tmp, "scripts", "scan-allowlist.txt"), "w") as handle:
            handle.write("# vendored or generated files\n" + digest + "  " + path + "\n")

    def test_allowlisted_file_with_matching_hash_is_skipped(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            self.repo(tmp, EMAIL + "\n")
            self.allow(tmp, "f.txt", hashlib.sha256((EMAIL + "\n").encode()).hexdigest())
            subprocess.run(["git", "add", "scripts"], cwd=tmp, check=True)
            self.assertEqual(0, self.run_cli("--staged", cwd=tmp).returncode)

    def test_allowlisted_path_is_scanned_when_its_content_changed(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            self.repo(tmp, EMAIL + "\n")
            self.allow(tmp, "f.txt", hashlib.sha256(b"something else").hexdigest())
            subprocess.run(["git", "add", "scripts"], cwd=tmp, check=True)
            self.assertEqual(1, self.run_cli("--staged", cwd=tmp).returncode)

    def test_history_skips_an_allowlisted_path(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            self.repo(tmp, EMAIL + "\n")
            self.allow(tmp, "f.txt", hashlib.sha256((EMAIL + "\n").encode()).hexdigest())
            env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com",
                       GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.com")
            subprocess.run(["git", "add", "scripts"], cwd=tmp, check=True)
            subprocess.run(["git", "commit", "-qm", "a"], cwd=tmp, check=True, env=env)
            self.assertEqual(0, self.run_cli("--history", cwd=tmp).returncode)

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
