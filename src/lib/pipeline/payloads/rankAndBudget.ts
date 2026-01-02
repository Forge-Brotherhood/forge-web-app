/**
 * RANK_AND_BUDGET Stage Payload
 *
 * Output from the thin adapter that wraps the existing memory pipeline.
 */

import type {
  CandidateContext,
  TokenEstimateMethod,
  ScoreBreakdown,
} from "../types";
import type { Plan } from "../plan/types";

export const RANK_AND_BUDGET_SCHEMA_VERSION = "2.0.0";

export interface RankAndBudgetPayload {
  schemaVersion: typeof RANK_AND_BUDGET_SCHEMA_VERSION;
  plan: Plan;
  selected: Array<{
    id: string; // Stable derivable ID
    candidate: CandidateContext;
    finalScore: number;
    tokenEstimate: number;
    tokenEstimateMethod: TokenEstimateMethod;
    reason: string;
    scoreBreakdown?: ScoreBreakdown;
  }>;
  excluded: Array<{
    id: string;
    reason: string;
    details?: string;
  }>;
  budget: {
    max: number;
    used: number;
    bySource: Record<string, number>;
    tokenEstimateMethod: TokenEstimateMethod;
  };
  scoringSummary?: {
    avgScore: number;
    scoreRange: [number, number];
  };
}
