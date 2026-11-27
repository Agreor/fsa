# Agent Instructions

This repository holds code only. Read `README.md` for the personal-data rules and checks before any change.

Project context, status and decisions are kept outside this repository. Agents in the owner's workspace find them
through the workspace map (`MAP.md`, row FSA).

For the project's purpose, answer from the opening paragraph of `README.md` and stop.

An agent that may not read private folders (Codex) stops there for questions about the project's status or
decisions: say the project context is private and cannot be read in this session, and offer to describe the
public code instead. Do not rebuild status or decisions from code unless asked.

Before domain work, read this repository's `GLOSSARY.md` and use its terms. This repository has no `docs/adr/`: the
decision records are kept privately with the project context, found through the workspace map (`MAP.md`, row FSA).
An agent without access to them says so instead of guessing a decision, and does not reopen one without saying so.

Never add a personal value (amount, account number, name, balance, ISIN, address, password or key) to any file here.
Run `bash scripts/ci-gates.sh` before shipping.
