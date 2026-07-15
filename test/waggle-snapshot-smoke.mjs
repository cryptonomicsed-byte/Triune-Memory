// Round-trip smoke for the Waggle-snapshot storage adapter (compiled).
// Uses the in-memory dev adapters — no network, no waggled needed — and
// exercises store → retrieve plus the three tamper-detection paths.
import assert from 'node:assert/strict';
import { WalrusAdapter, SuiCommitAdapter } from '../dist/adapters.js';
import { SealEnvelope } from '../dist/adapters/seal-envelope.js';
import { WaggleSnapshotAdapter } from '../dist/adapters/waggle-snapshot.js';

// SealEnvelope (not the dev SealAdapter) — a snapshot has no separate plaintext
// copy, so retrieve must decrypt the blob, and only SealEnvelope round-trips.
const walrus = new WalrusAdapter();
const seal = new SealEnvelope('local://test');
const adapter = new WaggleSnapshotAdapter(walrus, seal, new SuiCommitAdapter());

const snap = {
  prefix: 'repo://',
  at: '2026-07-13T03:19:21Z',
  hash: 'c35eb7b23dfee4e227d35bcb232f58899dad0693b1ba4bae6bd15f09ed5e6e9e',
  signals: [
    { id: 'a', resource: 'repo://cheap.go', kind: 'gold', intensity: 5 },
    { id: 'b', resource: 'repo://pricey.go', kind: 'gold', intensity: 5 },
  ],
};

// store anchors the field hash on-chain
const receipt = await adapter.store(snap);
assert.equal(receipt.waggleHash, snap.hash);
assert.equal(receipt.signalCount, 2);
assert.ok(receipt.commitmentTx.length > 0, 'got an on-chain commitment');

// retrieve returns byte-identical content
const back = await adapter.retrieve(receipt);
assert.deepEqual(back, snap);

// storage-integrity: a receipt whose cipherHash no longer matches the stored
// blob (blob edited, or receipt forged) is rejected before any content is used
const r2 = await adapter.store(snap);
const mut = { ...r2, cipherHash: 'deadbeef'.repeat(8) };
await assert.rejects(() => adapter.retrieve(mut), /E_BLOB_TAMPERED/);

// content-hash mismatch (receipt claims a different field hash than stored)
await assert.rejects(
  () => adapter.retrieve({ ...r2, waggleHash: 'f'.repeat(64) }),
  /E_HASH_MISMATCH/
);

// malformed snapshot rejected at store time
await assert.rejects(() => adapter.store({}), /E_SNAPSHOT_MALFORMED/);

console.log('ok');
