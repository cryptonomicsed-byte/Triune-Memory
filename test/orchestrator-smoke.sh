#!/usr/bin/env bash
set -euo pipefail
npm run orchestrator:status >/dev/null
npm run orchestrator:pause >/dev/null
npm run orchestrator:resume >/dev/null
echo ok
