#!/usr/bin/env python3
"""
triune_bridge.py — REAL NIP-AE persistence for Triune-Memory.

Replaces the fake storage layer (in-memory WalrusAdapter, base64 SealAdapter,
fabricated SuiCommitAdapter). All signing (BIP-340 Schnorr), encryption
(NIP-44 v2), and persistence (Nostr relay, kind:30174) are delegated to
minipae — the canonical, live-verified memory wire.

Contract:
    python3 triune_bridge.py write  '{"agent_id": ..., "primitive": "think|act",
                                      "text": ..., "visibility": "private",
                                      "tool": ..., "params": ..., "relay": ...}'
    python3 triune_bridge.py recall '{"agent_id": ..., "relay": ...}'

Env (identity is passed via env, never argv, so it doesn't leak into the
process list):
    TRIUNE_NSEC    agent secret key (hex or nsec1...)
    TRIUNE_OWNER   owner pubkey (hex or npub1...), optional — defaults to the
                   agent's own pubkey (self-owned).
    MINIPAE_URL    base URL of a running minipae HTTP service
                   (default: http://localhost:30174).
                   Used as a fallback when minipae is not importable directly
                   (production deployments where minipae lives in a separate
                   service rather than on the Python path).

Both commands print a single JSON object on stdout. Errors print JSON on
stderr and exit non-zero.

Fallback mode (MINIPAE_URL):
    When `import minipae` fails this bridge switches to HTTP calls against a
    local minipae service.  The service must expose:
        POST /write   body: same JSON dict as the direct write_memory args
        POST /recall  body: {"agent_id": ..., "relay": ...}
    Both endpoints return the same JSON shape as the direct-import path.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

# ---------------------------------------------------------------------------
# minipae import — direct or HTTP fallback
# ---------------------------------------------------------------------------
MINIPAE_URL: str = os.environ.get("MINIPAE_URL", "http://localhost:30174").rstrip("/")

try:
    import minipae as _minipae  # type: ignore[import]
    _MINIPAE_DIRECT = True
except ImportError:  # pragma: no cover — minipae not on PYTHONPATH
    _minipae = None  # type: ignore[assignment]
    _MINIPAE_DIRECT = False

NAMESPACE = "triune"
DEFAULT_RELAY = "wss://relay.damus.io"


# ---------------------------------------------------------------------------
# HTTP fallback helpers (used when minipae is not importable directly)
# ---------------------------------------------------------------------------

def _http_post(path: str, payload: dict) -> dict:
    """POST *payload* to MINIPAE_URL/*path*, return parsed JSON response."""
    url = f"{MINIPAE_URL}/{path.lstrip('/')}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise RuntimeError(
            f"minipae HTTP service error {exc.code} at {url}: {body}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Cannot reach minipae HTTP service at {MINIPAE_URL} — "
            f"start it or set MINIPAE_URL correctly. Reason: {exc.reason}"
        ) from exc


# ---------------------------------------------------------------------------
# Direct-import helpers (used when minipae IS on PYTHONPATH)
# ---------------------------------------------------------------------------

def _load_seckey() -> bytes:
    if not _MINIPAE_DIRECT:
        raise RuntimeError(
            "minipae not importable; _load_seckey() is only used in direct mode"
        )
    nsec = os.environ.get("TRIUNE_NSEC", "").strip()
    if not nsec:
        raise RuntimeError("TRIUNE_NSEC not set (agent secret key, hex or nsec1...)")
    if nsec.startswith("nsec1"):
        return _minipae.nsec_decode(nsec)
    return bytes.fromhex(nsec)


def _owner_pubkey(seckey: bytes) -> bytes:
    raw = os.environ.get("TRIUNE_OWNER", "").strip()
    if not raw:
        return _minipae.pubkey_from_secret(int.from_bytes(seckey, "big"))
    if raw.startswith("npub1"):
        return _minipae.npub_decode(raw)
    return bytes.fromhex(raw)


def _agent_pubkey(seckey: bytes) -> bytes:
    return _minipae.pubkey_from_secret(int.from_bytes(seckey, "big"))


def _slug(agent_id: str, event_id: str) -> str:
    return f"mem/{NAMESPACE}/memory/{agent_id}/{event_id}"


def _conversation_key(seckey: bytes) -> bytes:
    return _minipae.conversation_key(seckey, _owner_pubkey(seckey))


def build_memory_engram(
    agent_id: str,
    primitive: str,
    text: str,
    visibility: str = "private",
    tool: str | None = None,
    params: str | None = None,
) -> tuple[dict, dict]:
    """Return (signed_nipae_event, plaintext_body). Direct mode only."""
    if visibility != "private":
        # NIP-AE engram content is ciphertext by definition. Public memory
        # must travel under a public vocabulary, never smuggled through NIP-AE.
        raise ValueError("only private memory belongs in a NIP-AE engram")

    seckey = _load_seckey()
    owner = _owner_pubkey(seckey)
    event_id = uuid.uuid4().hex
    body = {
        "event_id": event_id,
        "agent_id": agent_id,
        "primitive": primitive,
        "text": text,
        "tool": tool,
        "params": params,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    event = _minipae.build_event(_slug(agent_id, event_id), body, seckey, owner)
    return event, body


# ---------------------------------------------------------------------------
# write / recall — dispatch to direct or HTTP path automatically
# ---------------------------------------------------------------------------

async def write_memory(args: dict) -> dict:
    relay = args.get("relay") or DEFAULT_RELAY

    if not _MINIPAE_DIRECT:
        # HTTP fallback: forward entire args dict to the minipae service.
        return _http_post("write", {**args, "relay": relay})

    event, body = build_memory_engram(
        args["agent_id"],
        args["primitive"],
        args["text"],
        args.get("visibility", "private"),
        args.get("tool"),
        args.get("params"),
    )
    ok = await _minipae.publish(relay, event)
    return {
        "id": body["event_id"],        # app-level event id (slug segment)
        "nostr_id": event["id"],       # relay event id (SHA-256)
        "kind": event["kind"],
        "relay": relay,
        "accepted": bool(ok.get("ok")),
        "message": ok.get("message", ""),
    }


async def recall_memory(args: dict) -> list[dict]:
    relay = args.get("relay") or DEFAULT_RELAY
    agent_id = args.get("agent_id")

    if not _MINIPAE_DIRECT:
        # HTTP fallback: forward to the minipae service.
        return _http_post("recall", {"agent_id": agent_id, "relay": relay})  # type: ignore[return-value]

    seckey = _load_seckey()
    pubkey = _agent_pubkey(seckey).hex()

    events = await _minipae.query(relay, [pubkey])
    kc = _conversation_key(seckey)

    records: list[dict] = []
    for ev in events:
        try:
            body = json.loads(_minipae.nip44_decrypt(ev["content"], kc))
        except Exception:
            # An engram we cannot decrypt is not ours (or is malformed) — skip,
            # do not fail the whole recall.
            continue
        if agent_id is None or body.get("agent_id") == agent_id:
            body["id"] = body.get("event_id")
            body["nostr_id"] = ev["id"]
            records.append(body)
    return records


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _fail(msg: str) -> None:
    print(json.dumps({"error": msg}), file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if len(sys.argv) < 3:
        _fail(f"usage: {sys.argv[0]} <write|recall> <json-args>")

    command = sys.argv[1]
    try:
        args = json.loads(sys.argv[2])
    except json.JSONDecodeError as e:
        _fail(f"invalid JSON args: {e}")

    if not _MINIPAE_DIRECT:
        print(
            f"INFO: minipae not importable — using HTTP fallback at {MINIPAE_URL} "
            "(set MINIPAE_URL env var if the service is on a different host/port)",
            file=sys.stderr,
        )

    try:
        if command == "write":
            result = asyncio.run(write_memory(args))
        elif command == "recall":
            result = asyncio.run(recall_memory(args))
        else:
            _fail(f"unknown command: {command}")
    except Exception as e:  # noqa: BLE001 — surfaced as JSON, not a traceback
        _fail(f"{type(e).__name__}: {e}")

    print(json.dumps(result))


if __name__ == "__main__":
    main()
