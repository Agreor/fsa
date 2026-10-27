# fsa

A small installable web app. Data stays in the browser on the owner's device. This repository holds code only.

## No personal data in this repository

This repository is public. Git history is permanent once pushed.

- Real source files live in a private folder outside the repository, or in the gitignored `private/`.
- Tests use synthetic files that copy each source's file layout with invented names, amounts and numbers.
- Everything the app learns about its owner is personal. It stays in the browser or a gitignored file.
- Keys and secrets go in the server function's secret store, never in code.
- `scripts/pii_scan.py` blocks account and card numbers, emails, long digit runs and key patterns.
  Run `git config core.hooksPath .githooks` once per clone to scan every commit.
  Add owner-specific patterns, one regex per line, to the gitignored `private/scan-extra.txt`.

## Checks

`bash scripts/ci-gates.sh`
