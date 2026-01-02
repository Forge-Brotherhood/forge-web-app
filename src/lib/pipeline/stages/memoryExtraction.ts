/**
 * MEMORY_EXTRACTION Stage
 *
 * Async stage that runs after MODEL_CALL to extract memory candidates
 * and evaluate them for signal promotion.
 *
 * Key behaviors:
 * - Fire-and-forget: Does not block the response to user
 * - Flag-gated: Only runs when the planner indicates self-disclosure
 * - Extraction: Uses LLM to identify struggle themes and faith stages
 * - Evaluation: Updates signals and promotes to durable memories
 */

import { PipelineStage, type RunContext, type StageArtifact, PIPELINE_VERSION } from "../types";
import type { StageOutput } from "../orchestrator";
import type { IngressPayload } from "../payloads/ingress";
import type { ModelCallPayload } from "../payloads/modelCall";
import {
  MEMORY_EXTRACTION_SCHEMA_VERSION,
  type MemoryExtractionPayload,
  summarizeCandidates,
  summarizeEvaluationResult,
} from "../payloads/memoryExtraction";
import { persistArtifact } from "../persistence";
import { extractCandidates } from "@/lib/memory/candidateExtractor";
import { evaluateAndPromote } from "@/lib/memory/signalEvaluator";

// =============================================================================
// Eligibility Check
// =============================================================================

function isEligibleForExtraction(selfDisclosure: boolean): boolean {
  return selfDisclosure;
}

// =============================================================================
// Stage Executor
// =============================================================================

/**
 * Execute the MEMORY_EXTRACTION stage.
 *
 * This is designed to be called asynchronously after MODEL_CALL completes.
 * It extracts memory candidates from the conversation and evaluates them
 * for signal promotion.
 */
export async function executeMemoryExtractionStage(
  ctx: RunContext,
  ingressPayload: IngressPayload,
  modelCallPayload: ModelCallPayload
): Promise<StageOutput<MemoryExtractionPayload>> {
  const responseMode = ingressPayload.plan.response.responseMode;
  const selfDisclosure = ingressPayload.plan.response.flags.selfDisclosure;

  // Use dry-run mode when side effects are disabled (e.g., debug mode)
  const dryRun = ctx.sideEffects === "disabled";

  // Check eligibility first
  if (!isEligibleForExtraction(selfDisclosure)) {
    const payload: MemoryExtractionPayload = {
      schemaVersion: MEMORY_EXTRACTION_SCHEMA_VERSION,
      eligible: false,
      basis: { responseMode, selfDisclosure },
      candidatesExtracted: [],
      evaluationResult: null,
      success: true,
      dryRun,
    };

    return {
      payload,
      summary: `Skipped: not eligible for extraction (selfDisclosure=false)${dryRun ? " (dry run)" : ""}`,
      stats: {
        eligible: 0,
        candidatesExtracted: 0,
        dryRun: dryRun ? 1 : 0,
      },
    };
  }

  try {
    // Step 1: Extract candidates from the conversation turn
    const candidates = await extractCandidates({
      message: ingressPayload.normalizedInput,
      assistantResponse: modelCallPayload.responsePreview,
      // Could add conversation summary here if available
    });

    if (candidates.length === 0) {
      const payload: MemoryExtractionPayload = {
        schemaVersion: MEMORY_EXTRACTION_SCHEMA_VERSION,
        eligible: true,
        basis: { responseMode, selfDisclosure },
        candidatesExtracted: [],
        evaluationResult: null,
        success: true,
        dryRun,
      };

      return {
        payload,
        summary: `No candidates extracted${dryRun ? " (dry run)" : ""}`,
        stats: {
          eligible: 1,
          candidatesExtracted: 0,
          dryRun: dryRun ? 1 : 0,
        },
      };
    }

    // Step 2: Evaluate candidates and update signals/memories
    // Need a conversation ID for double-count prevention
    const conversationId = ctx.requestId; // Using requestId as proxy for conversation

    const evaluationResult = await evaluateAndPromote(
      ctx.userId,
      conversationId,
      candidates,
      { dryRun }
    );

    const payload: MemoryExtractionPayload = {
      schemaVersion: MEMORY_EXTRACTION_SCHEMA_VERSION,
      eligible: true,
      basis: { responseMode, selfDisclosure },
      candidatesExtracted: summarizeCandidates(candidates),
      evaluationResult: summarizeEvaluationResult(evaluationResult),
      success: true,
      dryRun,
    };

    const dryRunSuffix = dryRun ? " (dry run - no DB writes)" : "";
    return {
      payload,
      summary: `Extracted ${candidates.length} candidates, promoted ${evaluationResult.memoriesPromoted}${dryRunSuffix}`,
      stats: {
        eligible: 1,
        candidatesExtracted: candidates.length,
        signalsCreated: evaluationResult.signalsCreated,
        signalsIncremented: evaluationResult.signalsIncremented,
        memoriesPromoted: evaluationResult.memoriesPromoted,
        memoriesReinforced: evaluationResult.memoriesReinforced,
        dryRun: dryRun ? 1 : 0,
      },
    };
  } catch (error) {
    console.error("[MemoryExtraction] Stage failed:", error);

    const payload: MemoryExtractionPayload = {
      schemaVersion: MEMORY_EXTRACTION_SCHEMA_VERSION,
      eligible: true,
      basis: { responseMode, selfDisclosure },
      candidatesExtracted: [],
      evaluationResult: null,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      dryRun,
    };

    return {
      payload,
      summary: `Failed: ${error instanceof Error ? error.message : "unknown error"}`,
      stats: {
        eligible: 1,
        candidatesExtracted: 0,
        error: 1,
        dryRun: dryRun ? 1 : 0,
      },
    };
  }
}

// =============================================================================
// Async Wrapper
// =============================================================================

/**
 * Execute memory extraction asynchronously (fire-and-forget).
 *
 * This function is meant to be called without await from the orchestrator.
 * It handles its own errors and logging.
 * It also persists the artifact to the database so the debugger can display it.
 */
export async function executeMemoryExtractionAsync(
  ctx: RunContext,
  ingressPayload: IngressPayload,
  modelCallPayload: ModelCallPayload
): Promise<void> {
  const startTime = Date.now();

  console.log(
    `[MemoryExtraction] Starting async extraction for run ${ctx.runId}, responseMode: ${ingressPayload.plan.response.responseMode}`
  );

  try {
    const result = await executeMemoryExtractionStage(
      ctx,
      ingressPayload,
      modelCallPayload
    );

    const durationMs = Date.now() - startTime;

    console.log(`[MemoryExtraction] Stage completed in ${durationMs}ms: ${result.summary}`);

    // Create artifact for persistence
    const artifact: StageArtifact<MemoryExtractionPayload> = {
      traceId: ctx.traceId,
      runId: ctx.runId,
      stage: PipelineStage.MEMORY_EXTRACTION,
      schemaVersion: MEMORY_EXTRACTION_SCHEMA_VERSION,
      pipelineVersion: PIPELINE_VERSION,
      createdAt: new Date().toISOString(),
      durationMs,
      summary: result.summary,
      payload: result.payload,
      stats: result.stats,
    };

    console.log(`[MemoryExtraction] Persisting artifact for run ${ctx.runId}...`);

    // Persist the artifact so the debugger can display it
    await persistArtifact(ctx, artifact);

    console.log(
      `[MemoryExtraction] Completed and persisted: ${result.summary}`,
      result.stats
    );
  } catch (error) {
    // Log but don't throw - this is fire-and-forget
    console.error("[MemoryExtraction] Async execution failed:", error);
    console.error("[MemoryExtraction] Error details:", {
      runId: ctx.runId,
      traceId: ctx.traceId,
      responseMode: ingressPayload.plan.response.responseMode,
      selfDisclosure: ingressPayload.plan.response.flags.selfDisclosure,
    });

    // Still try to persist an error artifact for debugging
    const durationMs = Date.now() - startTime;
    const dryRun = ctx.sideEffects === "disabled";
    const errorPayload: MemoryExtractionPayload = {
      schemaVersion: MEMORY_EXTRACTION_SCHEMA_VERSION,
      eligible: true, // We tried to run it
      basis: {
        responseMode: ingressPayload.plan.response.responseMode,
        selfDisclosure: ingressPayload.plan.response.flags.selfDisclosure,
      },
      candidatesExtracted: [],
      evaluationResult: null,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      dryRun,
    };

    const errorArtifact: StageArtifact<MemoryExtractionPayload> = {
      traceId: ctx.traceId,
      runId: ctx.runId,
      stage: PipelineStage.MEMORY_EXTRACTION,
      schemaVersion: MEMORY_EXTRACTION_SCHEMA_VERSION,
      pipelineVersion: PIPELINE_VERSION,
      createdAt: new Date().toISOString(),
      durationMs,
      summary: `Error: ${error instanceof Error ? error.message : "unknown"}`,
      payload: errorPayload,
      stats: { error: 1, dryRun: dryRun ? 1 : 0 },
    };

    console.log(`[MemoryExtraction] Persisting error artifact for run ${ctx.runId}...`);
    try {
      await persistArtifact(ctx, errorArtifact);
      console.log(`[MemoryExtraction] Error artifact persisted for run ${ctx.runId}`);
    } catch (persistError) {
      console.error("[MemoryExtraction] Failed to persist error artifact:", persistError);
    }
  }
}
