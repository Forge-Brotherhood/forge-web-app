/**
 * Run Context Factory
 *
 * Creates and validates run contexts for pipeline execution.
 */

import { nanoid } from "nanoid";
import {
  type RunContext,
  type EntityRef,
  type PipelineStage,
  type ConversationMessage,
  type AIContext,
  PIPELINE_VERSION,
} from "./types";

// =============================================================================
// Context Creation Options
// =============================================================================

export interface CreateRunContextOptions {
  // Required identifiers
  traceId: string;
  userId: string;

  // Request info
  entrypoint: RunContext["entrypoint"];
  message: string;
  entityRefs?: EntityRef[];

  // Debug controls
  mode?: "prod" | "debug";
  stopAtStage?: PipelineStage;
  sideEffects?: "enabled" | "disabled";
  writePolicy?: "allow" | "forbid";

  // App metadata
  appVersion: string;
  platform: string;
  locale?: string;

  // Optional context
  conversationHistory?: ConversationMessage[];
  initialContext?: string;
  aiContext?: AIContext;

  // Optional group context
  groupId?: string;
}

// =============================================================================
// Context Factory
// =============================================================================

/**
 * Create a new run context for pipeline execution.
 */
export function createRunContext(options: CreateRunContextOptions): RunContext {
  const mode = options.mode ?? "prod";
  const isDebug = mode === "debug";

  return {
    // Identifiers
    traceId: options.traceId,
    runId: `run_${nanoid(12)}`,
    requestId: `req_${nanoid(8)}`,

    // User context
    userId: options.userId,
    groupId: options.groupId,

    // Request info
    entrypoint: options.entrypoint,
    message: options.message,
    entityRefs: options.entityRefs ?? [],

    // Debug controls (debug mode defaults to disabled side effects and forbidden writes)
    mode,
    stopAtStage: options.stopAtStage,
    sideEffects: options.sideEffects ?? (isDebug ? "disabled" : "enabled"),
    writePolicy: options.writePolicy ?? (isDebug ? "forbid" : "allow"),

    // App metadata
    appVersion: options.appVersion,
    platform: options.platform,
    locale: options.locale,
    pipelineVersion: PIPELINE_VERSION,

    // Timestamp
    startedAt: new Date(),

    // Conversation context
    conversationHistory: options.conversationHistory,
    initialContext: options.initialContext,
    aiContext: options.aiContext,
  };
}

// =============================================================================
// Context Utilities
// =============================================================================

/**
 * Check if the context is in debug mode.
 */
export function isDebugMode(ctx: RunContext): boolean {
  return ctx.mode === "debug";
}

/**
 * Check if side effects are enabled.
 */
export function areSideEffectsEnabled(ctx: RunContext): boolean {
  return ctx.sideEffects === "enabled" && ctx.writePolicy === "allow";
}

/**
 * Check if we should stop at a given stage.
 */
export function shouldStopAtStage(
  ctx: RunContext,
  stage: PipelineStage
): boolean {
  return ctx.stopAtStage === stage;
}

/**
 * Get the primary verse reference from the context.
 */
export function getPrimaryVerseRef(ctx: RunContext): string | undefined {
  const verseRef = ctx.entityRefs.find((e) => e.type === "verse");
  return verseRef?.reference;
}

/**
 * Get elapsed time since context creation.
 */
export function getElapsedMs(ctx: RunContext): number {
  return Date.now() - ctx.startedAt.getTime();
}
