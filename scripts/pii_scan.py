#!/usr/bin/env python3
"""Block personal data and secrets before they reach this public repository.

Modes: --staged (index blobs changed), --tracked (every file in the index), --history (every added line ever committed).
Findings print file:line:kind only, never the matched value. Extra patterns, one regex per line,
come from the gitignored private/scan-extra.txt. Owner identifiers that must never appear (a wallet address,
an account number) are kept only as SHA-256 hashes, one per line, in the gitignored private/scan-hashes.txt or ~/.config/fsa-scan/scan-hashes.txt (shared by every worktree);
`--hash` prints them from a hidden prompt, so the identifier is never stored or typed on a command line.
A line containing 'pii-ok' (for example in a trailing comment) is skipped.
"""
import getpass
import hashlib
import os
import re
import subprocess
import sys

MARKER = "pii-ok"
SAFE_EMAIL_DOMAINS = ("example.com", "example.org", "example.net", "users.noreply.github.com")
SAFE_ADDRESSES = ("noreply@github.com",)

IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b")
CARD = re.compile(r"(?<![\d-])(?:\d[ -]?){13,19}(?![\d-])")
EMAIL = re.compile(r"[\w.+-]+@([\w-]+(?:\.[\w-]+)+)")
DIGITS = re.compile(r"(?<![\d.])\d{9,}(?![\d.])")
WALLET = re.compile(r"\b0x[a-fA-F0-9]{40}\b|\b(?:bc1|tb1)[a-z0-9]{25,87}\b|\b[xyzXYZ]pub[A-Za-z0-9]{100,}\b")
KEYS = re.compile(
    r"sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|(?i:api[_-]?key|secret|token)\s*[:=]\s*['\"][^'\"\s]{16,}['\"]")


def luhn(number):
    total = 0
    for i, ch in enumerate(reversed(number)):
        digit = int(ch)
        if i % 2:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


TOKEN = re.compile(r"[A-Za-z0-9]{20,}")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def scan_text(text, extra=(), hashes=()):
    """Return (line number, kind) for each finding; the matched value is never returned."""
    found = []
    custom = [re.compile(p) for p in extra]
    for number, line in enumerate(text.splitlines(), 1):
        if MARKER in line:
            continue
        kinds = set()
        if IBAN.search(line):
            kinds.add("iban")
        for match in CARD.finditer(line):
            digits = re.sub(r"\D", "", match.group())
            if 13 <= len(digits) <= 19 and luhn(digits):
                kinds.add("card")
        for match in EMAIL.finditer(line):
            if match.group().lower() not in SAFE_ADDRESSES and not match.group(1).lower().endswith(SAFE_EMAIL_DOMAINS):
                kinds.add("email")
        if any(len(set(m.group())) > 1 for m in DIGITS.finditer(line)):  # a run of one digit is a placeholder
            kinds.add("digits")
        if WALLET.search(line):
            kinds.add("wallet")
        if KEYS.search(line):
            kinds.add("key")
        if hashes and any(digest(t) in hashes or digest(t.lower()) in hashes for t in TOKEN.findall(line)):
            kinds.add("owner-id")
        if any(p.search(line) for p in custom):
            kinds.add("extra")
        found.extend((number, kind) for kind in sorted(kinds))
    return found


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, check=True).stdout


def load_extra():
    path = os.path.join("private", "scan-extra.txt")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        return [line.strip() for line in handle if line.strip() and not line.startswith("#")]


def load_hashes():
    """Hashes from the clone's private/ folder and from ~/.config/fsa-scan, which every worktree shares."""
    found = set()
    for path in (os.path.join("private", "scan-hashes.txt"),
                 os.path.join(os.path.expanduser("~"), ".config", "fsa-scan", "scan-hashes.txt")):
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                found |= {line.strip().lower() for line in handle if re.fullmatch(r"[0-9a-fA-F]{64}", line.strip())}
    return found


def decode(blob):
    return blob.decode("utf-8", errors="replace")


def blobs(mode):
    if mode == "--staged":
        names = git("diff", "--cached", "--name-only", "--diff-filter=ACM", "-z").split(b"\0")
        for name in filter(None, names):
            yield name.decode(), decode(git("show", b":" + name))
    else:
        names = git("ls-files", "-z").split(b"\0")
        for name in filter(None, names):
            yield name.decode(), decode(git("show", b":" + name))


def history_blobs():
    log = decode(git("log", "--all", "-p", "--unified=0", "--format=commit %h"))
    commit, name, added = "", "", []
    for line in log.splitlines() + ["commit end"]:
        if line.startswith("commit "):
            if added:
                yield f"{commit}:{name}", "\n".join(added)
            commit, name, added = line.split()[1], "", []
        elif line.startswith("+++ "):
            if added:
                yield f"{commit}:{name}", "\n".join(added)
            name, added = line[4:], []
        elif line.startswith("+") and not line.startswith("+++"):
            added.append(line[1:])


def main(argv):
    mode = argv[0] if argv else "--staged"
    if mode == "--hash":
        value = getpass.getpass("Identifier (hidden): ").strip()
        for form in dict.fromkeys((value, value.lower())):
            print(digest(form))
        return 0
    if mode not in ("--staged", "--tracked", "--history"):
        print("usage: pii_scan.py --staged | --tracked | --history | --hash", file=sys.stderr)
        return 2
    extra = load_extra()
    hashes = load_hashes()
    source = history_blobs() if mode == "--history" else blobs(mode)
    bad = 0
    for name, text in source:
        for number, kind in scan_text(text, extra, hashes):
            print(f"{name}:{number}:{kind}")
            bad += 1
    if bad:
        print(f"pii-scan: {bad} finding(s); values are not shown. Remove them or add '{MARKER}' to a safe line.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
