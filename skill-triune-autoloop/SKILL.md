---
name: triune-autoloop
description: Orchestrate phased implementation of Triune Memory using spawned coding agents until completion criteria are met.
---

# Triune Autoloop Skill

## Purpose
Drive implementation across defined phases with bounded autonomous loops.

## Commands
- `npm run orchestrator:plan` — create/update task queue from `phases/PHASES.md`
- `npm run orchestrator:dispatch` — spawn workers for queued tasks
- `npm run orchestrator:check` — run tests/lints/docs checks and mark complete
- `npm run orchestrator:advance` — move to next phase if acceptance criteria are met
- `npm run orchestrator:run` — bounded loop (plan -> dispatch -> check -> advance)

## Safety Rails
- Never infinite-loop: obey `.orchestrator/loop-policy.json`.
- Stop and report when blocked by missing credentials/infra.
- Require tests/docs/commit before phase completion.
