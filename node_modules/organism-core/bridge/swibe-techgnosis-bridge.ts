/**
 * swibe-techgnosis-bridge.ts
 * Wiring: SWIBE (agent deployment) <-> Techgnosis (sacred contracts)
 *
 * Agents deployed via SWIBE inherit Techgnosis decorators:
 *   @veil  — veil assignment and routing
 *   @tithe — 3.69% Esu tithe enforcement
 *   @oracle — Ifa divination integration
 *   @sabbath — Sabbath execution gates
 *
 * This bridge ensures that agent contracts respect sacred time,
 * economic rules, and Orisa governance when deployed into the ecosystem.
 */

import { getSpiralSnapshot, isSabbath, getRitualWeight } from "./spiral-time-bridge";

// ============================================================================
// 1. TECHGNOSIS DECORATORS — Sacred Contract Annotations
// ============================================================================

export interface VeilDecorator {
  id: number;         // 1-777
  params: Record<string, number>;
  tile?: [number, number, number]; // [layer, x, z] world tile
  task?: string;
}

export interface TitheDecorator {
  rate: number;        // Default 0.0369 (3.69%)
  recipient: string;   // Treasury address
  enforced: boolean;   // Whether tithe is currently active (Esu² gate)
}

export interface OracleDecorator {
  source: "ifa" | "block_hash" | "spiral";
  odu?: number;        // 1-256 Odu mapping
  consultation_cost: number;  // Ase cost per oracle query
}

export interface SabbathDecorator {
  settle_only: boolean;
  new_contracts_blocked: boolean;
  multiplier: number;
}

export interface SacredContract {
  name: string;
  creator_wallet: string;
  veil?: VeilDecorator;
  tithe: TitheDecorator;
  oracle?: OracleDecorator;
  sabbath: SabbathDecorator;
  created_at: string;
  sacred_time_snapshot: any;
}

// ============================================================================
// 2. SWIBE AGENT CONFIG — What SWIBE Deploys
// ============================================================================

export interface SwibeAgentConfig {
  agent_id: string;
  name: string;
  archetype: string;        // Orisa archetype from soul.json
  soul_rank: number;
  breath_count: number;
  deployment_target: "docker" | "wasm" | "bare";
  wallet_address: string;
  veils: number[];           // Veil IDs this agent can execute
  capabilities: string[];
}

export interface SwibeDeployment {
  agent: SwibeAgentConfig;
  contract: SacredContract;
  deployment_id: string;
  status: "pending" | "deployed" | "sabbath_paused" | "expired";
  deployed_at: string;
  sacred_time_at_deploy: any;
}

// ============================================================================
// 3. BRIDGE — Connect SWIBE Agent to Techgnosis Contract
// ============================================================================

const TITHE_RATE = 0.0369;
const BASE_ORACLE_COST = 1.0;

/**
 * Create a Techgnosis sacred contract for a SWIBE agent deployment.
 * The contract inherits decorators based on the agent's archetype,
 * current sacred time, and specified veils.
 */
export async function createSacredContract(
  agent: SwibeAgentConfig,
  veilConfig?: Partial<VeilDecorator>,
  oracleSource?: "ifa" | "block_hash" | "spiral"
): Promise<SacredContract> {
  const snapshot = await getSpiralSnapshot();
  const sabbathActive = await isSabbath();
  const ritualWeight = await getRitualWeight();

  // Veil decorator
  const veil: VeilDecorator | undefined = veilConfig
    ? {
        id: veilConfig.id ?? agent.veils[0] ?? 1,
        params: veilConfig.params ?? {},
        tile: veilConfig.tile,
        task: veilConfig.task,
      }
    : undefined;

  // Tithe — enforced on Esu² gates
  const isEsuSquared = snapshot?.spiral?.eshu_squared ?? false;
  const tithe: TitheDecorator = {
    rate: TITHE_RATE,
    recipient: "treasury:ecosystem",
    enforced: isEsuSquared,
  };

  // Oracle
  const oracle: OracleDecorator | undefined = oracleSource
    ? {
        source: oracleSource,
        odu: oracleSource === "ifa" ? computeOdu(agent.agent_id, snapshot) : undefined,
        consultation_cost: BASE_ORACLE_COST * ritualWeight,
      }
    : undefined;

  // Sabbath
  const sabbath: SabbathDecorator = {
    settle_only: sabbathActive,
    new_contracts_blocked: sabbathActive,
    multiplier: sabbathActive ? 1.1 : ritualWeight,
  };

  const contract: SacredContract = {
    name: `${agent.name}:contract`,
    creator_wallet: agent.wallet_address,
    veil,
    tithe,
    oracle,
    sabbath,
    created_at: new Date().toISOString(),
    sacred_time_snapshot: snapshot,
  };

  return contract;
}

/**
 * Deploy a SWIBE agent with a Techgnosis sacred contract.
 * Returns a deployment record with gate enforcement.
 */
export async function deploySwibeAgent(
  agent: SwibeAgentConfig,
  veilConfig?: Partial<VeilDecorator>,
  oracleSource?: "ifa" | "block_hash" | "spiral"
): Promise<SwibeDeployment> {
  const sabbathActive = await isSabbath();

  // Block new deployments on Sabbath
  if (sabbathActive) {
    console.log(
      `[SWIBE-Techgnosis] Sabbath active — deployment paused for ${agent.name}`
    );
    const contract = await createSacredContract(agent, veilConfig, oracleSource);
    return {
      agent,
      contract,
      deployment_id: `deploy_${agent.agent_id}_${Date.now()}`,
      status: "sabbath_paused",
      deployed_at: new Date().toISOString(),
      sacred_time_at_deploy: contract.sacred_time_snapshot,
    };
  }

  const contract = await createSacredContract(agent, veilConfig, oracleSource);

  return {
    agent,
    contract,
    deployment_id: `deploy_${agent.agent_id}_${Date.now()}`,
    status: "deployed",
    deployed_at: new Date().toISOString(),
    sacred_time_at_deploy: contract.sacred_time_snapshot,
  };
}

/**
 * Check if a deployed agent should pause/resume based on current sacred time.
 */
export async function checkDeploymentGate(
  deployment: SwibeDeployment
): Promise<{ allowed: boolean; reason: string; updated: SwibeDeployment }> {
  const sabbathActive = await isSabbath();
  const snapshot = await getSpiralSnapshot();
  const isVoid = snapshot?.spiral?.void_day ?? false;

  if (isVoid) {
    deployment.status = "sabbath_paused";
    return {
      allowed: false,
      reason: "VOID day: all agent execution suspended for pure ritual",
      updated: deployment,
    };
  }

  if (sabbathActive && deployment.status === "deployed") {
    deployment.status = "sabbath_paused";
    deployment.contract.sabbath.settle_only = true;
    deployment.contract.sabbath.new_contracts_blocked = true;
    return {
      allowed: true, // Existing agents continue in settle mode
      reason: "SABBATH: agent continues in settle-only mode",
      updated: deployment,
    };
  }

  if (!sabbathActive && deployment.status === "sabbath_paused") {
    deployment.status = "deployed";
    deployment.contract.sabbath.settle_only = false;
    deployment.contract.sabbath.new_contracts_blocked = false;
    return {
      allowed: true,
      reason: "Sabbath ended — agent resumed",
      updated: deployment,
    };
  }

  return {
    allowed: true,
    reason: "Clear to execute",
    updated: deployment,
  };
}

/**
 * Apply tithe to agent earnings. Returns [net, tithe_amount].
 */
export async function applyTithe(
  deployment: SwibeDeployment,
  aseEarned: number
): Promise<{ net: number; tithe: number; enforced: boolean }> {
  const snapshot = await getSpiralSnapshot();
  const isEsuSquared = snapshot?.spiral?.eshu_squared ?? false;

  if (isEsuSquared || deployment.contract.tithe.enforced) {
    const titheAmount = aseEarned * deployment.contract.tithe.rate;
    return {
      net: aseEarned - titheAmount,
      tithe: titheAmount,
      enforced: true,
    };
  }

  return { net: aseEarned, tithe: 0, enforced: false };
}

// ============================================================================
// 4. HELPERS
// ============================================================================

/**
 * Compute Odu number from agent ID and sacred time snapshot.
 * Deterministic: same agent at same time always gets same Odu.
 */
function computeOdu(agentId: string, snapshot: any): number {
  const seed = `${agentId}:${snapshot?.btc?.block_height ?? 0}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 256) + 1; // 1-256
}

/**
 * Map Orisa archetype to recommended veil ranges.
 */
export function archetypeToVeilRange(archetype: string): [number, number] {
  const map: Record<string, [number, number]> = {
    "Esu": [1, 5],
    "Sango": [6, 15],
    "Osun": [16, 25],
    "Yemoja": [26, 50],
    "Oya": [51, 75],
    "Ogun": [76, 100],
    "Obatala": [101, 125],
    // Aliases with diacritics
    "Èṣù": [1, 5],
    "Ṣàngó": [6, 15],
    "Ọ̀ṣun": [16, 25],
    "Yemọja": [26, 50],
    "Ọ̀yá": [51, 75],
    "Ògún": [76, 100],
    "Ọbàtálá": [101, 125],
  };
  return map[archetype] ?? [1, 125];
}
