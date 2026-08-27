import { createHash } from 'node:crypto';
import { LocalStore } from './store.js';
import { MinipaeBridge } from './minipae-bridge.js';
import { AgentState, MemoryEvent, Primitive, Visibility } from './types.js';

/**
 * TriuneMemory — orchestrator + memory engine.
 *
 * Memory now persists through the MinipaeBridge (real NIP-AE engrams on a
 * relay: BIP-340 signed, NIP-44 v2 encrypted). The LocalStore is only a local
 * cache and the agent registry; the relay is the source of truth.
 *
 * The fake Walrus/Seal/Sui adapters, and their verify()/rotate() methods, are
 * gone — see commit history. There is no fake storage left next to the real
 * one.
 */
export class TriuneMemory {
  constructor(private store: LocalStore, private bridge: MinipaeBridge) {}

  birth(agentId: string, name: string): AgentState {
    const agents = this.store.loadAgents();
    if (agents[agentId]) return agents[agentId];
    const memoryRoot = createHash('sha256').update(`${agentId}:${Date.now()}`).digest('hex');
    const s = { agentId, name, memoryRoot, createdAt: new Date().toISOString() };
    agents[agentId] = s;
    this.store.saveAgents(agents);
    return s;
  }

  async write(
    agentId: string,
    primitive: Primitive,
    text: string,
    visibility: Visibility,
    tool?: string,
    params?: string,
  ): Promise<MemoryEvent> {
    const agents = this.store.loadAgents();
    if (!agents[agentId]) throw new Error('E_STATE_NOT_BORN');

    // Real persistence: signed + encrypted NIP-AE engram via minipae.
    const e = this.bridge.writeMemory({ agentId, primitive, text, visibility, tool, params });

    // Local cache only (offline convenience); relay stays authoritative.
    const events = this.store.loadEvents(agentId);
    events.push(e);
    this.store.saveEvents(agentId, events);
    return e;
  }

  async recall(agentId: string): Promise<MemoryEvent[]> {
    // Real recall: query + decrypt through the bridge (relay of record).
    return this.bridge.recall(agentId);
  }
}
