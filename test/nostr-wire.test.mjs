/**
 * test/nostr-wire.test.mjs
 *
 * Run: npm run test:nostr-wire
 *
 * Runs against the compiled output in dist/, so it exercises what actually
 * ships rather than a separately-transpiled copy of the source.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NAMESPACE,
  KIND_AGENT_ENGRAM,
  memoryRecord,
  slugMemory,
  slugPhase,
  buildMemoryEngram,
} from '../dist/nostr-wire.js';

const PUBKEY = 'a'.repeat(64);

const PRIVATE_EVENT = {
  id: 'evt-0001',
  agentId: 'agent-7',
  primitive: 'think',
  visibility: 'private',
  text: 'considered the Ọ̀rúnmìlà branch',
  tool: 'graph_engine',
  params: '{"depth":3}',
  createdAt: '2026-08-20T12:00:00Z',
  blobId: 'blob-abc',
  cipherHash: 'sha256:def',
  commitmentTx: '0xfeed',
};

const PUBLIC_EVENT = { ...PRIVATE_EVENT, id: 'evt-0002', visibility: 'public' };

const CIPHERTEXT = 'AhFakeNip44Ciphertext==';

test('the wire body is flat and keeps the blob linkage', () => {
  // cipher_hash and blob_id travel so a reader can verify the engram refers to
  // the same blob the commitment covers, without moving the payload onto a
  // relay that is not built to hold it.
  const rec = memoryRecord(PRIVATE_EVENT);
  assert.equal(rec.event_id, 'evt-0001');
  assert.equal(rec.agent_id, 'agent-7');
  assert.equal(rec.blob_id, 'blob-abc');
  assert.equal(rec.cipher_hash, 'sha256:def');
  assert.equal(rec.commitment_tx, '0xfeed');
});

test('Yorùbá text survives the projection verbatim', () => {
  assert.equal(memoryRecord(PRIVATE_EVENT).text, 'considered the Ọ̀rúnmìlà branch');
});

test('slug is namespaced to triune and keyed by agent and event', () => {
  const slug = slugMemory('agent-7', 'evt-0001');
  assert.equal(slug, `mem/${NAMESPACE}/memory/agent-7/evt-0001`);
});

test('two memories from one agent do not share an address', () => {
  // Engrams are addressable: a slug without the event id would make each new
  // memory silently replace the previous one.
  assert.notEqual(slugMemory('agent-7', 'evt-1'), slugMemory('agent-7', 'evt-2'));
});

test('an agent id with awkward characters still yields a valid slug', () => {
  // Agent ids are free text; the slug grammar is [a-z0-9_-] per segment.
  assert.equal(slugPhase('Agent Ọ̀run/7'), `mem/${NAMESPACE}/phase/agent-orun-7`);
});

test('a private memory becomes a well-formed engram', () => {
  const ev = buildMemoryEngram({
    event: PRIVATE_EVENT,
    pubkey: PUBKEY,
    ownerPubkey: PUBKEY,
    dTag: 'deadbeef',
    ciphertext: CIPHERTEXT,
    createdAt: 1700000000,
  });
  assert.equal(ev.kind, KIND_AGENT_ENGRAM);
  const names = ev.tags.map((t) => t[0]);
  assert.ok(names.includes('d'));
  assert.ok(names.includes('p'));
  assert.ok(names.includes('primitive'));
  assert.ok(!('sig' in ev), 'this module holds no key and must not fabricate a sig');
});

test('a public memory is refused rather than silently leaked', () => {
  // The load-bearing rule. An engram's content is defined to be NIP-44
  // ciphertext, so publishing a public body as one yields an event that looks
  // encrypted, is not, and leaks with nothing reporting a problem.
  assert.throws(
    () =>
      buildMemoryEngram({
        event: PUBLIC_EVENT,
        pubkey: PUBKEY,
        ownerPubkey: PUBKEY,
        dTag: 'deadbeef',
        ciphertext: CIPHERTEXT,
      }),
    /looks encrypted and is not/,
  );
});

test('an engram without an HMACd d tag is refused', () => {
  // Inherited from organism-core: this module cannot compute the HMAC, so a
  // missing tag must fail loudly rather than publish a raw slug.
  assert.throws(
    () =>
      buildMemoryEngram({
        event: PRIVATE_EVENT,
        pubkey: PUBKEY,
        ownerPubkey: PUBKEY,
        dTag: '',
        ciphertext: CIPHERTEXT,
      }),
    /must be HMACd by the key owner/,
  );
});
