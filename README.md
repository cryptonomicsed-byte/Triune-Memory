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

## Storage layer (real, not fake)

Memory persistence is delegated to **minipae** — the canonical NIP-AE
(`kind:30174`) wire — via `triune_bridge.py`. Real BIP-340 Schnorr signing,
real NIP-44 v2 encryption, real relay persistence.

The old fake adapters were **removed**: `WalrusAdapter` (in-memory `Map`),
`SealAdapter` (base64, not encryption), `SuiCommitAdapter` (fabricated
`sui_tx_*` strings), and the unsigned `nostr-wire.ts`. There is no fake
storage left sitting next to the real one.

### How the bridge works

```
TriuneMemory (TS) → MinipaeBridge → triune_bridge.py → minipae → Nostr relay
```

- Identity is passed via env: `TRIUNE_NSEC` (agent secret, hex or `nsec1...`),
  optional `TRIUNE_OWNER` (owner pubkey; defaults to self-owned).
- `minipae` must be importable on the Python path.
- Relay: `TRIUNE_RELAY` env, default `wss://relay.damus.io`.

### Real test

```bash
# write → recall round-trip through minipae, against a real relay
MINIPAE_PATH=/path/to/minipae python3 test/test_triune_bridge.py
```

The TS unit tests use a recording test-double (not a storage fake) to assert
the subscriber's event→memory mapping; the real storage path is proven by
`test_triune_bridge.py`.

## Production deployment — SSE subscriber

The SSE subscriber (`dist/sse-subscribe-cli.js`) mirrors the Omo-Koda2 kernel's
live event stream into Triune-Memory's storage pipeline.

### Environment variables

Copy `.env.example` to `.env` and fill in the required values:

| Variable | Required | Default | Description |
|---|---|---|---|
| `OMOKODA_KERNEL_URL` | yes | `http://localhost:8080` | Base URL of the Omo-Koda2 kernel. The subscriber connects to `$OMOKODA_KERNEL_URL/v1/events`. |
| `MEMORY_DATA_DIR` | no | `./data` | Directory where `LocalStore` persists agent state. |
| `MINIPAE_URL` | no | `http://localhost:30174` | Base URL of a running minipae HTTP service. Used by `triune_bridge.py` when `import minipae` fails (i.e. minipae is not on `PYTHONPATH`). |
| `TRIUNE_NSEC` | yes (for writes) | — | Agent secret key, hex-encoded 32-byte secp256k1 scalar or `nsec1...` bech32. Required when the bridge runs in direct-minipae mode. |
| `TRIUNE_RELAY` | no | `wss://relay.damus.io` | Nostr relay used by `triune_bridge.py` for NIP-AE engram persistence. |
| `TRIUNE_OWNER` | no | self | Owner pubkey (hex or `npub1...`). Defaults to the agent's own pubkey (self-owned engrams). |

### Starting the SSE listener

```bash
# 1. (If minipae is a separate service) start minipae:
cd /path/to/minipae && python3 -m minipae.server --port 30174

# 2. Build Triune-Memory (if not already built):
npm run build

# 3. Run the subscriber (picks up .env automatically if you source it first):
export $(grep -v '^#' .env | xargs)
node dist/sse-subscribe-cli.js
```

The subscriber reconnects automatically (3-second back-off) if the SSE stream
ends or the kernel restarts.

### Systemd unit (production)

Save as `/etc/systemd/system/triune-memory-sse.service` and adjust paths:

```ini
[Unit]
Description=Triune-Memory SSE subscriber — mirrors Omo-Koda2 kernel events
After=network.target

[Service]
Type=simple
User=sovereign
WorkingDirectory=/opt/triune-memory
EnvironmentFile=/opt/triune-memory/.env
ExecStart=/usr/bin/node /opt/triune-memory/dist/sse-subscribe-cli.js
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=triune-memory-sse

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now triune-memory-sse
sudo journalctl -u triune-memory-sse -f
```
