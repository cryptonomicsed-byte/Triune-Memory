// Subscribes to Omo-Koda2's kernel SSE stream (GET /v1/events) and feeds
// each event into the existing Seal -> Walrus -> Sui memory pipeline
// (TriuneMemory.birth / .write), additively.
//
// This is NOT an in-process hook (birth/think/act are calls the OsO kernel
// makes to itself, in a different process and language than Triune-Memory).
// It is a second, parallel, durable/portable copy of the kernel's memory
// events, fed over the wire the kernel already emits on: AgentBorn,
// ThoughtSealed, ActExecuted. See docs/OSO_INTEGRATION_PLAN.md.
//
// What actually crosses the wire (see Omo-Koda2's shared/proto/events.proto
// and server.rs::sovereign_event_to_json) is deliberately NOT plaintext:
//   - AgentBorn carries `dna` (a fingerprint string) and `odu`. No agentId,
//     no name, and NEVER the mnemonic (server.rs explicitly strips it before
//     serializing, /v1/events is unauthenticated).
//   - ThoughtSealed carries only `intent_hash` + `hermetic_score` -- no
//     agent identifier, no thought text.
//   - ActExecuted carries only `tool` + `receipt_merkle` + `f1_score` -- no
//     agent identifier, no params.
// So this subscriber commits *hashes*, the same shape of data OsO's own
// Sui-anchoring already deals in -- it is not a plaintext memory mirror and
// cannot be, given what the kernel exposes on this endpoint today.
//
// Attribution gap (real, not papered over): ThoughtSealed/ActExecuted carry
// no agent id at all, so a multi-agent kernel deployment cannot be
// attributed per-event from this stream alone. This subscriber tracks the
// most recently seen AgentBorn's `dna` as the current agent context and
// attributes subsequent events to it, which is correct for the common
// single-owner-steward deployment this project runs today, but is a known
// limitation for concurrent multi-agent kernels. Fixing it for real needs
// Omo-Koda2 to add an agent id to ThoughtSealed/ActExecuted -- out of scope
// here.
import { TriuneMemory } from './engine.js';
import { LocalStore } from './store.js';
import { WalrusAdapter, SealAdapter, SuiCommitAdapter } from './adapters.js';
const UNKNOWN_AGENT = 'kernel-unattributed';
/** Parses one SSE frame's `data:` lines into a KernelEvent, or null for non-data frames (e.g. keep-alives). */
export function parseSseData(rawEvent) {
    const dataLines = rawEvent
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart());
    if (dataLines.length === 0)
        return null;
    const payload = dataLines.join('\n');
    try {
        return JSON.parse(payload);
    }
    catch {
        return null;
    }
}
/** Async generator that yields parsed KernelEvents from an SSE response body, splitting on blank-line frame boundaries per the SSE spec. */
export async function* iterateSseEvents(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            let sep;
            while ((sep = buf.indexOf('\n\n')) !== -1) {
                const frame = buf.slice(0, sep);
                buf = buf.slice(sep + 2);
                const parsed = parseSseData(frame);
                if (parsed)
                    yield parsed;
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
export class TriuneSseSubscriber {
    memory;
    opts;
    currentAgentId;
    currentAgentName;
    constructor(memory, opts) {
        this.memory = memory;
        this.opts = opts;
        this.currentAgentId = opts.fallbackAgentId ?? UNKNOWN_AGENT;
        this.currentAgentName = this.currentAgentId;
    }
    /** Feed one already-parsed kernel event into the memory pipeline. Exported separately from run() so tests can drive it without a live HTTP stream. */
    async handleEvent(ev) {
        switch (ev.type) {
            case 'agent_born': {
                const dna = typeof ev.dna === 'string' ? ev.dna : UNKNOWN_AGENT;
                this.currentAgentId = dna;
                this.currentAgentName = dna;
                this.memory.birth(this.currentAgentId, this.currentAgentName);
                return null;
            }
            case 'thought_sealed': {
                this.ensureBorn();
                const hash = String(ev.intent_hash ?? '');
                const rec = await this.memory.write(this.currentAgentId, 'think', `intent_hash:${hash} hermetic_score:${ev.hermetic_score ?? ''}`, 'public');
                return rec.id;
            }
            case 'act_executed': {
                this.ensureBorn();
                const tool = typeof ev.tool === 'string' ? ev.tool : 'unknown_tool';
                const merkle = String(ev.receipt_merkle ?? '');
                const rec = await this.memory.write(this.currentAgentId, 'act', `receipt_merkle:${merkle} f1_score:${ev.f1_score ?? ''}`, 'public', tool, merkle);
                return rec.id;
            }
            default:
                // connected / toc_minted / tier_advanced / audit / etc: not one of
                // the three primitives this integration targets. Ignored, not an
                // error -- the kernel's event bus carries more than birth/think/act.
                return null;
        }
    }
    /** engine.ts's birth() is idempotent (returns the existing AgentState if
     * already born), so this is safe to call unconditionally before every
     * write -- it covers the case where think/act events arrive before this
     * subscriber ever saw an agent_born (e.g. it started mid-stream). */
    ensureBorn() {
        this.memory.birth(this.currentAgentId, this.currentAgentName);
    }
    /** Connects to {kernelUrl}/v1/events and processes events until the stream ends or is aborted. */
    async run(signal) {
        const doFetch = this.opts.fetchImpl ?? fetch;
        const url = `${this.opts.kernelUrl.replace(/\/$/, '')}/v1/events`;
        const resp = await doFetch(url, {
            headers: { Accept: 'text/event-stream' },
            signal,
        });
        if (!resp.ok || !resp.body) {
            throw new Error(`triune-memory sse subscriber: GET ${url} failed: HTTP ${resp.status}`);
        }
        for await (const ev of iterateSseEvents(resp.body)) {
            const memoryEventId = await this.handleEvent(ev);
            this.opts.onEvent?.(ev, memoryEventId);
        }
    }
}
export function defaultSubscriber(kernelUrl, dataDir) {
    const memory = new TriuneMemory(new LocalStore(dataDir), new WalrusAdapter(), new SealAdapter(), new SuiCommitAdapter());
    return new TriuneSseSubscriber(memory, { kernelUrl });
}
