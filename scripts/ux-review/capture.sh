#!/usr/bin/env bash
# Drive the built app with agent-browser and save text, accessibility tree and screenshot per screen state.
# usage: capture.sh URL OUT_DIR WIDTH HEIGHT   (run from the repo root, after npm ci)
set -u
URL=$1; O=$2; W=$3; H=$4
AB="node_modules/.bin/agent-browser --session fsa-ux-$W"
# Absolute: agent-browser resolves upload paths from its daemon's folder, and a missing file freezes the page.
F=$PWD/tests/fixtures/pdf
mkdir -p "$O"
ev(){ $AB eval "$1" >/dev/null 2>&1; }
tab(){ ev "[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim().startsWith('$1')).click()"; sleep 0.8; }
view(){ ev "[...document.querySelectorAll('#money-views button')].find(b=>b.textContent.trim()==='$1').click()"; sleep 0.8; }
cap(){ n="$W-$1"
  $AB eval "document.body.innerText" > "$O/$n.txt" 2>&1
  $AB snapshot > "$O/$n.snap.txt" 2>&1
  $AB screenshot "$O/$n.png" --full >/dev/null 2>&1 || $AB screenshot "$O/$n.png" >/dev/null 2>&1; }
alltabs(){ for t in Home Investments Review Data; do tab $t; cap "$1-$t"; done
  tab Money; for v in Overview Spending Accounts Cards; do view $v; cap "$1-Money-$v"; done; }
fresh(){ $AB open "$URL" >/dev/null 2>&1; $AB wait --load networkidle >/dev/null 2>&1; sleep 0.5; }
bad(){ fresh; tab Data; $AB upload '#file' "$F/$1" >/dev/null 2>&1; sleep 0.5; $AB click '#prepare' >/dev/null 2>&1; $AB wait 8000 >/dev/null 2>&1; cap "err-$1"; }

$AB set viewport "$W" "$H" >/dev/null 2>&1; fresh; $AB set viewport "$W" "$H" >/dev/null 2>&1; sleep 1
alltabs empty
tab Data
$AB fill '#account-form input[name=name]' 'Fixture Bank' >/dev/null 2>&1; $AB click '#account-form button' >/dev/null 2>&1; sleep 1; cap account-added
$AB upload '#file' "$F/synthetic-text.pdf" >/dev/null 2>&1; sleep 0.5; $AB click '#prepare' >/dev/null 2>&1
$AB wait --fn "!document.querySelector('#save').disabled" --timeout 60000 >/dev/null 2>&1; cap preview
$AB click '#save' >/dev/null 2>&1; $AB wait --text 'Import saved.' --timeout 20000 >/dev/null 2>&1; cap saved
alltabs filled
# Each bad file on a fresh page, so an earlier message cannot hide a missing one.
bad synthetic-blank.pdf; bad synthetic-garbage.bin; bad synthetic-locked.pdf
fresh; tab Data; cap reload-Data
$AB errors > "$O/$W-errors.txt" 2>&1; $AB console > "$O/$W-console.txt" 2>&1
$AB close >/dev/null 2>&1
n=$(ls "$O" | grep -c "^$W-.*\.png$"); echo "$W: $n screenshots"
[ "$n" -ge 23 ] || { echo "expected 23 screenshots at $W" >&2; exit 1; }
# Refuse evidence from a failed command, a blank or wedged tab, or a page whose script did not run.
badf=$(grep -l -E '^✗|^""$|page_wedged' "$O/$W"-*.txt 2>/dev/null | grep -v -E 'errors|console' || true)
[ -z "$badf" ] || { echo "failed captures at $W:" $badf >&2; exit 1; }
grep -q 'Cash on hand' "$O/$W-filled-Home.txt" && ! grep -q 'Statement file' "$O/$W-empty-Home.txt" \
  || { echo "app did not render at $W; see $O/$W-empty-Home.png" >&2; exit 1; }
