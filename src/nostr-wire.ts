/**
 * nostr-wire — publishing Triune memory events onto the ecosystem's wire.
 *
 * A `MemoryEvent` already gets a blob and a commitment tx, which answers "can
 * this be tampered with after the fact?" Neither answers "can another agent
 * read it?" — the memory is durable and private to this orchestrator. Putting
 * it on the shared wire is what makes it *portable*: any runtime holding the
 * agent's key can read the same memory, which is the entire premise of NIP-AE.
 *
 * ## visibility is load-bearing here
 *
 * `MemoryEvent.visibility` is `'private' | 'public'`, and the two must not
 * travel the same way:
 *
 *   * **private** → a NIP-AE engram (`kind:30174`), whose content is NIP-44
 *     encrypted to the agent↔owner pair. Only a holder of the key reads it.
 *   * **public** → the same engram shape is wrong. An engram's content is
 *     *defined* to be ciphertext, so putting a plaintext body there produces an
 *     event that looks encrypted, is not, and leaks silently.
 *
 * So [`buildMemoryEngram`] refuses a `public` event outright rather than
 * quietly downgrading it. A component that genuinely wants public memory
 * should publish it under a public vocabulary, not smuggle it through a format
 * whose privacy guarantee it is not honouring.
 *
 * ## This module does not implement the wire contract
 *
 * `organism-core/bridge/nostr-wire` is the TypeScript implementation for this
 * ecosystem — canonical NIP-01 serialization, the kind guard, slug grammar and
 * normalisation. One per language, because the contract's failure mode is
 * silent divergence and each extra copy is another chance to diverge in a way
 * only a *different* implementation can detect.
 *
 * organism-core is the nerve centre this orchestrator already coordinates
 * with, so depending on it adds no new relationship to the ecosystem — it
 * makes an existing one explicit.
 *
 * ## Signing and encryption happen elsewhere
 *
 * This builds **unsigned** events. Triune-Memory holds no agent secret, and
 * both the signature and the NIP-44 encryption require one. The signer
 * encrypts the body, computes the `d` tag (also keyed by the conversation
 * key), and signs the id.
 */

import {
  buildEngram,
  buildSlug,
  KIND_AGENT_ENGRAM,
  type UnsignedEvent,
} from 'organism-core/bridge/nostr-wire';

import type { MemoryEvent } from './types.js';

/** Namespace segment, registered in minipae's NAMESPACES.md before first write. */
export const NAMESPACE = 'triune';

export { KIND_AGENT_ENGRAM };

/**
 * The wire body for a memory event, before encryption.
 *
 * Flat and self-describing so a Rust, Julia or Python reader can interpret it
 * without importing Triune's types.
 *
 * `cipherHash` and `blobId` travel; the blob itself does not. A reader can
 * verify the engram refers to the same blob the commitment covers without this
 * module having to move the payload onto a relay that is not built to hold it.
 */
export interface MemoryRecord {
  event_id: string;
  agent_id: string;
  primitive: string;
  text: string;
  tool?: string;
  params?: string;
  created_at: string;
  blob_id: string;
  cipher_hash: string;
  commitment_tx?: string;
}

/** Project a `MemoryEvent` onto its wire body. */
export function memoryRecord(ev: MemoryEvent): MemoryRecord {
  return {
    event_id: ev.id,
    agent_id: ev.agentId,
    primitive: ev.primitive,
    text: ev.text,
    tool: ev.tool,
    params: ev.params,
    created_at: ev.createdAt,
    blob_id: ev.blobId,
    cipher_hash: ev.cipherHash,
    commitment_tx: ev.commitmentTx,
  };
}

/**
 * Engram slug for one memory event.
 *
 * Keyed by agent and event id: memory is per-agent, and engrams are
 * addressable, so a slug without the event id would make each new memory
 * silently replace the last.
 */
export function slugMemory(agentId: string, eventId: string): string {
  return buildSlug(NAMESPACE, 'memory', agentId, eventId);
}

/** Engram slug for an agent's current orchestrator phase. */
export function slugPhase(agentId: string): string {
  return buildSlug(NAMESPACE, 'phase', agentId);
}

/**
 * Build the unsigned NIP-AE engram for a **private** memory event.
 *
 * `ciphertext` is the NIP-44 encryption of `memoryRecord(ev)`, and `dTag` is
 * the HMAC'd slug — both keyed by the agent↔owner conversation key, which this
 * module does not have. The signer supplies them.
 *
 * @throws on a `public` event. An engram's content is defined to be
 *   ciphertext; putting a plaintext body there yields an event that looks
 *   encrypted, is not, and leaks with nothing reporting a problem.
 */
export function buildMemoryEngram(opts: {
  event: MemoryEvent;
  pubkey: string;
  ownerPubkey: string;
  dTag: string;
  ciphertext: string;
  createdAt?: number;
}): UnsignedEvent {
  const { event, pubkey, ownerPubkey, dTag, ciphertext, createdAt } = opts;

  if (event.visibility === 'public') {
    throw new Error(
      `memory event ${event.id} is public; an NIP-AE engram's content is ` +
        'defined to be NIP-44 ciphertext, so publishing a public body as one ' +
        'would produce an event that looks encrypted and is not. Publish ' +
        'public memory under a public vocabulary instead.',
    );
  }

  return buildEngram({
    pubkey,
    ownerPubkey,
    dTag,
    ciphertext,
    extraTags: [
      ['primitive', event.primitive],
      ['agent', event.agentId],
    ],
    createdAt,
  });
}
