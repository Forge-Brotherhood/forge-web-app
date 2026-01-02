/**
 * MEMORY_EXTRACTION Stage Payload
 *
 * Output from the async memory extraction stage.
 * This stage runs after MODEL_CALL and does not block the response.
 */

import type { EvaluationResult } from "@/lib/memory/signalEvaluator";
import type { MemoryCandidate } from "@/lib/memory/candidateExtractor";

export const MEMORY_EXTRACTION_SCHEMA_VERSION = "2.0.0";

export interface MemoryExtractionPayload {
  schemaVersion: typeof MEMORY_EXTRACTION_SCHEMA_VERSION;
  /** Whether extraction was eligible based on response flags */
  eligible: boolean;
  /** Basis for eligibility decision (no raw user content) */
  basis: {
    responseMode: string;
    selfDisclosure: boolean;
  };
  /** Candidates extracted from the conversation turn */
  candidatesExtracted: MemoryCandidateSummary[];
  /** Results of signal evaluation and promotion */
  evaluationResult: EvaluationResultSummary | null;
  /** Whether extraction completed successfully */
  success: boolean;
  /** Error message if extraction failed */
  error?: string;
  /** Whether this ran in dry-run mode (no database writes) */
  dryRun?: boolean;
}

/**
 * Summary of an extracted memory candidate (redacted for artifact storage).
 */
export interface MemoryCandidateSummary {
  type: string;
  value: string;
  confidence: number;
  // Evidence is redacted for privacy
}

/**
 * Summary of evaluation results (redacted for artifact storage).
 */
export interface EvaluationResultSummary {
  signalsCreated: number;
  signalsIncremented: number;
  memoriesPromoted: number;
  memoriesReinforced: number;
  actions: string[]; // Summary of actions taken
}

/**
 * Convert raw candidates to summary format.
 */
export function summarizeCandidates(
  candidates: MemoryCandidate[]
): MemoryCandidateSummary[] {
  return candidates.map((c) => ({
    type: c.type,
    value: c.value,
    confidence: c.confidence,
  }));
}

/**
 * Convert evaluation result to summary format.
 */
export function summarizeEvaluationResult(
  result: EvaluationResult
): EvaluationResultSummary {
  return {
    signalsCreated: result.signalsCreated,
    signalsIncremented: result.signalsIncremented,
    memoriesPromoted: result.memoriesPromoted,
    memoriesReinforced: result.memoriesReinforced,
    actions: result.details.map(
      (d: any) => `${d.candidateType}:${d.candidateValue} -> ${d.action}`
    ),
  };
}
