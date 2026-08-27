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
    TRIUNE_NSEC   agent secret key (hex or nsec1...)
    TRIUNE_OWNER  owner pubkey (hex or npub1...), optional — defaults to the
                  agent's own pubkey (self-owned).

Both commands print a single JSON object on stdout. Errors print JSON on
stderr and exit non-zero.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid

import minipae

NAMESPACE = "triune"
DEFAULT_RELAY = "wss://relay.damus.io"


def _load_seckey() -> bytes:
    nsec = os.environ.get("TRIUNE_NSEC", "").strip()
    if not nsec:
        raise RuntimeError("TRIUNE_NSEC not set (agent secret key, hex or nsec1...)")
    if nsec.startswith("nsec1"):
        return minipae.nsec_decode(nsec)
    return bytes.fromhex(nsec)


def _owner_pubkey(seckey: bytes) -> bytes:
    raw = os.environ.get("TRIUNE_OWNER", "").strip()
    if not raw:
        # Self-owned: owner is the agent's own pubkey.
        return minipae.pubkey_from_secret(int.from_bytes(seckey, "big"))
    if raw.startswith("npub1"):
        return minipae.npub_decode(raw)
    return bytes.fromhex(raw)


def _agent_pubkey(seckey: bytes) -> bytes:
    return minipae.pubkey_from_secret(int.from_bytes(seckey, "big"))


def _slug(agent_id: str, event_id: str) -> str:
    return f"mem/{NAMESPACE}/memory/{agent_id}/{event_id}"


def _conversation_key(seckey: bytes) -> bytes:
    return minipae.conversation_key(seckey, _owner_pubkey(seckey))


def build_memory_engram(
    agent_id: str,
    primitive: str,
    text: str,
    visibility: str = "private",
    tool: str | None = None,
    params: str | None = None,
) -> tuple[dict, dict]:
    """Return (signed_nipae_event, plaintext_body)."""
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
    event = minipae.build_event(_slug(agent_id, event_id), body, seckey, owner)
    return event, body


async def write_memory(args: dict) -> dict:
    event, body = build_memory_engram(
        args["agent_id"],
        args["primitive"],
        args["text"],
        args.get("visibility", "private"),
        args.get("tool"),
        args.get("params"),
    )
    relay = args.get("relay") or DEFAULT_RELAY
    ok = await minipae.publish(relay, event)
    return {
        "id": body["event_id"],        # app-level event id (slug segment)
        "nostr_id": event["id"],       # relay event id (SHA-256)
        "kind": event["kind"],
        "relay": relay,
        "accepted": bool(ok.get("ok")),
        "message": ok.get("message", ""),
    }


async def recall_memory(args: dict) -> list[dict]:
    seckey = _load_seckey()
    pubkey = _agent_pubkey(seckey).hex()
    relay = args.get("relay") or DEFAULT_RELAY
    agent_id = args.get("agent_id")

    events = await minipae.query(relay, [pubkey])
    kc = _conversation_key(seckey)

    records: list[dict] = []
    for ev in events:
        try:
            body = json.loads(minipae.nip44_decrypt(ev["content"], kc))
        except Exception:
            # An engram we cannot decrypt is not ours (or is malformed) — skip,
            # do not fail the whole recall.
            continue
        if agent_id is None or body.get("agent_id") == agent_id:
            body["id"] = body.get("event_id")
            body["nostr_id"] = ev["id"]
            records.append(body)
    return records


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
