/**
 * rlm-osovm.ts
 * Wiring: Omokoda (parliamentary mind) → ÒSỌ́VM (execution opcodes)
 *
 * This bridge now speaks to OSOVM's real HTTP server (src/server.jl,
 * port 7778) as the primary path -- OSOVM previously had no network
 * door at all; every prior call here was a local `julia cli.jl`
 * subprocess on the same box. That subprocess call remains as a real
 * (not simulated) fallback if the HTTP server is unreachable, since
 * organism-core and OSOVM's checkout still happen to live side-by-side
 * on this VPS today -- but the HTTP path is what makes this call work
 * from anywhere else that isn't co-located with an OSOVM checkout,
 * which is the actual point of having a server at all.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const exec = promisify(execFile);

const OSOVM_HTTP_URL = process.env.OSOVM_HTTP_URL || 'http://localhost:7778';
// 10s default, not 5s: Julia JIT-compiles each HTTP handler code path on
// its first real hit (observed throughout this session -- cold-start
// costs of 1-2s+ are normal here, not a hang), so the first request
// after a server (re)start needs real margin, not an aggressive timeout
// that reads a legitimate cold JIT as "unreachable" and falls back to
// the slower CLI path unnecessarily.
const OSOVM_HTTP_TIMEOUT_MS = Number(process.env.OSOVM_HTTP_TIMEOUT_MS || 10000);

export interface DispatchMessage {
  agent_pubkey: string; // Ed25519 from Swibe birth
  think_hash: string;   // SHA-256(prompt + response) from Swibe
  opcode: string;       // OSOVM opcode (e.g., COUNCIL_APPROVE)
  payload: any;         // Data for the opcode
  vm_id?: string;        // Reuse an existing persistent VM (e.g. for a
                          // multi-step governance/economic flow) instead
                          // of creating a fresh one-shot VM per call.
}

// This shape now has a published, live-validated source of truth:
// GET /v1/openapi.json on the OSOVM server itself (ExecuteResponse /
// ErrorResponse schemas) -- OSOVM's test/openapi_schema_test.py proves
// the running server's actual responses match that published schema,
// so this interface is a manual mirror of a real contract, not the
// only place the shape is defined. If they ever drift, the openapi.json
// endpoint is the one to trust; update this interface to match it, not
// the other way around.
export interface VMResult {
  vm_task_hash: string;
  vm_result: any;
  sender_balance: number;
  status: 'success' | 'failed' | 'error' | 'simulated';
  vm_id?: string;   // present on HTTP-path results; callers can pass this
                     // back in as vm_id on a follow-up call to continue
                     // the same governance/economic flow.
  transport?: 'http' | 'cli' | 'simulated'; // which path actually served
                                              // this result, for callers
                                              // that care (logging,
                                              // metrics, "did this
                                              // actually hit the network"
                                              // sanity checks).
}

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Real HTTP path: talk to OSOVM's server (src/server.jl) over the
 * network. Creates a fresh VM per call unless msg.vm_id is supplied
 * (matching the CLI's one-shot-per-call semantics by default, while
 * allowing callers who want a persistent governance/economic flow to
 * opt into reusing a vm_id across calls).
 */
async function executeViaHttp(msg: DispatchMessage): Promise<VMResult> {
  let vmId = msg.vm_id;

  if (!vmId) {
    const createRes = await fetchWithTimeout(
      `${OSOVM_HTTP_URL}/v1/vm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
        body: JSON.stringify({ final_signer: 'genesis' }),
      },
      OSOVM_HTTP_TIMEOUT_MS,
    );
    if (!createRes.ok) {
      throw new Error(`OSOVM /v1/vm returned HTTP ${createRes.status}`);
    }
    const created = await createRes.json();
    vmId = created.vm_id;
  }

  const execRes = await fetchWithTimeout(
    `${OSOVM_HTTP_URL}/v1/vm/${vmId}/execute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
      body: JSON.stringify({ opcode: msg.opcode, args: msg.payload, agent: msg.agent_pubkey }),
    },
    OSOVM_HTTP_TIMEOUT_MS,
  );

  // A 422 is a REAL application-level rejection (e.g. double-vote,
  // insufficient collateral) -- not a transport failure. It must be
  // read as a real result, not thrown as a network error the caller
  // would mistake for "OSOVM was unreachable."
  if (!execRes.ok && execRes.status !== 422) {
    throw new Error(`OSOVM /v1/vm/${vmId}/execute returned HTTP ${execRes.status}`);
  }

  const result = await execRes.json();
  return { ...result, vm_id: vmId, transport: 'http' };
}

/**
 * Real CLI-subprocess path (the original implementation): a local
 * `julia cli.jl` invocation. Real, not simulated -- kept as a fallback
 * for when the HTTP server is down but a co-located OSOVM checkout
 * still exists, which is the case on this VPS today.
 */
async function executeViaCli(msg: DispatchMessage): Promise<VMResult> {
  const cliPath = path.resolve(__dirname, '../../OSOVM/src/cli.jl');
  const taskJson = JSON.stringify({
    opcode: msg.opcode,
    args: msg.payload,
  });

  const { stdout } = await exec('julia', [
    cliPath,
    '--task', taskJson,
    '--agent', msg.agent_pubkey,
  ]);

  const result: VMResult = JSON.parse(stdout);
  if (result.status === 'error' || result.status === 'failed') {
    throw new Error(`VM Execution Error: ${(result as any).error ?? JSON.stringify(result.vm_result)}`);
  }
  return { ...result, transport: 'cli' };
}

/**
 * Execute a task on the OSO VM. Tries the real HTTP server first (the
 * network door that didn't exist before this wiring), falls back to a
 * real local CLI subprocess call if the server is unreachable, and
 * only falls back to simulation as a last resort -- which FORCE_REAL_VM
 * disables entirely, same as before.
 */
export async function executeTask(msg: DispatchMessage): Promise<VMResult> {
  const forceReal = process.env.FORCE_REAL_VM === 'true' || process.env.REALLY_BREATHE === 'true';
  console.log(`[Organism] Executing VM Task: ${msg.opcode} for agent ${msg.agent_pubkey.slice(0, 10)}...`);

  // Retry once on a transport-level failure before falling back to the
  // (slower) CLI path. Empirically, the very first HTTP request a NEW
  // client process makes right after the OSOVM server has (re)started
  // can spuriously abort (observed repeatedly: AbortError on request 1,
  // clean success on request 2, even against a server that was already
  // answering /v1/health instantly) -- this reads like a first-connection
  // quirk in this environment's Node/undici <-> Julia HTTP.jl interaction,
  // not a real timeout or a real server-unreachable condition. A bounded
  // single retry costs nothing when the server IS actually down (CLI
  // fallback still triggers after 2 failures, not never), and avoids
  // needlessly paying the CLI path's slower per-call Julia cold-start
  // cost for what is, empirically, a transient first-hit blip.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await executeViaHttp(msg);
      console.log(`[Organism] VM Success (HTTP, vm_id=${result.vm_id?.slice(0, 8)}): Task Hash ${result.vm_task_hash.slice(0, 12)}, Sender Balance: ${result.sender_balance}`);
      return result;
    } catch (httpErr) {
      if (attempt === 1) {
        console.warn(`[Organism] ⚠️ OSOVM HTTP attempt 1 failed (${httpErr}), retrying once before falling back to CLI.`);
      } else {
        console.warn(`[Organism] ⚠️ OSOVM HTTP server unreachable after retry (${httpErr}), falling back to local CLI subprocess.`);
      }
    }
  }

  try {
    const result = await executeViaCli(msg);
    console.log(`[Organism] VM Success (CLI fallback): Task Hash ${result.vm_task_hash.slice(0, 12)}, Sender Balance: ${result.sender_balance}`);
    return result;
  } catch (cliErr) {
    if (forceReal) {
      console.error(`[Organism] ❌ FATAL: both HTTP and CLI VM execution failed and FORCE_REAL_VM=true.`);
      throw new Error(`Real VM execution failed (HTTP and CLI both exhausted): ${cliErr}`);
    }

    // FALLBACK
    console.warn(`[Organism] ⚠️ Julia VM execution failed (System Error). Falling back to Simulation Mode.`);

    const taskJson = JSON.stringify({ opcode: msg.opcode, args: msg.payload });
    const simulatedResult: VMResult = {
      vm_task_hash: "sim-hash-" + Buffer.from(taskJson).toString('hex').slice(0, 16),
      vm_result: { status: "simulated_success", opcode: msg.opcode },
      sender_balance: 0,
      status: 'simulated',
      transport: 'simulated',
    };

    console.log(`[Organism] SIMULATION Success: Task Hash ${simulatedResult.vm_task_hash.slice(0, 12)}`);
    return simulatedResult;
  }
}

export async function dispatchToVM(msg: any) {
  return executeTask({
    agent_pubkey: msg.agent_pubkey || 'genesis',
    think_hash: msg.think_hash || '0x0',
    opcode: msg.opcode,
    payload: msg.payload,
    vm_id: msg.vm_id,
  });
}
