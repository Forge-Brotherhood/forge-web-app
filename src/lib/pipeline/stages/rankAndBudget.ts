/**
 * RANK_AND_BUDGET Stage
 *
 * Ranks and filters context candidates based on relevance and budget.
 * Uses the new UserMemory model with strength-based ranking.
 */

import type { RunContext, CandidateContext, TokenEstimateMethod } from "../types";
import type { StageOutput } from "../orchestrator";
import {
  RANK_AND_BUDGET_SCHEMA_VERSION,
  type RankAndBudgetPayload,
} from "../payloads/rankAndBudget";
import type { ContextCandidatesPayload } from "../payloads/contextCandidates";
import { RETRIEVAL_NEEDS, type TemporalDirection } from "../plan/types";
import type { ArtifactType } from "@/lib/artifacts/types";

// =============================================================================
// Constants
// =============================================================================

const TOKEN_ESTIMATE_METHOD: TokenEstimateMethod = "heuristic";
const DEFAULT_MAX_SEMANTIC_ARTIFACTS = 5;
const DEFAULT_MAX_HIGHLIGHTS = 10;
const DEFAULT_MAX_NOTES = 10;
const DEFAULT_MAX_SESSION_SUMMARIES = 3;
const MAX_TOKEN_BUDGET = 2000;
const SEMANTIC_THRESHOLD = 0.3; // Minimum cosine similarity for artifacts

// =============================================================================
// Token Estimation
// =============================================================================

/**
 * Estimate tokens for a string (heuristic: ~4 chars per token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// =============================================================================
// Ranking Helpers
// =============================================================================

/**
 * Calculate temporal score based on direction preference.
 * - "oldest": older dates get higher scores
 * - "newest": newer dates get higher scores
 */
function calculateTemporalScore(
  createdAt: string | undefined,
  direction: TemporalDirection,
  allDates: string[]
): number {
  if (!createdAt || allDates.length === 0) return 0.5;

  const timestamp = new Date(createdAt).getTime();
  const timestamps = allDates.map((d) => new Date(d).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  if (maxTime === minTime) return 0.5; // All same date

  // Normalize to 0-1 range
  const normalized = (timestamp - minTime) / (maxTime - minTime);

  // oldest: lower timestamp = higher score | newest: higher timestamp = higher score
  return direction === "oldest" ? 1 - normalized : normalized;
}

/**
 * Calculate a final score for a candidate based on its features.
 * - Memories: 70% strength + 30% recency
 * - Artifacts: 80% semantic + 20% recency (default), or 50% semantic + 40% temporal + 10% recency
 */
function calculateScore(
  candidate: CandidateContext,
  temporalDirection?: TemporalDirection
): number {
  const features = candidate.features || {};

  // For artifacts, use semantic similarity as primary signal
  if (candidate.source === "artifact") {
    const semanticScore = features.semanticScore ?? 0.5;
    const recencyScore = features.recencyScore ?? 0.5;
    const temporalScore = features.temporalScore ?? 0.5;

    if (temporalDirection) {
      // Temporal active: 50% semantic, 40% temporal, 10% recency
      return semanticScore * 0.5 + temporalScore * 0.4 + recencyScore * 0.1;
    }

    // Default: 80% semantic relevance, 20% recency
    return semanticScore * 0.8 + recencyScore * 0.2;
  }

  // For other sources (bible, life_context, system), use default high score
  return 1.0;
}

/**
 * Check if a memory candidate passes safety checks.
 * Simple content-based checks for now.
 */
function isSafeContent(preview: string): boolean {
  // Basic safety patterns
  const unsafePatterns = [
    /\b(suicid|self.?harm|kill myself)\b/i,
    /\b(abuse|assault|violence)\b/i,
  ];

  return !unsafePatterns.some((pattern) => pattern.test(preview));
}

// =============================================================================
// Stage Executor
// =============================================================================

/**
 * Execute the RANK_AND_BUDGET stage.
 * Ranks memories and artifacts, allocating them a shared token budget.
 */
export async function executeRankAndBudgetStage(
  ctx: RunContext,
  candidatesPayload: ContextCandidatesPayload
): Promise<StageOutput<RankAndBudgetPayload>> {
  const { candidates, plan } = candidatesPayload;
  const needs = new Set(plan.retrieval.needs);
  const temporalDirection = plan.retrieval.filters?.temporal?.direction;
  const excludedList: Array<{ id: string; reason: string; details?: string }> = [];

  console.log("[RankAndBudget] Input candidates:", {
    total: candidates.length,
    bySource: candidates.reduce((acc, c) => {
      acc[c.source] = (acc[c.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    responseMode: plan.response.responseMode,
    needs: plan.retrieval.needs,
  });

  // Separate candidates by type
  const artifactCandidates: CandidateContext[] = [];
  const otherCandidates: CandidateContext[] = [];

  const isArtifactAllowed = (candidate: CandidateContext): boolean => {
    const artifactType = candidate.metadata?.artifactType as ArtifactType | undefined;
    const hasSemanticScore = typeof candidate.features?.semanticScore === "number";

    // Semantic results can include many artifact types; only allow them when semantic retrieval is requested.
    if (hasSemanticScore) return needs.has(RETRIEVAL_NEEDS.artifact_semantic);

    if (!artifactType) return needs.has(RETRIEVAL_NEEDS.artifact_semantic);

    if (artifactType === "verse_highlight") {
      return needs.has(RETRIEVAL_NEEDS.verse_highlights) || needs.has(RETRIEVAL_NEEDS.artifact_semantic);
    }
    if (artifactType === "verse_note") {
      return needs.has(RETRIEVAL_NEEDS.verse_notes) || needs.has(RETRIEVAL_NEEDS.artifact_semantic);
    }
    if (artifactType === "conversation_session_summary") {
      return (
        needs.has(RETRIEVAL_NEEDS.conversation_session_summaries) ||
        needs.has(RETRIEVAL_NEEDS.artifact_semantic)
      );
    }

    // Other artifacts are only relevant for semantic/topic queries.
    return needs.has(RETRIEVAL_NEEDS.artifact_semantic);
  };

  for (const candidate of candidates) {
    if (candidate.source === "user_memory") {
      // User memory retrieval is disabled for pipeline flows for now.
      excludedList.push({
        id: candidate.id,
        reason: "disabled",
        details: "User memory retrieval is disabled for pipeline flows",
      });
    } else if (candidate.source === "artifact") {
      if (!isArtifactAllowed(candidate)) {
        excludedList.push({
          id: candidate.id,
          reason: "plan_needs",
          details: "Artifact not requested by retrieval plan",
        });
      } else {
        artifactCandidates.push(candidate);
      }
    } else {
      otherCandidates.push(candidate);
    }
  }

  // Safety filter for artifact candidates
  const safeArtifacts: CandidateContext[] = [];
  for (const artifact of artifactCandidates) {
    if (isSafeContent(artifact.preview)) {
      safeArtifacts.push(artifact);
    } else {
      excludedList.push({
        id: artifact.id,
        reason: "safety_filter",
        details: "Contains potentially sensitive content",
      });
    }
  }

  // Semantic threshold filter for artifacts
  const filteredArtifacts = safeArtifacts.filter((artifact) => {
    const semanticScore = artifact.features?.semanticScore;
    // Only enforce semantic threshold for semantic-scored artifacts.
    if (typeof semanticScore === "number" && semanticScore < SEMANTIC_THRESHOLD) {
      excludedList.push({
        id: artifact.id,
        reason: "semantic_threshold",
        details: `Semantic score ${semanticScore.toFixed(3)} below threshold ${SEMANTIC_THRESHOLD}`,
      });
      return false;
    }
    return true;
  });

  // Calculate temporal scores for artifacts if direction is specified
  if (temporalDirection && filteredArtifacts.length > 0) {
    const allDates = filteredArtifacts
      .map((a) => a.features?.createdAt)
      .filter((d): d is string => !!d);

    console.log("[RankAndBudget] Applying temporal re-ranking:", {
      direction: temporalDirection,
      range: plan.retrieval.filters?.temporal?.range,
      artifactCount: filteredArtifacts.length,
    });

    for (const artifact of filteredArtifacts) {
      const temporalScore = calculateTemporalScore(
        artifact.features?.createdAt,
        temporalDirection,
        allDates
      );
      artifact.features = {
        ...artifact.features,
        temporalScore,
      };
    }
  }

  // Score and rank artifacts (with temporal direction if present)
  const scoredArtifacts = filteredArtifacts.map((candidate) => ({
    candidate,
    score: calculateScore(candidate, temporalDirection),
  }));
  scoredArtifacts.sort((a, b) => b.score - a.score);

  const maxSemanticArtifacts =
    plan.retrieval.limits?.[RETRIEVAL_NEEDS.artifact_semantic] ?? DEFAULT_MAX_SEMANTIC_ARTIFACTS;
  const maxHighlights =
    plan.retrieval.limits?.[RETRIEVAL_NEEDS.verse_highlights] ?? DEFAULT_MAX_HIGHLIGHTS;
  const maxNotes = plan.retrieval.limits?.[RETRIEVAL_NEEDS.verse_notes] ?? DEFAULT_MAX_NOTES;
  const maxSessionSummaries =
    plan.retrieval.limits?.[RETRIEVAL_NEEDS.conversation_session_summaries] ??
    DEFAULT_MAX_SESSION_SUMMARIES;

  const selected: RankAndBudgetPayload["selected"] = [];
  let tokenBudgetUsed = 0;

  // Always include non-memory/non-artifact candidates first
  for (const c of otherCandidates) {
    const tokenEstimate = estimateTokens(c.preview);
    selected.push({
      id: c.id,
      candidate: c,
      finalScore: 1.0,
      tokenEstimate,
      tokenEstimateMethod: TOKEN_ESTIMATE_METHOD,
      reason: c.source,
    });
    tokenBudgetUsed += tokenEstimate;
  }

  // Select artifacts with per-need caps
  const artifactCounts = {
    semantic: 0,
    highlights: 0,
    notes: 0,
    sessionSummaries: 0,
  };

  let artifactCount = 0;
  for (const item of scoredArtifacts) {
    const artifactType = item.candidate.metadata?.artifactType as ArtifactType | undefined;
    const hasSemanticScore = typeof item.candidate.features?.semanticScore === "number";

    if (hasSemanticScore) {
      if (artifactCounts.semantic >= maxSemanticArtifacts) {
        excludedList.push({
          id: item.candidate.id,
          reason: "max_limit",
          details: `Max semantic artifacts ${maxSemanticArtifacts}`,
        });
        continue;
      }
    } else if (artifactType === "verse_highlight") {
      if (artifactCounts.highlights >= maxHighlights) {
        excludedList.push({
          id: item.candidate.id,
          reason: "max_limit",
          details: `Max highlights ${maxHighlights}`,
        });
        continue;
      }
    } else if (artifactType === "verse_note") {
      if (artifactCounts.notes >= maxNotes) {
        excludedList.push({
          id: item.candidate.id,
          reason: "max_limit",
          details: `Max notes ${maxNotes}`,
        });
        continue;
      }
    } else if (artifactType === "conversation_session_summary") {
      if (artifactCounts.sessionSummaries >= maxSessionSummaries) {
        excludedList.push({
          id: item.candidate.id,
          reason: "max_limit",
          details: `Max session summaries ${maxSessionSummaries}`,
        });
        continue;
      }
    } else {
      // Default to semantic cap for other artifacts
      if (artifactCounts.semantic >= maxSemanticArtifacts) {
        excludedList.push({
          id: item.candidate.id,
          reason: "max_limit",
          details: `Max semantic artifacts ${maxSemanticArtifacts}`,
        });
        continue;
      }
    }

    const tokenEstimate = estimateTokens(item.candidate.preview);
    if (tokenBudgetUsed + tokenEstimate > MAX_TOKEN_BUDGET) {
      excludedList.push({
        id: item.candidate.id,
        reason: "budget_exceeded",
        details: `Would exceed ${MAX_TOKEN_BUDGET} token budget`,
      });
      continue;
    }

    selected.push({
      id: item.candidate.id,
      candidate: item.candidate,
      finalScore: item.score,
      tokenEstimate,
      tokenEstimateMethod: TOKEN_ESTIMATE_METHOD,
      reason: hasSemanticScore ? "semantic_ranking" : "artifact_ranking",
    });

    tokenBudgetUsed += tokenEstimate;
    artifactCount++;

    if (hasSemanticScore) artifactCounts.semantic++;
    else if (artifactType === "verse_highlight") artifactCounts.highlights++;
    else if (artifactType === "verse_note") artifactCounts.notes++;
    else if (artifactType === "conversation_session_summary") artifactCounts.sessionSummaries++;
    else artifactCounts.semantic++;
  }

  // Calculate budget usage
  const totalTokens = selected.reduce((sum, s) => sum + s.tokenEstimate, 0);
  const bySource: Record<string, number> = {};
  for (const s of selected) {
    bySource[s.candidate.source] =
      (bySource[s.candidate.source] || 0) + s.tokenEstimate;
  }

  const payload: RankAndBudgetPayload = {
    schemaVersion: RANK_AND_BUDGET_SCHEMA_VERSION,
    plan,
    selected,
    excluded: excludedList,
    budget: {
      max: MAX_TOKEN_BUDGET,
      used: totalTokens,
      bySource,
      tokenEstimateMethod: TOKEN_ESTIMATE_METHOD,
    },
    scoringSummary:
      selected.length > 0
        ? {
            avgScore:
              selected.reduce((sum, m) => sum + m.finalScore, 0) / selected.length,
            scoreRange: [
              Math.min(...selected.map((m) => m.finalScore)),
              Math.max(...selected.map((m) => m.finalScore)),
            ],
          }
        : undefined,
  };

  // Build summary
  return {
    payload,
    summary: `${artifactCount} artifacts, ${otherCandidates.length} other, ${excludedList.length} excluded`,
    stats: {
      selectedCount: selected.length,
      artifactCount,
      excludedCount: excludedList.length,
      budgetUsed: totalTokens,
      budgetMax: MAX_TOKEN_BUDGET,
    },
  };
}
