#!/usr/bin/env bash
set -euo pipefail
mkdir -p docs
cat > docs/RECEIPT_SCHEMA_V1.md <<'DOC'
# Receipt Schema V1
- receipt_id
- agent_id
- primitive
- visibility
- blob_id
- cipher_hash
- commitment_tx
- timestamp
- core_version
- library_set_hash
DOC

echo "phase3-hardening:ok"
