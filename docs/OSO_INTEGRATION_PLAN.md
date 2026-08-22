# OsO (Omo-Koda2) Integration Plan

## Why this was rewritten

The previous version of this plan described an in-process hook: OsO's
`birth`/`think`/`act` calling `triune.birth(agentId,name)` /
`triune.write(agentId,'think',...)` directly. That was never realistic —
`triune.birth`/`triune.write` are not primitives OsO's kernel exposes or
calls into; they only exist as `TriuneMemory` methods inside this repo
(`src/engine.ts`). OsO's real statements are `Statement::Birth` /
`Statement::Think` / `Statement::Act` in `omokoda-core/src/interpreter.rs`,
a Rust process running independently of this (TypeScript) one. An in-process
hook across a language and process boundary isn't a hook, it's two separate
systems pretending to share a call stack.

## The real integration point

OsO's kernel already emits real SSE events on `GET /v1/events`
(`omokoda-core/src/server.rs::events_handler`), broadcasting exactly the
three primitives this plan cares about, among others:

- `agent_born` (from `Statement::Birth`)
- `thought_sealed` (from `Statement::Think`)
- `act_executed` (from `Statement::Act`)

Triune-Memory subscribes to that stream instead of being called into. This
is implemented in `src/sse-subscriber.ts` (`TriuneSseSubscriber`), wired to
a standalone process via `src/sse-subscribe-cli.ts` (`npm run oso:subscribe`,
env `OMOKODA_KERNEL_URL`, default `http://localhost:8080`).

For each event, the subscriber calls the *existing* `TriuneMemory` pipeline
(`birth()` / `write()` in `src/engine.ts`) — unchanged, untouched by this
integration:

| SSE event       | TriuneMemory call                                    |
|------------------|-------------------------------------------------------|
| `agent_born`     | `memory.birth(dna, dna)`                               |
| `thought_sealed` | `memory.write(agentId, 'think', ..., 'public')`         |
| `act_executed`   | `memory.write(agentId, 'act', ..., 'public', tool, ..)` |

## What actually crosses the wire (and why this is commitment-only, not a plaintext mirror)

Per `shared/proto/events.proto` and `server.rs::sovereign_event_to_json`,
`/v1/events` is **unauthenticated**, and the kernel deliberately never
serializes plaintext or secrets onto it:

- `AgentBorn` carries `dna` (a fingerprint string) and `odu`. It never
  carries the BIP39 mnemonic — server.rs strips it explicitly (there was a
  real incident, 2026-07-25, where it leaked before this strip was added).
- `ThoughtSealed` carries only `intent_hash` + `hermetic_score` — no
  thought text.
- `ActExecuted` carries only `tool` + `receipt_merkle` + `f1_score` — no
  params, no result content.

So what Triune-Memory commits via this subscriber is hashes and scores, the
same kind of data OsO's own Sui-anchoring already deals in — not a copy of
memory *content*. This is intentional and matches the ask: a second,
durable, portable record of memory *events* on the Nostr wire (via
Triune-Memory's existing `SuiCommitAdapter`), not a duplicate of OsO's
native fractal memory (Tier 0-4, `specs/memory-fractal.md`), which keeps
being OsO's own, sole, full-fidelity memory system, exactly as today.

## Known limitation: no agent id on think/act events

`ThoughtSealed`/`ActExecuted` carry no agent identifier at all — only
`AgentBorn` does (`dna`). The subscriber tracks the most recently observed
`agent_born`'s `dna` as "current agent" and attributes subsequent
think/act events to it. This is correct for OsO's common single-
owner-steward deployment, but is not safe to trust under a concurrent
multi-agent kernel (server.rs does support per-agent dispatch via
`x-agent-id`/`x-agent-key`, and multiple agents can be born in one kernel
process — see `server::multi_agent_tests`). Fixing this for real requires
OsO to add an agent id to `ThoughtSealed`/`ActExecuted` in
`shared/proto/events.proto` and `sovereign_event_to_json`; that's a change
to OsO, out of scope for this repo, and is the next real step if/when
multi-agent kernels need this integration.

## Receipt unification

`TriuneMemory.write()` already returns a `commitmentTx` (from
`SuiCommitAdapter.commit()`) per memory event. Once OsO's own settlement
receipts (see `omokoda-core/src/onchain.rs::SettlementReceipt`, exposed as
the `settle_transaction_tax` tool) are correlated by hash, the two systems'
receipts can be cross-referenced by the shared `intent_hash` /
`receipt_merkle` values already present in both. No shared schema or shared
process is required — just matching hashes across two independently
anchored commitment logs.

## Recovery

Unchanged from before: replay commitments from Sui and hydrate blobs from
Walrus, using `TriuneMemory.verify()`/`recall()` — this was never dependent
on the (removed) in-process hook design and needs no change here.
