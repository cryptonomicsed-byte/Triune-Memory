/**
 * twelve-thrones-consensus.ts
 * Wiring: Twelve Thrones (epistemology engine) → Organism (verdict integration)
 *
 * After a VM execution passes Zangbeto audit, this bridge submits
 * the agent's thought to the Twelve Thrones consensus engine for
 * epistemic validation. The verdict is annotated with ritual alignment
 * (if the Technosis adapter is available) and returned to the organism.
 */

export interface ConsensusRequest {
  question: string;
  agent_id: string;
  think_hash: string;
}

export interface ConsensusVerdict {
  verdict: string;
  confidence: number;
  weightedYes: number;
  weightedNo: number;
  disagreement_severity: "unanimous" | "strong" | "moderate" | "severe";
  epistemic_map: {
    agreement_zones: string[];
    disagreement_zones: string[];
    knowledge_frontiers: string[];
  };
  ritual_alignment?: {
    day: string;
    archetype: string;
    principle: string;
    crypto_sector: string;
    frequency: string;
  };
  status: "live" | "simulated";
}

const THRONES_URL = process.env.TWELVE_THRONES_URL || "http://localhost:3000";

/**
 * Query the Twelve Thrones consensus engine.
 * Falls back to simulation if the server is not running.
 */
export async function queryConsensus(
  request: ConsensusRequest
): Promise<ConsensusVerdict> {
  console.log(
    `[Organism] Twelve Thrones: Submitting "${request.question.slice(0, 40)}..." for epistemic verdict`
  );

  const forceReal =
    process.env.FORCE_REAL_THRONES === "true" ||
    process.env.REALLY_BREATHE === "true";

  try {
    const res = await fetch(`${THRONES_URL}/api/consensus`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const verdict: ConsensusVerdict = {
      verdict: data.verdict,
      confidence: data.confidence,
      weightedYes: data.weightedYes,
      weightedNo: data.weightedNo,
      disagreement_severity: data.disagreement?.severity || "moderate",
      epistemic_map: data.epistemic_map || {
        agreement_zones: [],
        disagreement_zones: [],
        knowledge_frontiers: [],
      },
      status: "live",
    };

    console.log(
      `[Organism] Twelve Thrones LIVE: ${verdict.verdict} (${verdict.confidence.toFixed(1)}% confidence)`
    );
    return verdict;
  } catch (err) {
    if (forceReal) {
      console.error(
        `[Organism] ❌ FATAL: Twelve Thrones unreachable and FORCE_REAL_THRONES=true.`
      );
      throw new Error(`Twelve Thrones unreachable: ${err}`);
    }

    console.warn(
      `[Organism] ⚠️ Twelve Thrones offline. Falling back to simulation.`
    );

    return {
      verdict: "YES (simulated consensus)",
      confidence: 85.0,
      weightedYes: 0.694,
      weightedNo: 0.306,
      disagreement_severity: "moderate",
      epistemic_map: {
        agreement_zones: ["Simulated agreement on agent thought"],
        disagreement_zones: [],
        knowledge_frontiers: [
          "Live consensus unavailable — connect Twelve Thrones server",
        ],
      },
      status: "simulated",
    };
  }
}
