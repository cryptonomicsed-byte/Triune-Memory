import { createHash } from 'node:crypto';

// WaggleSnapshotAdapter — durable, tamper-evident storage for Waggle field
// snapshots.
//
// Waggle (the Agentic stigmergy substrate) can export a portable,
// content-addressed capture of a field slice: every live signal under a URI
// prefix at an instant, with original deposit timestamps preserved so decay
// resumes exactly where it was captured (GET /v1/snapshot). That JSON is
// self-verifying inside one daemon, but nothing anchors it outside: a snapshot
// on disk can be quietly edited, and "reproduce the decision the swarm made
// last Tuesday" is only as trustworthy as the file.
//
// Triune-Memory already has the durability pipeline that fixes this — Seal
// (encrypt) → Walrus (blob store) → Sui (on-chain commitment). This adapter
// runs a field snapshot through it: the snapshot's own content hash becomes an
// on-chain commitment, so a restored field is provably the one that was
// captured. That is exactly the substrate's top evidence tier — a bounded
// verdict recalled from an on-chain-anchored snapshot reads at
// `on-chain-anchored` (1.0), not `self-report` (0.2).
//
// The adapters are injected (same shape the engine uses) so this works with
// the in-memory dev adapters or the production HTTP/Sui clients unchanged.

export interface WaggleSnapshot {
  prefix: string;
  at: string;
  created_at?: string;
  hash: string; // content hash the daemon computes over the signal set
  signals: unknown[];
}

export interface SnapshotReceipt {
  prefix: string;
  at: string;
  waggleHash: string; // the field content hash, anchored on-chain
  signalCount: number;
  blobId: string; // where the encrypted snapshot lives
  cipherHash: string; // storage integrity (blob tamper-evidence)
  commitmentTx: string; // on-chain anchor of {waggleHash, blobId, cipherHash}
  storedAt: string;
}

interface Walrus {
  put(cipher: string): Promise<string>;
  get(id: string): Promise<string | null>;
}
interface Seal {
  encrypt(plain: string, ref: string): string;
  decrypt(cipher: string): string;
}
interface Sui {
  commit(payload: object): Promise<{ tx: string; hash: string }>;
}

export class WaggleSnapshotAdapter {
  constructor(private walrus: Walrus, private seal: Seal, private sui: Sui) {}

  // Pull a fresh snapshot straight from a running waggled. prefix="" captures
  // the whole field; at="" means now.
  async capture(waggleUrl: string, prefix = '', at = ''): Promise<WaggleSnapshot> {
    const u = new URL('/v1/snapshot', waggleUrl.replace(/\/$/, ''));
    if (prefix) u.searchParams.set('prefix', prefix);
    if (at) u.searchParams.set('at', at);
    const resp = await fetch(u);
    if (!resp.ok) throw new Error(`E_WAGGLE_SNAPSHOT_${resp.status}`);
    return (await resp.json()) as WaggleSnapshot;
  }

  // Store a snapshot durably and anchor its content hash on-chain. The label
  // (prefix, defaulting to "field") is the encryption ref, mirroring how the
  // engine keys envelopes by agentId.
  async store(snap: WaggleSnapshot): Promise<SnapshotReceipt> {
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
  async retrieve(receipt: SnapshotReceipt): Promise<WaggleSnapshot> {
    const cipher = await this.walrus.get(receipt.blobId);
    if (cipher == null) throw new Error('E_BLOB_MISSING');
    const cipherHash = createHash('sha256').update(cipher).digest('hex');
    if (cipherHash !== receipt.cipherHash) throw new Error('E_BLOB_TAMPERED');
    const snap = JSON.parse(this.seal.decrypt(cipher)) as WaggleSnapshot;
    if (snap.hash !== receipt.waggleHash) throw new Error('E_HASH_MISMATCH');
    return snap;
  }

  // Restore a stored snapshot into a (possibly fresh) waggled. The daemon
  // re-verifies the content hash on load and resumes decay from the preserved
  // timestamps — so the field wakes up exactly as it stood when captured.
  async restore(receipt: SnapshotReceipt, waggleUrl: string): Promise<{ loaded: number }> {
    const snap = await this.retrieve(receipt);
    const u = new URL('/v1/snapshot/load', waggleUrl.replace(/\/$/, ''));
    const resp = await fetch(u, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snap),
    });
    if (!resp.ok) throw new Error(`E_WAGGLE_LOAD_${resp.status}`);
    return (await resp.json()) as { loaded: number };
  }
}
