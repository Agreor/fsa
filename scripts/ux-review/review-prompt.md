# FSA UX review prompt

Give this to a read-only agent after `bash scripts/ux-review/run.sh`. Replace `EVIDENCE` with the folder it printed.

---

You are reviewing the user interface of fsa, a small personal-finance web app, for quality problems.
Work only from the captured evidence. Do not open a browser, start anything, or edit any file except your own report.

## Evidence

Folder: `EVIDENCE`

- Each screen state has three files: `<width>-<state>.txt` (visible page text), `<width>-<state>.snap.txt`
  (accessibility tree) and `<width>-<state>.png` (full-page screenshot). Widths are 1280 and 390.
- States: `empty-<Tab>` and `empty-Money-<View>` (fresh app), `account-added`, `preview` (statement preview before
  saving), `saved`, `filled-<Tab>` and `filled-Money-<View>` (after one statement is imported),
  `err-synthetic-blank.pdf`, `err-synthetic-garbage.bin`, `err-synthetic-locked.pdf` (each bad file on a fresh page),
  `reload-Data` (after a reload).
- `dupes-1280.json` and `dupes-390.json` list lines repeated inside one view and sentences repeated across views.
  Treat them as leads, not findings.
- `<width>-errors.txt` and `<width>-console.txt` hold page errors and console output.
- The data is a synthetic statement: one account, "Fixture Bank", January 2026, four rows. The two identical
  Shop Alpha charges are real data. Saved imports is empty in `preview` because nothing is saved yet; that is correct.

## What to find

1. **Duplication**: the same figure, label or explanation twice on one screen, or repeated across screens without a
   reason. Ask of each element: does it earn its place, or does another element already say this?
2. **Awkward information**: wording that is wrong for the context, vague, jargon or internal codes, a formula where a
   plain sentence would do, inconsistent between screens, or contradicting another screen. Error messages must say
   what happened and what to do, in the user's terms.
3. **Interface that does not make sense**: pointless or misplaced controls, stale content left after an action,
   confusing order, unlabelled values, empty states that differ for no reason, cramped or cut-off layout at 390 px.

If the impeccable design skill is available, read its `distill`, `clarify`, `critique` and `product` references
first and apply them.

## How to work

- Read every `.txt` file at both widths.
- Look at every screenshot at 390 px, and at 1280 px for the preview, saved, error and filled states.
- Every finding must cite its file(s) and quote the exact text, or describe exactly what is visible.
  Do not report anything you cannot point to.
- Skip accessibility-name, performance and code concerns.
- Budget: at most 100 tool calls.

## Report

A ranked list, most harmful to a user first. For each finding: number, type (duplication / awkward wording /
confusing interface / layout), screen and state, evidence file and quoted text, why it is a problem (one sentence),
and the smallest fix (one sentence). Then a short list of what looked fine, and the screenshots you did not view.
