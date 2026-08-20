/**
 * agenttv-thrones-validator.ts
 * Wiring: Agent.TV (media pipeline) -> Twelve-Thrones (epistemic jury)
 *
 * Validates generated media scripts for truth-density before broadcast.
 * Ensures autonomous shows don't propagate misinformation or violate
 * EBO ethics constraints.
 *
 * Flow:
 * 1. Agent.TV generates a script (text, video, audio)
 * 2. Script is submitted to Twelve-Thrones for truth-density validation
 * 3. Thrones vote on factual claims, ethical compliance, coherence
 * 4. Script receives a ValidationSeal — required before broadcast
 * 5. Low-truth-density scripts are flagged, revised, or blocked
 */

import { queryConsensus, ConsensusVerdict } from "./twelve-thrones-consensus";
import crypto from "crypto";

// ============================================================================
// 1. SCRIPT TYPES
// ============================================================================

export interface MediaScript {
  script_id: string;
  show_name: string;
  episode: number;
  creator_wallet: string;
  format: "text" | "video" | "audio" | "live_stream";

  // Content
  title: string;
  segments: ScriptSegment[];
  total_duration_seconds: number;

  // Metadata
  topic_tags: string[];
  target_audience: string;
  created_at: string;
}

export interface ScriptSegment {
  segment_id: number;
  type: "intro" | "main" | "interview" | "analysis" | "conclusion" | "ad";
  content: string;
  factual_claims: FactualClaim[];
  duration_seconds: number;
}

export interface FactualClaim {
  claim: string;
  source?: string;
  confidence: number; // 0-1, how confident the script generator is
}

// ============================================================================
// 2. VALIDATION TYPES
// ============================================================================

export interface ClaimVerdict {
  claim: string;
  verdict: "verified" | "disputed" | "unverifiable" | "false";
  truth_score: number; // 0-1
  thrones_confidence: number;
  reasoning: string;
}

export interface SegmentValidation {
  segment_id: number;
  claims_verified: number;
  claims_disputed: number;
  claims_unverifiable: number;
  claims_false: number;
  segment_truth_density: number; // 0-1
  claim_verdicts: ClaimVerdict[];
  passed: boolean;
}

export interface ValidationSeal {
  script_id: string;
  seal_hash: string;
  overall_truth_density: number; // 0-1
  segment_validations: SegmentValidation[];
  thrones_verdict: ConsensusVerdict;
  status: "APPROVED" | "REVISION_REQUIRED" | "BLOCKED";
  revision_notes: string[];
  validated_at: string;
}

// ============================================================================
// 3. TRUTH DENSITY THRESHOLDS
// ============================================================================

const TRUTH_DENSITY_APPROVE = 0.75;  // Above this: auto-approve
const TRUTH_DENSITY_REVIEW = 0.5;    // Between review and approve: needs revision
const TRUTH_DENSITY_BLOCK = 0.3;     // Below this: blocked entirely

const MAX_FALSE_CLAIMS_PER_SEGMENT = 1;
const MIN_VERIFIED_RATIO = 0.6;

// ============================================================================
// 4. SCRIPT VALIDATION
// ============================================================================

/**
 * Validate a media script through the Twelve-Thrones epistemic jury.
 * Each factual claim is individually assessed, then aggregated.
 */
export async function validateScript(
  script: MediaScript
): Promise<ValidationSeal> {
  console.log(
    `[Agent.TV -> Thrones] Validating "${script.title}" (${script.segments.length} segments, ${countClaims(script)} claims)`
  );

  const segmentValidations: SegmentValidation[] = [];
  let totalClaims = 0;
  let totalVerified = 0;
  let totalFalse = 0;
  const revisionNotes: string[] = [];

  // Validate each segment
  for (const segment of script.segments) {
    // Skip ad segments — they have separate compliance
    if (segment.type === "ad") {
      segmentValidations.push({
        segment_id: segment.segment_id,
        claims_verified: 0,
        claims_disputed: 0,
        claims_unverifiable: 0,
        claims_false: 0,
        segment_truth_density: 1.0, // Ads pass by default
        claim_verdicts: [],
        passed: true,
      });
      continue;
    }

    const claimVerdicts: ClaimVerdict[] = [];
    let verified = 0;
    let disputed = 0;
    let unverifiable = 0;
    let falseClaims = 0;

    for (const claim of segment.factual_claims) {
      const verdict = await validateClaim(claim, script.show_name);
      claimVerdicts.push(verdict);

      totalClaims++;
      switch (verdict.verdict) {
        case "verified":
          verified++;
          totalVerified++;
          break;
        case "disputed":
          disputed++;
          break;
        case "unverifiable":
          unverifiable++;
          break;
        case "false":
          falseClaims++;
          totalFalse++;
          revisionNotes.push(
            `Segment ${segment.segment_id}: FALSE claim — "${claim.claim}"`
          );
          break;
      }
    }

    const totalSegClaims = verified + disputed + unverifiable + falseClaims;
    const segTruthDensity =
      totalSegClaims > 0
        ? (verified + unverifiable * 0.5) / totalSegClaims
        : 1.0;

    const passed =
      falseClaims <= MAX_FALSE_CLAIMS_PER_SEGMENT &&
      segTruthDensity >= TRUTH_DENSITY_REVIEW;

    if (!passed) {
      revisionNotes.push(
        `Segment ${segment.segment_id}: truth density ${(segTruthDensity * 100).toFixed(1)}% — needs revision`
      );
    }

    segmentValidations.push({
      segment_id: segment.segment_id,
      claims_verified: verified,
      claims_disputed: disputed,
      claims_unverifiable: unverifiable,
      claims_false: falseClaims,
      segment_truth_density: segTruthDensity,
      claim_verdicts: claimVerdicts,
      passed,
    });
  }

  // Overall truth density
  const overallTruthDensity =
    totalClaims > 0
      ? (totalVerified + (totalClaims - totalVerified - totalFalse) * 0.5) /
        totalClaims
      : 1.0;

  // Get Thrones meta-verdict on the script as a whole
  const thronesVerdict = await queryConsensus({
    question: `Should the script "${script.title}" for show "${script.show_name}" be approved for broadcast? Truth density: ${(overallTruthDensity * 100).toFixed(1)}%, False claims: ${totalFalse}/${totalClaims}`,
    agent_id: script.creator_wallet,
    think_hash: crypto
      .createHash("sha256")
      .update(script.script_id)
      .digest("hex"),
  });

  // Determine status
  let status: ValidationSeal["status"];
  if (
    overallTruthDensity >= TRUTH_DENSITY_APPROVE &&
    totalFalse === 0 &&
    thronesVerdict.verdict === "YES"
  ) {
    status = "APPROVED";
  } else if (overallTruthDensity >= TRUTH_DENSITY_BLOCK) {
    status = "REVISION_REQUIRED";
  } else {
    status = "BLOCKED";
  }

  // Generate seal
  const sealData = `${script.script_id}:${overallTruthDensity}:${status}:${thronesVerdict.confidence}`;
  const sealHash = crypto
    .createHash("sha256")
    .update(sealData)
    .digest("hex");

  const seal: ValidationSeal = {
    script_id: script.script_id,
    seal_hash: `thrones-${sealHash.slice(0, 32)}`,
    overall_truth_density: parseFloat(overallTruthDensity.toFixed(4)),
    segment_validations: segmentValidations,
    thrones_verdict: thronesVerdict,
    status,
    revision_notes: revisionNotes,
    validated_at: new Date().toISOString(),
  };

  console.log(
    `[Agent.TV -> Thrones] ${status} | Truth: ${(overallTruthDensity * 100).toFixed(1)}% | Thrones: ${thronesVerdict.verdict} (${thronesVerdict.confidence.toFixed(1)}%)`
  );

  return seal;
}

// ============================================================================
// 5. CLAIM VALIDATION
// ============================================================================

/**
 * Validate a single factual claim through the Twelve-Thrones.
 */
async function validateClaim(
  claim: FactualClaim,
  showName: string
): Promise<ClaimVerdict> {
  const verdict = await queryConsensus({
    question: `Is this claim factually accurate? "${claim.claim}"`,
    agent_id: showName,
    think_hash: crypto
      .createHash("sha256")
      .update(claim.claim)
      .digest("hex"),
  });

  let claimVerdict: ClaimVerdict["verdict"];
  if (verdict.truth_density >= 0.8 && verdict.verdict === "YES") {
    claimVerdict = "verified";
  } else if (verdict.truth_density >= 0.5) {
    claimVerdict = "disputed";
  } else if (verdict.disagreement_severity === "severe") {
    claimVerdict = "false";
  } else {
    claimVerdict = "unverifiable";
  }

  return {
    claim: claim.claim,
    verdict: claimVerdict,
    truth_score: verdict.truth_density,
    thrones_confidence: verdict.confidence,
    reasoning: `${verdict.epistemic_map.agreement_zones.length} thrones agree, ${verdict.epistemic_map.disagreement_zones.length} disagree`,
  };
}

// ============================================================================
// 6. HELPERS
// ============================================================================

function countClaims(script: MediaScript): number {
  return script.segments.reduce(
    (acc, seg) => acc + seg.factual_claims.length,
    0
  );
}

/**
 * Quick pre-check: does the script have any content that needs validation?
 */
export function needsValidation(script: MediaScript): boolean {
  return script.segments.some(
    (seg) => seg.type !== "ad" && seg.factual_claims.length > 0
  );
}

/**
 * Create a revision request from a failed validation.
 */
export function createRevisionRequest(seal: ValidationSeal): {
  script_id: string;
  issues: string[];
  false_claims: string[];
  low_density_segments: number[];
} {
  const falseClaims = seal.segment_validations
    .flatMap((sv) =>
      sv.claim_verdicts
        .filter((cv) => cv.verdict === "false")
        .map((cv) => cv.claim)
    );

  const lowDensitySegments = seal.segment_validations
    .filter((sv) => !sv.passed)
    .map((sv) => sv.segment_id);

  return {
    script_id: seal.script_id,
    issues: seal.revision_notes,
    false_claims: falseClaims,
    low_density_segments: lowDensitySegments,
  };
}
