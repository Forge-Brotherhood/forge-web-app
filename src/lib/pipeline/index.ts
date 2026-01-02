/**
 * AI Pipeline
 *
 * Staged pipeline architecture for AI requests with inspectable artifacts.
 */

// Types
export {
  PipelineStage,
  PIPELINE_VERSION,
  type RunContext,
  type EntityRef,
  type StageArtifact,
  type CandidateContext,
  type TokenEstimateMethod,
  type SelectionResult,
  type PipelineResult,
  type ModelCallResponse,
  type ConversationMessage,
  type AIContext,
  type ExtractedAction,
  type RelatedMemory,
  type ToolCall,
  type ScoreBreakdown,
} from "./types";

// Payloads
export * from "./payloads";

// Unified planning
export * from "./plan/types";

// Context
export {
  createRunContext,
  isDebugMode,
  areSideEffectsEnabled,
  shouldStopAtStage,
  getPrimaryVerseRef,
  getElapsedMs,
  type CreateRunContextOptions,
} from "./context";

// Orchestrator
export {
  runPipeline,
  runStage,
  getStageOrder,
  getNextStage,
  type StageResult,
  type StageOutput,
} from "./orchestrator";

// Persistence
export {
  persistArtifact,
  getArtifacts,
  getArtifact,
  deleteArtifacts,
  cleanupExpiredArtifacts,
} from "./persistence";

// Vault
export {
  storeInVault,
  retrieveFromVault,
  parseVaultRef,
  deleteFromVault,
  cleanupExpiredVault,
} from "./vault";

// Side Effects
export {
  createSideEffects,
  assertWriteAllowed,
  areSideEffectsEnabled as sideEffectsEnabled,
  withSideEffectLogging,
  type SideEffects,
  type ConversationState,
  type AnalyticsEvent,
} from "./sideEffects";

// Stages
export {
  executeIngressStage,
  executeContextCandidatesStage,
  executeRankAndBudgetStage,
  executePromptAssemblyStage,
  executeModelCallStage,
} from "./stages";
