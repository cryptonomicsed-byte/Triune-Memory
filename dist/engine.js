import { createHash } from 'node:crypto';
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
    store;
    bridge;
    constructor(store, bridge) {
        this.store = store;
        this.bridge = bridge;
    }
    birth(agentId, name) {
        const agents = this.store.loadAgents();
        if (agents[agentId])
            return agents[agentId];
        const memoryRoot = createHash('sha256').update(`${agentId}:${Date.now()}`).digest('hex');
        const s = { agentId, name, memoryRoot, createdAt: new Date().toISOString() };
        agents[agentId] = s;
        this.store.saveAgents(agents);
        return s;
    }
    async write(agentId, primitive, text, visibility, tool, params) {
        const agents = this.store.loadAgents();
        if (!agents[agentId])
            throw new Error('E_STATE_NOT_BORN');
        // Real persistence: signed + encrypted NIP-AE engram via minipae.
        const e = this.bridge.writeMemory({ agentId, primitive, text, visibility, tool, params });
        // Local cache only (offline convenience); relay stays authoritative.
        const events = this.store.loadEvents(agentId);
        events.push(e);
        this.store.saveEvents(agentId, events);
        return e;
    }
    async recall(agentId) {
        // Real recall: query + decrypt through the bridge (relay of record).
        return this.bridge.recall(agentId);
    }
}
