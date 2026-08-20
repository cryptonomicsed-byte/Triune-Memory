"use strict";
/**
 * bridge/nostr-wire.ts — the ecosystem's shared Nostr wire contract, in TypeScript.
 *
 * organism-core owns the relationships between organs rather than any organ's
 * business logic, and this is a relationship: what every component must agree
 * on for its events to be readable by the others.
 *
 * Rust (IfáScript, Zàngbétò), Julia (Ọ̀ṢỌ́VM) and Python (minipae) each have an
 * implementation of this contract. TypeScript had none, so Triune-Memory,
 * Mycelium's TS surface and any future TS organ had nothing to conform to.
 * This is that implementation, parameterised by namespace so each consumer
 * supplies its own `mem/<name>/` prefix rather than forking the module.
 *
 * ## What this deliberately does NOT do: sign
 *
 * No key material appears here. The ecosystem rule is derive once, adopt
 * everywhere: ỌMỌ KỌ́DÀ births an agent and owns its secp256k1 identity, and a
 * bridge layer that minted its own key would create a second identity for the
 * same agent — indistinguishable on the wire from a second agent.
 *
 * So this builds canonical **unsigned** events with correct NIP-01 ids, and a
 * component holding the key signs the id. Same split as Kóòdù and Ọ̀ṢỌ́VM. It
 * also keeps this module dependency-free: `node:crypto` covers SHA-256 and
 * nothing here needs secp256k1.
 *
 * ## Two traps this module exists to get right
 *
 * **1. Serialization.** A NIP-01 id is `sha256` over canonical JSON and the
 * signature is over that id, so implementations that serialize differently
 * reject each other's signatures with no error naming the cause. NIP-01 wants
 * raw UTF-8. `JSON.stringify` does that correctly; Python's `json.dumps`
 * escapes non-ASCII by default and does not. Measured, for `"Òrìṣà Ògún"`:
 *
 *     ensure_ascii=True   -> f5ceda251451b3571736436644e34ca50eca23ad68ea3e067934e5f8668c2337
 *     raw UTF-8 (correct) -> e24b148552d35adf425c92e2e701ee3be6b4c86dbfd5fa2cc84a4c922250ac3b
 *
 * **2. Slug grammar.** `minipae.py::validate_slug` accepts only `[a-z0-9_-]`
 * per path segment. This ecosystem's vocabulary is Yorùbá, so an unnormalised
 * name produces a slug minipae refuses and an engram no minipae client can
 * address. Both are pinned by tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRUCIBLE_RESERVED = exports.KIND_REACTION = exports.KIND_AUTH = exports.KIND_ATTESTATION = exports.KIND_CLAIM = exports.KIND_AGENT_ENGRAM = void 0;
exports.isPublishable = isPublishable;
exports.isCrucible = isCrucible;
exports.canonicalSerialize = canonicalSerialize;
exports.eventId = eventId;
exports.validateSlug = validateSlug;
exports.normalizeSlugSegment = normalizeSlugSegment;
exports.buildSlug = buildSlug;
exports.buildUnsignedEvent = buildUnsignedEvent;
exports.buildEngram = buildEngram;
exports.buildClaim = buildClaim;
const node_crypto_1 = require("node:crypto");
/**
 * Byte length of a UTF-8 string.
 *
 * `TextEncoder` rather than `Buffer` so this module carries no Node-specific
 * surface beyond the hash: minipae's limits are in *bytes*, and a Yorùbá slug
 * segment is longer in bytes than in characters, so `.length` would understate
 * it and let an over-long slug through.
 */
function utf8Length(s) {
    return new TextEncoder().encode(s).length;
}
// === The shared wire contract ===
// Each constant is owned by another component and mirrored here, never
// invented. Changing one in isolation breaks interoperability silently.
/** NIP-AE agent engram. Owner: `minipae.py::KIND_AGENT_ENGRAM`. */
exports.KIND_AGENT_ENGRAM = 30174;
/** Crucible falsifiable claim. Owner: `crucible-core::kinds::CLAIM`. */
exports.KIND_CLAIM = 47001;
/** Crucible attestation. Owner: `crucible-core::kinds::ATTESTATION`. */
exports.KIND_ATTESTATION = 47002;
/** NIP-42 relay auth. Owner: `minipae.py::KIND_AUTH`. */
exports.KIND_AUTH = 22242;
/** NIP-25 reaction — witness voting. */
exports.KIND_REACTION = 7;
/** Crucible's reserved block. No other component may mint a kind inside it. */
exports.CRUCIBLE_RESERVED = [47000, 48000];
/** Kinds any organ using this module may publish under. */
const PUBLISHABLE = new Set([exports.KIND_AGENT_ENGRAM, exports.KIND_CLAIM, exports.KIND_AUTH]);
/**
 * True when `kind` is one this module builds events for.
 *
 * Deliberately NOT a mirror of the relay's allowlist. The Buzz relay's
 * `required_scope_for_kind` is a large match arm covering most of Buzz's own
 * vocabulary (kind 1, 7, 30023, 30315 and many more); a copy here would drift
 * out of sync silently while asserting an authority this module cannot verify.
 *
 * A `false` therefore means "not ours", never "the relay would refuse it".
 */
function isPublishable(kind) {
    return PUBLISHABLE.has(kind);
}
/** True when `kind` falls inside Crucible's reserved block. */
function isCrucible(kind) {
    return kind >= exports.CRUCIBLE_RESERVED[0] && kind < exports.CRUCIBLE_RESERVED[1];
}
/**
 * Serialize into the exact byte string NIP-01 hashes.
 *
 * `JSON.stringify` is correct here precisely because it emits raw UTF-8 rather
 * than `\uXXXX` escapes. Do not "fix" this by adding escaping — that produces
 * the Python-default form, which every other implementation disagrees with.
 */
function canonicalSerialize(e) {
    return JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
}
/** NIP-01 event id: sha256 of the canonical serialization, lowercase hex. */
function eventId(e) {
    return (0, node_crypto_1.createHash)('sha256').update(canonicalSerialize(e), 'utf8').digest('hex');
}
// === Slug addressing ===
/**
 * minipae's slug grammar, which every engram address must satisfy.
 *
 * Verified against `minipae.py::validate_slug`: each `/`-separated segment
 * after `mem/` must be non-empty, at most 64 bytes, begin with a lowercase
 * letter, digit or `_`, and contain only lowercase letters, digits, `_` and
 * `-`. The whole slug must be at most 255 bytes.
 */
function validateSlug(slug) {
    if (utf8Length(slug) > 255)
        return false;
    if (!slug.startsWith('mem/'))
        return false;
    const rest = slug.slice(4);
    if (!rest)
        return false;
    return rest
        .split('/')
        .every((part) => part.length > 0 &&
        utf8Length(part) <= 64 &&
        /^[a-z0-9_]/.test(part) &&
        /^[a-z0-9_-]+$/.test(part));
}
/**
 * Fold one path segment into minipae's grammar.
 *
 * Decomposes to NFD, drops combining marks (`ọ́` → `o`), lowercases, and maps
 * anything still outside the grammar to a single `-`.
 *
 * Normalising loses nothing that matters: a slug is HMAC'd into the `d` tag
 * before it reaches the wire, so it is an addressing key and never display
 * text. The Yorùbá name travels intact in the event content, which is where a
 * reader actually gets it.
 *
 * @throws when nothing survives, so a caller fails here rather than building
 *   an address that only breaks in another language, in another process.
 */
function normalizeSlugSegment(segment) {
    const folded = String(segment)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
    if (!folded) {
        throw new Error(`slug segment ${JSON.stringify(segment)} normalises to nothing; ` +
            'it cannot be used as an engram address');
    }
    return folded;
}
/**
 * Build a validated engram slug under `mem/<namespace>/`.
 *
 * Each organ owns its namespace so a merged read view stays separable by
 * origin. Register it in minipae's `NAMESPACES.md` before the first write —
 * that file is the source of truth and its own rules require it.
 */
function buildSlug(namespace, ...segments) {
    const parts = [normalizeSlugSegment(namespace), ...segments.map(normalizeSlugSegment)];
    const slug = `mem/${parts.join('/')}`;
    if (!validateSlug(slug)) {
        throw new Error(`built an invalid engram slug: ${slug}`);
    }
    return slug;
}
// === Event construction ===
/**
 * Build a canonical unsigned event with its id filled in.
 *
 * Complete except for `sig`. A signer that owns the agent's key signs `id` and
 * attaches the signature; it must not recompute or alter any other field, or
 * the id stops matching what was signed.
 */
function buildUnsignedEvent(opts) {
    const { pubkey, kind, content, tags = [], createdAt } = opts;
    if (!isPublishable(kind)) {
        throw new Error(`kind ${kind} is not one this module publishes under`);
    }
    if (!/^[0-9a-f]{64}$/.test(pubkey)) {
        throw new Error('pubkey must be 64 hex characters (x-only secp256k1)');
    }
    const fields = {
        pubkey,
        created_at: createdAt ?? Math.floor(Date.now() / 1000),
        kind,
        tags,
        content,
    };
    return { ...fields, id: eventId(fields) };
}
/**
 * Build an unsigned NIP-AE engram (`kind:30174`).
 *
 * ## `ciphertext`, not content — and this module cannot produce it
 *
 * NIP-AE engram content is **NIP-44 encrypted under the agent↔owner
 * conversation key**. That key is `HKDF-extract("nip44-v2", ECDH(secret,
 * owner))`, so producing it requires the agent's secret — which this module
 * deliberately does not hold.
 *
 * The parameter is therefore named `ciphertext`: the caller encrypts, or the
 * signing component encrypts as it signs. Passing a plaintext JSON body here
 * and signing it publishes the whole memory in the clear to every relay
 * operator. That failure is silent — the event is well-formed, correctly
 * signed, and accepted — which is exactly why the parameter name says what it
 * wants rather than leaving it to a doc comment nobody re-reads.
 *
 * `dTag` is the HMAC'd slug, keyed by that same conversation key, so it is
 * equally unavailable here and equally the caller's job. Passing a raw slug
 * would publish it in the clear and defeat the reason minipae hashes it, so a
 * missing `dTag` fails loudly.
 */
function buildEngram(opts) {
    const { pubkey, ownerPubkey, dTag, ciphertext: content, extraTags = [], createdAt } = opts;
    if (!dTag) {
        throw new Error('dTag is required: the slug must be HMACd by the key owner, never published raw');
    }
    return buildUnsignedEvent({
        pubkey,
        kind: exports.KIND_AGENT_ENGRAM,
        content,
        tags: [['d', dTag], ['p', ownerPubkey], ...extraTags],
        createdAt,
    });
}
/**
 * Build an unsigned Crucible claim (`kind:47001`).
 *
 * Crucible's one rule: an assertion must say how it could be proven wrong. A
 * claim without a falsifier is rejected at parse time, so this throws rather
 * than emitting one that will bounce at the relay.
 */
function buildClaim(opts) {
    const { pubkey, statement, falsifier, halfLifeSecs = 86400, extraTags = [], createdAt, } = opts;
    if (!falsifier) {
        throw new Error('a Crucible claim requires a falsifier; Crucible rejects claims without one');
    }
    return buildUnsignedEvent({
        pubkey,
        kind: exports.KIND_CLAIM,
        content: JSON.stringify({ statement, falsifier, half_life_secs: halfLifeSecs }),
        tags: [
            ['falsifier', falsifier],
            ['half_life', String(halfLifeSecs)],
            ...extraTags,
        ],
        createdAt,
    });
}
