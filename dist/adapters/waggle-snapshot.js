import { createHash } from 'node:crypto';
export class WaggleSnapshotAdapter {
    walrus;
    seal;
    sui;
    constructor(walrus, seal, sui) {
        this.walrus = walrus;
        this.seal = seal;
        this.sui = sui;
    }
    // Pull a fresh snapshot straight from a running waggled. prefix="" captures
    // the whole field; at="" means now.
    async capture(waggleUrl, prefix = '', at = '') {
        const u = new URL('/v1/snapshot', waggleUrl.replace(/\/$/, ''));
        if (prefix)
            u.searchParams.set('prefix', prefix);
        if (at)
            u.searchParams.set('at', at);
        const resp = await fetch(u);
        if (!resp.ok)
            throw new Error(`E_WAGGLE_SNAPSHOT_${resp.status}`);
        return (await resp.json());
    }
    // Store a snapshot durably and anchor its content hash on-chain. The label
    // (prefix, defaulting to "field") is the encryption ref, mirroring how the
    // engine keys envelopes by agentId.
    async store(snap) {
        if (!snap || typeof snap.hash !== 'string' || !Array.isArray(snap.signals)) {
            throw new Error('E_SNAPSHOT_MALFORMED');
        }
        const ref = snap.prefix || 'field';
        const plain = JSON.stringify(snap);
        const cipher = this.seal.encrypt(plain, ref);
        const blobId = await this.walrus.put(cipher);
        const cipherHash = createHash('sha256').update(cipher).digest('hex');
        const commitment = await this.sui.commit({
            kind: 'waggle-snapshot',
            prefix: snap.prefix,
            at: snap.at,
            waggleHash: snap.hash,
            blobId,
            cipherHash,
        });
        return {
            prefix: snap.prefix,
            at: snap.at,
            waggleHash: snap.hash,
            signalCount: snap.signals.length,
            blobId,
            cipherHash,
            commitmentTx: commitment.tx,
            storedAt: new Date().toISOString(),
        };
    }
    // Fetch a stored snapshot back and prove it is byte-for-byte the one the
    // receipt was issued for: storage integrity (cipherHash over the blob) and
    // content integrity (the field hash the daemon committed). Throws on any
    // mismatch rather than returning a snapshot you cannot trust.
    async retrieve(receipt) {
        const cipher = await this.walrus.get(receipt.blobId);
        if (cipher == null)
            throw new Error('E_BLOB_MISSING');
        const cipherHash = createHash('sha256').update(cipher).digest('hex');
        if (cipherHash !== receipt.cipherHash)
            throw new Error('E_BLOB_TAMPERED');
        const snap = JSON.parse(this.seal.decrypt(cipher));
        if (snap.hash !== receipt.waggleHash)
            throw new Error('E_HASH_MISMATCH');
        return snap;
    }
    // Restore a stored snapshot into a (possibly fresh) waggled. The daemon
    // re-verifies the content hash on load and resumes decay from the preserved
    // timestamps — so the field wakes up exactly as it stood when captured.
    async restore(receipt, waggleUrl) {
        const snap = await this.retrieve(receipt);
        const u = new URL('/v1/snapshot/load', waggleUrl.replace(/\/$/, ''));
        const resp = await fetch(u, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(snap),
        });
        if (!resp.ok)
            throw new Error(`E_WAGGLE_LOAD_${resp.status}`);
        return (await resp.json());
    }
}
