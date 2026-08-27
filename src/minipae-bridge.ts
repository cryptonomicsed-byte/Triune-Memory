/**
 * MinipaeBridge — REAL NIP-AE persistence, replacing the fake storage layer.
 *
 * The old adapters were fake: WalrusAdapter was an in-memory Map,
 * SealAdapter "encrypted" with base64, SuiCommitAdapter fabricated tx hashes,
 * and nostr-wire.ts emitted unsigned events.
 *
 * This bridge delegates signing (BIP-340), encryption (NIP-44 v2), and
 * persistence (Nostr relay, kind:30174) to `triune_bridge.py`, which calls
 * minipae — the canonical, live-verified memory wire. Triune-Memory no longer
 * implements any of its own crypto or storage; it sends plaintext records to
 * the bridge and gets back real signed+encrypted engrams on a real relay.
 *
 * Identity is passed via the environment (TRIUNE_NSEC / TRIUNE_OWNER), never
 * argv, so it does not leak into the process list.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MemoryEvent, Primitive, Visibility } from './types.js';

export interface MinipaeBridgeOptions {
  python?: string;
  bridgePath?: string;
  relay?: string;
}

export interface WriteInput {
  agentId: string;
  primitive: Primitive;
  text: string;
  visibility: Visibility;
  tool?: string;
  params?: string;
}

export class MinipaeBridge {
  private python: string;
  private bridgePath: string;
  private relay: string;

  constructor(opts: MinipaeBridgeOptions = {}) {
    this.python = opts.python ?? 'python3';
    this.bridgePath =
      opts.bridgePath ?? fileURLToPath(new URL('../triune_bridge.py', import.meta.url));
    this.relay = opts.relay ?? process.env.TRIUNE_RELAY ?? 'wss://relay.damus.io';
  }

  private call(command: 'write' | 'recall', args: object): unknown {
    const out = execFileSync(
      this.python,
      [this.bridgePath, command, JSON.stringify(args)],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    return JSON.parse(out);
  }

  /** Write one memory as a real signed+encrypted NIP-AE engram. */
  writeMemory(input: WriteInput): MemoryEvent {
    const r = this.call('write', {
      agent_id: input.agentId,
      primitive: input.primitive,
      text: input.text,
      visibility: input.visibility,
      tool: input.tool,
      params: input.params,
      relay: this.relay,
    }) as { id: string };

    return {
      id: r.id,
      agentId: input.agentId,
      primitive: input.primitive,
      visibility: input.visibility,
      text: input.text,
      tool: input.tool,
      params: input.params,
      createdAt: new Date().toISOString(),
    };
  }

  /** Recall memories from the relay (real query + decrypt). */
  recall(agentId: string): MemoryEvent[] {
    const r = this.call('recall', { agent_id: agentId, relay: this.relay }) as Array<{
      id?: string;
      event_id?: string;
      agent_id: string;
      primitive: Primitive;
      text: string;
      tool?: string | null;
      params?: string | null;
      created_at: string;
    }>;

    return r.map((rec) => ({
      id: rec.id ?? rec.event_id ?? '',
      agentId: rec.agent_id,
      primitive: rec.primitive,
      visibility: 'private' as Visibility, // NIP-AE is private by definition
      text: rec.text,
      tool: rec.tool ?? undefined,
      params: rec.params ?? undefined,
      createdAt: rec.created_at,
    }));
  }
}
