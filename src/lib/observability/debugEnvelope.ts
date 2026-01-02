/**
 * AI Debug Envelope Schema
 *
 * Comprehensive structured record for debugging AI responses.
 * Contains everything needed to understand and replay a response.
 */

// =============================================================================
// Main Envelope Type
// =============================================================================

export interface AIDebugEnvelope {
  // === Identifiers ===
  /** Client-generated trace ID for this AI interaction */
  traceId: string;
  /** Server-generated request ID */
  requestId: string;
  /** Client session ID */
  sessionId: string;
  /** Authenticated user ID */
  userId: string;

  // === Request Metadata ===
  /** When the request was received */
  timestamp: string;
  /** Where the AI interaction was initiated */
  entryPoint: string;
  /** Client app version */
  appVersion: string;
  /** Platform (ios, android, web) */
  platform: string;

  // === Intent & Inputs ===
  /** The user's message/question */
  userMessage: string;
  /** Bible verse reference being discussed */
  verseReference: string;
  /** Verse text if provided */
  verseText?: string;
  /** Selected content context */
  selectedContent?: {
    type: "verse" | "chapter";
    reference: string;
    verseNumbers?: number[];
  };

  // === Context Assembly (Critical for debugging) ===
  contextReport: ContextReport;

  // === Prompt Artifacts ===
  promptArtifacts: PromptArtifacts;

  // === Model Call ===
  modelCall: ModelCallInfo;

  // === Post-Processing ===
  postProcessing: PostProcessingInfo;

  // === Final Response ===
  response: ResponseInfo;

  // === For Replay ===
  replayData: ReplayData;
}

// =============================================================================
// Sub-Types
// =============================================================================

export interface ScoreBreakdown {
  scopeMatch: number;
  recency: number;
  userExplicitness: number;
  interactionDepth: number;
  semanticSimilarity: number;
}

export interface ConversationCompaction {
  /** Whether compaction was applied */
  wasCompacted: boolean;
  /** Original message count before compaction */
  originalCount: number;
  /** Final message count after compaction */
  finalCount: number;
  /** Number of messages that were summarized */
  summarizedCount: number;
  /** Estimated tokens before compaction */
  tokensBefore: number;
  /** Estimated tokens after compaction */
  tokensAfter: number;
}

export interface ContextReport {
  /** Total memories queried from database */
  memoriesQueried: number;
  /** Memories included in final context */
  memoriesIncluded: number;
  /** Details of memories that were included (for debugging) */
  memoriesIncludedDetails?: Array<{
    id: string;
    verseReference: string;
    preview: string;
    ageLabel?: string;
    matchedScope?: string;
    usefulnessScore?: number;
    scoreBreakdown?: ScoreBreakdown;
  }>;
  /** The actual system prompt addition injected for memories */
  memoryPromptAddition?: string;
  /** Memories excluded with reasons */
  memoriesExcluded: Array<{
    id: string;
    verseReference?: string;
    reason: ExclusionReason;
    details?: string;
  }>;
  /** Intent classification result */
  intentClassification: {
    intent: string;
    confidence: number;
    signals: string[];
  };
  /** Memory usage mode selected */
  usageMode: "silent" | "soft_grounding" | "permissioned_recall" | "explicit_recall";
  /** Whether life context was used */
  lifeContextUsed: boolean;
  /** Conversation compaction info (if applied) */
  conversationCompaction?: ConversationCompaction;
  /** Token counts by segment */
  tokenCounts: {
    systemPrompt: number;
    userContext: number;
    conversationHistory: number;
    total: number;
  };
}

export type ExclusionReason =
  | "safety_filter"
  | "consent_denied"
  | "scope_mismatch"
  | "low_relevance"
  | "budget_exceeded"
  | "ttl_expired";

export interface PromptArtifacts {
  /** SHA256 hash of system prompt (for deduplication) */
  systemPromptHash: string;
  /** Number of messages in the conversation */
  messagesCount: number;
  /** Tools/functions enabled for this call */
  toolsEnabled: string[];
}

export interface ModelCallInfo {
  /** Model identifier */
  model: string;
  /** Temperature parameter */
  temperature: number;
  /** Max tokens parameter */
  maxTokens: number;
  /** Request latency in milliseconds */
  latencyMs: number;
  /** Input tokens used */
  inputTokens: number;
  /** Output tokens generated */
  outputTokens: number;
  /** Why the model stopped */
  finishReason: string;
  /** Tool calls made by the model */
  toolCallsMade: string[];
}

export interface PostProcessingInfo {
  /** Actions extracted from response */
  actionsExtracted: Array<{
    type: string;
    params: Record<string, unknown>;
    validated: boolean;
    dropReason?: string;
  }>;
  /** Whether a follow-up call was needed */
  followUpCallMade: boolean;
}

export interface ResponseInfo {
  /** Length of response content */
  contentLength: number;
  /** First 200 characters of response */
  contentPreview: string;
  /** Number of actions in response */
  actionCount: number;
  /** Type of response */
  responseType: "greeting" | "explanation" | "followup";
}

export interface ReplayData {
  /** Full messages array sent to model (includes system prompt as first message) */
  fullMessages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  /** Tool schemas used */
  toolSchemas: unknown[];
  /** Model parameters for replay */
  modelParams: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Estimate token count for a string (rough approximation)
 * Uses ~4 characters per token as a rough estimate
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Generate SHA256 hash of a string
 */
export async function hashString(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncatePreview(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}
