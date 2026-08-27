/**
 * test/sse-subscriber.test.mjs
 *
 * Run: npm run test:sse-subscriber
 *
 * Runs against the compiled output in dist/, so it exercises what actually
 * ships rather than a separately-transpiled copy of the source.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TriuneSseSubscriber, parseSseData, iterateSseEvents } from '../dist/sse-subscriber.js';
import { TriuneMemory } from '../dist/engine.js';
import { LocalStore } from '../dist/store.js';

/**
 * Recording test-double for the bridge. It does NOT fake storage — it records
 * what the subscriber asked to write and returns a plain MemoryEvent so the
 * engine's local-cache path can be asserted. The REAL storage (minipae ->
 * NIP-AE -> relay) is proven separately by test/test_triune_bridge.py.
 */
class RecordingBridge {
  constructor() { this.writes = []; }
  writeMemory(input) {
    this.writes.push(input);
    return {
      id: `rec-${this.writes.length}`,
      agentId: input.agentId,
      primitive: input.primitive,
      visibility: input.visibility,
      text: input.text,
      tool: input.tool,
      params: input.params,
      createdAt: new Date().toISOString(),
    };
  }
  recall() { return []; }
}

function freshMemory() {
  const dir = mkdtempSync(join(tmpdir(), 'triune-sse-test-'));
  const memory = new TriuneMemory(
    new LocalStore(dir),
    new RecordingBridge(),
  );
  return { memory, dir };
}

test('parseSseData extracts JSON from a data: frame', () => {
  const frame = 'event: message\ndata: {"type":"connected","ok":true}';
  const parsed = parseSseData(frame);
  assert.deepEqual(parsed, { type: 'connected', ok: true });
});

test('parseSseData returns null for a frame with no data lines', () => {
  assert.equal(parseSseData(': keep-alive'), null);
});

test('agent_born births the agent using dna as agentId', async () => {
  const { memory, dir } = freshMemory();
  try {
    const sub = new TriuneSseSubscriber(memory, { kernelUrl: 'http://unused' });
    await sub.handleEvent({ type: 'agent_born', dna: 'dna-abc123', odu: 3 });
    const agents = new LocalStore(dir).loadAgents();
    assert.ok(agents['dna-abc123'], 'agent should be birthed under its dna');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('thought_sealed writes a commitment-only think event tied to the last agent_born', async () => {
  const { memory, dir } = freshMemory();
  try {
    const sub = new TriuneSseSubscriber(memory, { kernelUrl: 'http://unused' });
    await sub.handleEvent({ type: 'agent_born', dna: 'dna-xyz', odu: 1 });
    const id = await sub.handleEvent({
      type: 'thought_sealed',
      intent_hash: 'deadbeef',
      hermetic_score: 0.91,
    });
    assert.ok(id, 'should return a memory event id');
    const events = new LocalStore(dir).loadEvents('dna-xyz');
    assert.equal(events.length, 1);
    assert.equal(events[0].primitive, 'think');
    assert.match(events[0].text, /intent_hash:deadbeef/);
    // Never plaintext: the raw kernel event never carries thought text, and
    // this subscriber must not invent any.
    assert.doesNotMatch(events[0].text, /secret|prompt|content/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('act_executed writes a commitment-only act event with the tool name', async () => {
  const { memory, dir } = freshMemory();
  try {
    const sub = new TriuneSseSubscriber(memory, { kernelUrl: 'http://unused' });
    await sub.handleEvent({ type: 'agent_born', dna: 'dna-act', odu: 2 });
    const id = await sub.handleEvent({
      type: 'act_executed',
      tool: 'settle_transaction_tax',
      receipt_merkle: 'cafebabe',
      f1_score: 0.5,
    });
    assert.ok(id);
    const events = new LocalStore(dir).loadEvents('dna-act');
    assert.equal(events[0].primitive, 'act');
    assert.equal(events[0].tool, 'settle_transaction_tax');
    assert.match(events[0].text, /receipt_merkle:cafebabe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('events before any agent_born fall back to a stable placeholder agent, not a crash', async () => {
  const { memory, dir } = freshMemory();
  try {
    const sub = new TriuneSseSubscriber(memory, { kernelUrl: 'http://unused' });
    const id = await sub.handleEvent({ type: 'thought_sealed', intent_hash: 'ab', hermetic_score: 0.1 });
    assert.ok(id);
    const agents = new LocalStore(dir).loadAgents();
    assert.ok(agents['kernel-unattributed']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unrelated event types (e.g. toc_minted) are ignored, not errors', async () => {
  const { memory } = freshMemory();
  const sub = new TriuneSseSubscriber(memory, { kernelUrl: 'http://unused' });
  const id = await sub.handleEvent({ type: 'toc_minted', agent: 'x', dopamine_burned: 1, synapse_earned: 2 });
  assert.equal(id, null);
});

test('iterateSseEvents splits a streamed body into individual frames', async () => {
  const frames = [
    'data: {"type":"connected","ok":true}\n\n',
    'data: {"type":"agent_born","dna":"d1","odu":0}\n\n',
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(new TextEncoder().encode(f));
      controller.close();
    },
  });
  const out = [];
  for await (const ev of iterateSseEvents(stream)) out.push(ev);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'connected');
  assert.equal(out[1].type, 'agent_born');
});
