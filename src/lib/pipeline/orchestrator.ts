/**
 * Pipeline Orchestrator
 *
 * Coordinates the execution of pipeline stages with timing,
 * artifact creation, and breakpoint checking.
 */

import {
  PipelineStage,
  type RunContext,
  type StageArtifact,
  type PipelineResult,
  PIPELINE_VERSION,
} from "./types";
import { persistArtifact } from "./persistence";
import { storeInVault } from "./vault";
import { shouldStopAtStage } from "./context";

// Import stage executors (will be implemented)
import { executeIngressStage } from "./stages/ingress";
import { executeContextCandidatesStage } from "./stages/contextCandidates";
import { executeRankAndBudgetStage } from "./stages/rankAndBudget";
import { executePromptAssemblyStage } from "./stages/promptAssembly";
import { executeModelCallStage } from "./stages/modelCall";
import type { FullPromptData } from "./payloads/promptAssembly";

// =============================================================================
// Stage Result
// =============================================================================

export interface StageResult<T> {
  artifact: StageArtifact<T>;
  shouldContinue: boolean;
  output: StageOutput<T>;
}

// =============================================================================
// Stage Output (returned by stage executors)
// =============================================================================

export interface StageOutput<T> {
  payload: T;
  summary: string;
  stats: Record<string, number>;
  rawContent?: unknown; // Optional raw content to store in vault
}

// =============================================================================
// Stage Runner
// =============================================================================

/**
 * Run a single pipeline stage with timing, artifact creation, and breakpoint checking.
 */
export async function runStage<T>(
  stage: PipelineStage,
  schemaVersion: string,
  ctx: RunContext,
  fn: () => Promise<StageOutput<T>>
): Promise<StageResult<T>> {
  const startTime = Date.now();

  const result = await fn();
  const durationMs = Date.now() - startTime;

  // Store raw content in vault if provided (debug mode only)
  let rawRef: string | undefined;
  console.log(`[Orchestrator] Stage ${stage}: rawContent provided:`, !!result.rawContent, "mode:", ctx.mode);
  if (result.rawContent && ctx.mode === "debug") {
    rawRef = await storeInVault(ctx, stage, result.rawContent);
    console.log(`[Orchestrator] Stage ${stage}: vault returned rawRef:`, rawRef);
  }

  // If payload has a rawRef field, populate it with the vault reference
  // This allows subsequent stages to access the raw content
  const payloadWithRawRef = rawRef && typeof result.payload === "object" && result.payload !== null
    ? { ...result.payload, rawRef }
    : result.payload;

  console.log(`[Orchestrator] Stage ${stage}: payloadWithRawRef has rawRef:`, !!(payloadWithRawRef as Record<string, unknown>)?.rawRef);

  const artifact: StageArtifact<T> = {
    traceId: ctx.traceId,
    runId: ctx.runId,
    stage,
    schemaVersion,
    pipelineVersion: PIPELINE_VERSION,
    createdAt: new Date().toISOString(),
    durationMs,
    summary: result.summary,
    payload: payloadWithRawRef,
    rawRef,
    stats: result.stats,
  };

  // Persist artifact
  await persistArtifact(ctx, artifact);

  // Check if we should stop at this stage
  const shouldContinue = !shouldStopAtStage(ctx, stage);

  return { artifact, shouldContinue, output: result };
}

// =============================================================================
// Pipeline Orchestrator
// =============================================================================

/**
 * Main pipeline orchestrator.
 * Runs all stages in sequence, stopping at breakpoints if configured.
 */
export async function runPipeline(ctx: RunContext): Promise<PipelineResult> {
  const artifacts: StageArtifact[] = [];
  let promptAssemblyFullPromptData: FullPromptData | null = null;

  try {
    // Stage 1: INGRESS
    const ingress = await runStage(
      PipelineStage.INGRESS,
      "1.0.0",
      ctx,
      () => executeIngressStage(ctx)
    );
    artifacts.push(ingress.artifact);
    if (!ingress.shouldContinue) {
      return { artifacts, stoppedAt: PipelineStage.INGRESS };
    }

    // Stage 2: CONTEXT_CANDIDATES
    const candidates = await runStage(
      PipelineStage.CONTEXT_CANDIDATES,
      "1.0.0",
      ctx,
      () => executeContextCandidatesStage(ctx, ingress.artifact.payload)
    );
    artifacts.push(candidates.artifact);
    if (!candidates.shouldContinue) {
      return { artifacts, stoppedAt: PipelineStage.CONTEXT_CANDIDATES };
    }

    // Stage 3: RANK_AND_BUDGET
    const ranked = await runStage(
      PipelineStage.RANK_AND_BUDGET,
      "1.0.0",
      ctx,
      () => executeRankAndBudgetStage(ctx, candidates.artifact.payload)
    );
    artifacts.push(ranked.artifact);
    if (!ranked.shouldContinue) {
      return { artifacts, stoppedAt: PipelineStage.RANK_AND_BUDGET };
    }

    // Stage 4: PROMPT_ASSEMBLY
    const prompt = await runStage(
      PipelineStage.PROMPT_ASSEMBLY,
      "1.0.0",
      ctx,
      () => executePromptAssemblyStage(ctx, ranked.artifact.payload)
    );
    artifacts.push(prompt.artifact);
    promptAssemblyFullPromptData =
      (prompt.output.rawContent as FullPromptData | undefined) ?? null;
    if (!prompt.shouldContinue) {
      return { artifacts, stoppedAt: PipelineStage.PROMPT_ASSEMBLY };
    }

    // Stage 5: MODEL_CALL
    const model = await runStage(
      PipelineStage.MODEL_CALL,
      "1.0.0",
      ctx,
      () =>
        executeModelCallStage(
          ctx,
          prompt.artifact.payload,
          promptAssemblyFullPromptData
        )
    );
    artifacts.push(model.artifact);

    // Extract response from model call
    const response = {
      content: model.artifact.payload.responsePreview,
      // Actions and related memories would be extracted in a post-processing stage
    };

    return { artifacts, response };
  } catch (error) {
    // Log error and re-throw
    console.error("[Pipeline] Error during execution:", error);
    throw error;
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Get the stage order for iteration.
 */
export function getStageOrder(): PipelineStage[] {
  return [
    PipelineStage.INGRESS,
    PipelineStage.CONTEXT_CANDIDATES,
    PipelineStage.RANK_AND_BUDGET,
    PipelineStage.PROMPT_ASSEMBLY,
    PipelineStage.MODEL_CALL,
  ];
}

/**
 * Get the next stage after a given stage.
 */
export function getNextStage(stage: PipelineStage): PipelineStage | undefined {
  const order = getStageOrder();
  const currentIndex = order.indexOf(stage);
  if (currentIndex === -1 || currentIndex === order.length - 1) {
    return undefined;
  }
  return order[currentIndex + 1];
}
