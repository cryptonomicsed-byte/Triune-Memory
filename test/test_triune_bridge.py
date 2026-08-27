#!/usr/bin/env python3
"""
Real end-to-end test for the Triune bridge.

Proves the storage layer is now REAL: write a memory through triune_bridge
(real BIP-340 signing + NIP-44 v2 encryption via minipae), publish to a real
relay, recall it, decrypt, and assert the round-trip.

Run:
    MINIPAE_PATH=/path/to/minipae python3 test/test_triune_bridge.py

Env:
    MINIPAE_PATH   dir containing minipae.py (default: sibling ../../minipae)
    TRIUNE_RELAY   relay URL (default wss://relay.damus.io)
"""
import asyncio
import json
import os
import secrets
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
MINIPAE = os.environ.get("MINIPAE_PATH", os.path.join(REPO, "..", "minipae"))
sys.path.insert(0, MINIPAE)
sys.path.insert(0, REPO)

import minipae  # noqa: E402
import triune_bridge  # noqa: E402


async def main() -> int:
    # Throwaway identity for the test — never a real agent key.
    seckey = secrets.token_bytes(32)
    os.environ["TRIUNE_NSEC"] = minipae.nsec_encode(seckey)
    relay = os.environ.get("TRIUNE_RELAY", "wss://relay.damus.io")
    agent = "test-agent-" + secrets.token_hex(4)

    # 1. Offline crypto check: the engram must be REAL, not base64/fake.
    event, body = triune_bridge.build_memory_engram(
        agent, "think", "the relay is real", "private"
    )
    pubkey = minipae.pubkey_from_secret(int.from_bytes(seckey, "big"))
    assert minipae.schnorr_verify(
        bytes.fromhex(event["id"]), pubkey, bytes.fromhex(event["sig"])
    ), "engram signature does not verify (not real BIP-340)"
    kc = minipae.conversation_key(seckey, pubkey)
    decrypted = json.loads(minipae.nip44_decrypt(event["content"], kc))
    assert decrypted["text"] == "the relay is real", "engram did not decrypt to the plaintext"
    assert event["content"] != "the relay is real", "content must be ciphertext, not plaintext"
    print("[1] crypto check PASS — real BIP-340 signature + NIP-44 v2 ciphertext")

    # 2. Live write → recall round-trip against a real relay.
    w = await triune_bridge.write_memory(
        {"agent_id": agent, "primitive": "think", "text": "the relay is real",
         "visibility": "private", "relay": relay}
    )
    print(f"[2] write: relay={relay} accepted={w['accepted']} id={w['id']}")
    assert w["accepted"], f"relay rejected the engram: {w}"

    await asyncio.sleep(1.5)  # let the relay index
    records = await triune_bridge.recall_memory({"agent_id": agent, "relay": relay})
    print(f"[3] recall: got {len(records)} record(s)")
    texts = [r["text"] for r in records]
    assert "the relay is real" in texts, "recall did not return the written memory"

    print("\n✅ PASS — real write→recall round-trip through minipae (no fake storage)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except Exception as e:  # noqa: BLE001
        print(f"❌ FAIL: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
