# Triune Memory

## Autonomous Orchestrator

Commands:
- `npm run orchestrator:init`
- `npm run orchestrator:enqueue`
- `npm run orchestrator:run-once`
- `npm run orchestrator:run`
- `npm run orchestrator:status`
- `npm run orchestrator:pause`
- `npm run orchestrator:resume`

Phase tasks live in `.orchestrator/tasks/phaseN.json`.
Phase advances only when:
1) required phase tasks are done
2) docs gate passes (`README.md` exists)
3) tests gate passes (`npm run build`)
4) commit gate passes (clean git tree)
