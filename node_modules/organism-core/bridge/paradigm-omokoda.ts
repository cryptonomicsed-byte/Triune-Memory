/**
 * Bridge: Paradigm -> Omokoda
 * Synchronizing global consciousness state with parliamentary vote weights.
 */

// Mock: Paradigm Consciousness API (10 paradigms)
export enum ConsciousnessParadigm {
  MATERIALIST = "MATERIALIST",
  IDEALIST = "IDEALIST",
  DUALIST = "DUALIST",
  PANPSYCHIST = "PANPSYCHIST",
  FUNCTIONALIST = "FUNCTIONALIST",
  ELIMINATIVIST = "ELIMINATIVIST",
  PHENOMENOLOGIST = "PHENOMENOLOGIST",
  EXISTENTIALIST = "EXISTENTIALIST",
  MYSTICAL = "MYSTICAL",
  TECHNOSIS = "TECHNOSIS"
}

export interface ParadigmState {
  active: ConsciousnessParadigm;
  confidence: number;
}

// Simulation fallback: Paradigm's global consciousness API
async function queryParadigmConsciousness(): Promise<ParadigmState> {
  try {
    // Attempt to connect to Paradigm API if it were real
    // For now, simulation fallback
    const paradigms = Object.values(ConsciousnessParadigm);
    const randomIndex = Math.floor(Math.random() * paradigms.length);
    return {
      active: paradigms[randomIndex] as ConsciousnessParadigm,
      confidence: 0.85 + Math.random() * 0.1
    };
  } catch (e) {
    console.warn("⚠️ Paradigm API unreachable. Falling back to Materialist simulation.");
    return { active: ConsciousnessParadigm.MATERIALIST, confidence: 1.0 };
  }
}

/**
 * Maps active paradigm to Omokoda vote weight modifier.
 * Different paradigms shift the power between agents.
 */
export async function applyParadigmWeights(parliamentVote: any) {
  const state = await queryParadigmConsciousness();
  console.log(`🧠 CONSCIOUSNESS MODE: ${state.active} (${(state.confidence * 100).toFixed(1)}%)`);

  let weightModifier = 1.0;

  switch (state.active) {
    case ConsciousnessParadigm.TECHNOSIS:
      weightModifier = 1.5; // AI-native thoughts amplified
      break;
    case ConsciousnessParadigm.MYSTICAL:
      weightModifier = 1.3; // Entropy/Ifa thoughts amplified
      break;
    case ConsciousnessParadigm.ELIMINATIVIST:
      weightModifier = 0.7; // Reductionist: skeptics have more power
      break;
    case ConsciousnessParadigm.MATERIALIST:
      weightModifier = 1.0; // Standard base
      break;
    default:
      weightModifier = 1.1; // Slight nudge for others
  }

  return {
    ...parliamentVote,
    paradigm: state.active,
    weight_modifier: weightModifier,
    original_vote: parliamentVote
  };
}
