# Triune Memory Delivery Phases

## Completion Definition (DONE)
A phase is done only when code + tests + docs + commit are present.
Project is DONE when all phases below are complete.

### Phase 2 — Real Integrations
- Walrus adapter: persistent blob put/get/delete over configured endpoint
- SEAL adapter: envelope encryption/decryption + key rotation metadata
- Sui adapter: on-chain commitment tx submit + tx hash capture
- Integration tests for all adapters

### Phase 3 — Runtime Hardening
- Deterministic receipt schema v1
- Retry/backoff and idempotency keys
- Recovery/replay from chain+blob pointers
- Health checks + diagnostics

### Phase 4 — Agent Orchestration
- Multi-agent task planner (issue queue)
- Worker roles: adapter, tests, docs, release
- Auto phase advancement when acceptance checks pass

### Phase 5 — OpenClaw Skill
- Skill commands to run planner/dispatch/check/advance
- Operator runbook
- Safety rails (max loops, budget/time caps, pause/resume)

### Phase 6 — Release
- Semver tag
- changelog
- production config templates
- final verification report
