import { createHash, randomUUID } from 'node:crypto';
export class TriuneMemory {
    store;
    walrus;
    seal;
    sui;
    constructor(store, walrus, seal, sui) {
        this.store = store;
        this.walrus = walrus;
        this.seal = seal;
        this.sui = sui;
    }
    birth(agentId, name) { const agents = this.store.loadAgents(); if (agents[agentId])
        return agents[agentId]; const memoryRoot = createHash('sha256').update(`${agentId}:${Date.now()}`).digest('hex'); const s = { agentId, name, memoryRoot, createdAt: new Date().toISOString() }; agents[agentId] = s; this.store.saveAgents(agents); return s; }
    async write(agentId, primitive, text, visibility, tool, params) { const agents = this.store.loadAgents(); if (!agents[agentId])
        throw new Error('E_STATE_NOT_BORN'); const cipher = this.seal.encrypt(text, agentId); const blobId = await this.walrus.put(cipher); const cipherHash = createHash('sha256').update(cipher).digest('hex'); const e = { id: randomUUID(), agentId, primitive, visibility, text, tool, params, createdAt: new Date().toISOString(), blobId, cipherHash }; const c = await this.sui.commit({ agentId, primitive, visibility, blobId, cipherHash, createdAt: e.createdAt }); e.commitmentTx = c.tx; const events = this.store.loadEvents(agentId); events.push(e); this.store.saveEvents(agentId, events); return e; }
    recall(agentId) { return this.store.loadEvents(agentId); }
    async verify(agentId) { const events = this.store.loadEvents(agentId); let ok = 0, bad = 0; for (const e of events) {
        const c = await this.walrus.get(e.blobId);
        if (!c) {
            bad++;
            continue;
        }
        const h = createHash('sha256').update(c).digest('hex');
        h === e.cipherHash ? ok++ : bad++;
    } return { agentId, total: events.length, ok, bad }; }
    rotate(agentId) { return this.seal.rotate(agentId); }
}
