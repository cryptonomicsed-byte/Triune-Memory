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
