#!/usr/bin/env bash
set -euo pipefail
mkdir -p skill-triune-autoloop
cat > skill-triune-autoloop/RUNBOOK.md <<'DOC'
# Triune Autoloop Runbook
1. npm run orchestrator:init
2. npm run orchestrator:run-once
3. npm run orchestrator:status
4. Repeat run-once or run
5. pause/resume as needed
DOC

echo "phase5-skill:ok"
