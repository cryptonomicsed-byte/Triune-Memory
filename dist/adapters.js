import { createHash, randomUUID } from 'node:crypto';
export class WalrusAdapter {
    mem = new Map();
    async put(c) { const id = `walrus_${randomUUID()}`; this.mem.set(id, c); return id; }
    async get(id) { return this.mem.get(id) ?? null; }
}
export class SealAdapter {
    encrypt(p, a) { return Buffer.from(`${a}::${p}`).toString('base64'); }
    rotate(a) { return `rotated:${a}:${Date.now()}`; }
}
export class SuiCommitAdapter {
    async commit(payload) { const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); return { tx: `sui_tx_${hash.slice(0, 16)}`, hash }; }
}
