#!/usr/bin/env bash
set -euo pipefail
mkdir -p .orchestrator
cat > .orchestrator/workers.json <<'JSON'
{
  "roles": ["adapter", "tests", "docs", "release"],
  "dispatch": "local-child-process"
}
JSON

echo "phase4-workers:ok"
