/**
 * CONTEXT_CANDIDATES Stage Payload
 *
 * Output from the context gathering stage that fans out to all providers.
 */

import type { CandidateContext } from "../types";
import type { Plan } from "../plan/types";

export const CONTEXT_CANDIDATES_SCHEMA_VERSION = "2.0.0";

export interface ContextCandidatesPayload {
  schemaVersion: typeof CONTEXT_CANDIDATES_SCHEMA_VERSION;
  candidates: CandidateContext[];
  bySourceCounts: Record<string, number>;
  plan: Plan;
}
