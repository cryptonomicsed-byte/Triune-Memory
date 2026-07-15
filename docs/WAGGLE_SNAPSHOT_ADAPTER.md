# Waggle snapshot storage adapter

`src/adapters/waggle-snapshot.ts` gives Triune-Memory's durability pipeline a
new payload type: **portable field snapshots** from Waggle, the Agentic
stigmergy substrate.

## Why

Waggle can export a content-addressed capture of a field slice — every live
signal under a URI prefix at an instant, with original deposit timestamps
preserved so decay resumes exactly where it was captured (`GET /v1/snapshot`).
That JSON self-verifies inside one daemon, but nothing anchors it outside it: a
snapshot on disk can be quietly edited, so "reproduce the decision the swarm
made last Tuesday" is only as trustworthy as the file.

Triune already solves durable, tamper-evident memory: **Seal** (encrypt) →
**Walrus** (blob) → **Sui** (on-chain commitment). This adapter runs a field
snapshot through that same pipeline, so the snapshot's content hash becomes an
on-chain commitment. A field restored from it is *provably* the one captured —
which is exactly Waggle's top evidence tier: a verdict recalled from an
on-chain-anchored snapshot reads at `on-chain-anchored` (1.0), not
`self-report` (0.2).

## Shape

Adapters are injected (same convention as the engine), so it runs with the
in-memory dev adapters or the production HTTP/Sui clients unchanged.

```ts
const a = new WaggleSnapshotAdapter(walrus, seal, sui);

const snap    = await a.capture('http://waggled:7777', 'repo://'); // pull live
const receipt = await a.store(snap);        // Seal → Walrus → Sui anchor
const back    = await a.retrieve(receipt);  // fetch + verify, throws on tamper
await a.restore(receipt, 'http://fresh:7777'); // load into a fresh field
```

`SnapshotReceipt` binds the field content hash to `{blobId, cipherHash,
commitmentTx}`. `retrieve` throws on any of three failures rather than handing
back untrusted data:

- `E_BLOB_MISSING` — the blob is gone from storage.
- `E_BLOB_TAMPERED` — stored bytes no longer hash to the receipt's `cipherHash`.
- `E_HASH_MISMATCH` — decrypted snapshot's field hash ≠ the anchored `waggleHash`.

`restore` posts to `POST /v1/snapshot/load`; the daemon independently
re-verifies the content hash and resumes decay from the preserved timestamps.

Use `SealEnvelope` (not the dev `SealAdapter`) — a snapshot has no separate
plaintext copy, so `retrieve` must decrypt the blob, and only `SealEnvelope`
round-trips. Round-trip and tamper-path coverage: `test/waggle-snapshot-smoke.mjs`.
