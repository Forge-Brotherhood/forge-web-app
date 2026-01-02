/**
 * AI Pipeline Core Types
 *
 * Defines the core types for the staged AI pipeline architecture.
 */

// =============================================================================
// Pipeline Stages
// =============================================================================

export enum PipelineStage {
  INGRESS = "INGRESS",
  CONTEXT_CANDIDATES = "CONTEXT_CANDIDATES",
  RANK_AND_BUDGET = "RANK_AND_BUDGET",
  PROMPT_ASSEMBLY = "PROMPT_ASSEMBLY",
  MODEL_CALL = "MODEL_CALL",
  MEMORY_EXTRACTION = "MEMORY_EXTRACTION", // Async, runs after MODEL_CALL
}

// Pipeline version for all artifacts in a run
export const PIPELINE_VERSION = "1.0.0";

// =============================================================================
// Run Context
// =============================================================================

export interface RunContext {
  // Identifiers
  traceId: string;
  runId: string;
  requestId: string;

  // User context
  userId: string;
  groupId?: string;

  // Request info
  entrypoint: "chat_start" | "followup" | "explain" | "prayer_help";
  message: string;
  entityRefs: EntityRef[];

  // Debug controls
  mode: "prod" | "debug";
  stopAtStage?: PipelineStage;
  sideEffects: "enabled" | "disabled";
  writePolicy: "allow" | "forbid";

  // App metadata
  appVersion: string;
  platform: string;
  locale?: string;
  pipelineVersion: string;

  // Timestamp
  startedAt: Date;

  // Conversation context (passed through from route)
  conversationHistory?: ConversationMessage[];
  initialContext?: string;
  aiContext?: AIContext;
}

// =============================================================================
// Entity References
// =============================================================================

export interface EntityRef {
  type: "verse" | "chapter" | "book" | "theme";
  reference: string;
  text?: string;
}

// =============================================================================
// Artifacts
// =============================================================================

export interface StageArtifact<T = unknown> {
  traceId: string;
  runId: string;
  stage: PipelineStage;
  schemaVersion: string;
  pipelineVersion: string;
  createdAt: string;
  durationMs: number;
  summary: string;
  payload: T;
  rawRef?: string; // Vault pointer: "vault://<runId>/<stage>"
  stats: Record<string, number>;
}

// =============================================================================
// Candidates
// =============================================================================

/**
 * Candidate context from any source.
 * IDs are stable and derivable for provenance tracking:
 *   - bible:John3:16
 *   - memory:<uuid>
 *   - group:<gid>:plan:<pid>
 *   - life:<userId>:season
 *   - artifact:<uuid>
 */
export interface CandidateContext {
  id: string;
  source:
    | "bible"
    | "user_memory"
    | "group"
    | "recent_activity"
    | "system"
    | "life_context"
    | "bible_reading_session"
    | "artifact";
  label: string;
  preview: string; // Always redacted
  metadata: Record<string, unknown>;
  features?: {
    scopeScore?: number;
    recencyScore?: number;
    semanticScore?: number;
    freshness?: number;
    temporalScore?: number; // Score based on temporal preference (0-1)
    createdAt?: string; // ISO timestamp for temporal sorting
  };
}

// =============================================================================
// Token Estimation
// =============================================================================

export type TokenEstimateMethod = "heuristic" | "tiktoken" | "model_reported";

// =============================================================================
// Selection Results
// =============================================================================

export interface SelectionResult {
  selected: Array<{
    candidate: CandidateContext;
    finalScore: number;
    tokenEstimate: number;
    tokenEstimateMethod: TokenEstimateMethod;
    reason: string;
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
}

// =============================================================================
// Pipeline Result
// =============================================================================

export interface PipelineResult {
  artifacts: StageArtifact[];
  stoppedAt?: PipelineStage;
  response?: ModelCallResponse;
}

export interface ModelCallResponse {
  content: string;
  actions?: ExtractedAction[];
  relatedMemories?: RelatedMemory[];
  toolCalls?: ToolCall[];
}

// =============================================================================
// Supporting Types
// =============================================================================

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIContext {
  systemPrompt?: string;
  userContext?: Record<string, unknown>;
}

export interface ExtractedAction {
  type: string;
  params: Record<string, unknown>;
  validated: boolean;
  dropReason?: string;
}

export interface RelatedMemory {
  id: string;
  verseReference: string;
  preview: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

// =============================================================================
// Score Breakdown (from memory pipeline)
// =============================================================================

export interface ScoreBreakdown {
  scopeMatch: number;
  recency: number;
  userExplicitness: number;
  interactionDepth: number;
  semanticSimilarity: number;
}
