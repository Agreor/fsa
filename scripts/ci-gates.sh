#!/usr/bin/env bash
# The merge bot gates: no personal data in tracked files or history, then the tests.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/pii_scan.py --tracked
python3 scripts/pii_scan.py --history
python3 -m unittest discover -s tests
