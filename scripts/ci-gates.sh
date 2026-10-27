#!/usr/bin/env bash
# The merge bot gates: no personal data in tracked files or history, then the tests.
set -euo pipefail
cd "$(dirname "$0")/.."
# Only the synthetic fixture PDFs may be tracked; a real statement must never be committed.
if git ls-files | grep -E '\.(pdf|xlsx?|csv)$' | grep -v -E '^tests/fixtures/'; then
  echo "tracked document outside tests/fixtures above; real files never go in Git" >&2
  exit 1
fi
python3 scripts/pii_scan.py --tracked
python3 scripts/pii_scan.py --history
python3 -m unittest discover -s tests
npm ci --ignore-scripts --omit=optional --no-audit --no-fund
node --test
