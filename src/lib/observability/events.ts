/**
 * Structured AI Events
 *
 * Timeline-friendly events for reconstructing request flow,
 * identifying latency hotspots, and failure analysis.
 */

// =============================================================================
// Event Types
// =============================================================================

export type AIEvent =
  | AIRequestReceived
  | AIContextBuilt
  | AIPromptAssembled
  | AIModelCalled
  | AIActionsExtracted
  | AIResponseDelivered
  | AIError;

interface BaseEvent {
  traceId: string;
  requestId: string;
  timestamp: string;
  durationMs?: number;
}

export interface AIRequestReceived extends BaseEvent {
  type: "ai.request.received";
  entryPoint: string;
  userId: string;
  platform: string;
}

export interface AIContextBuilt extends BaseEvent {
  type: "ai.context.built";
  memoriesQueried: number;
  memoriesIncluded: number;
  intent: string;
  usageMode: string;
}

export interface AIPromptAssembled extends BaseEvent {
  type: "ai.prompt.assembled";
  tokenCount: number;
  messagesCount: number;
  toolsEnabled: string[];
}

export interface AIModelCalled extends BaseEvent {
  type: "ai.model.called";
  model: string;
  latencyMs: number;
  inputTokens: number;
  inputTokenDetails?: {
    cachedTokens: number;
    audioTokens: number;
  };
  outputTokens: number;
  outputTokenDetails?: {
    reasoningTokens: number;
    audioTokens: number;
    acceptedPredictionTokens: number;
    rejectedPredictionTokens: number;
  };
  finishReason: string;
  toolCallCount: number;
}

export interface AIActionsExtracted extends BaseEvent {
  type: "ai.actions.extracted";
  totalExtracted: number;
  validated: number;
  dropped: number;
  actionTypes: string[];
}

export interface AIResponseDelivered extends BaseEvent {
  type: "ai.response.delivered";
  contentLength: number;
  actionCount: number;
  responseType: string;
  totalLatencyMs: number;
}

export interface AIError extends BaseEvent {
  type: "ai.error";
  errorType: string;
  errorMessage: string;
  stage: string;
  recoverable: boolean;
}

// =============================================================================
// Event Factory Functions
// =============================================================================

/**
 * Create a request received event
 */
export function createRequestReceivedEvent(
  traceId: string,
  requestId: string,
  entryPoint: string,
  userId: string,
  platform: string
): AIRequestReceived {
  return {
    type: "ai.request.received",
    traceId,
    requestId,
    timestamp: new Date().toISOString(),
    entryPoint,
    userId,
    platform,
  };
}

/**
 * Create a context built event
 */
export function createContextBuiltEvent(
  traceId: string,
  requestId: string,
  memoriesQueried: number,
  memoriesIncluded: number,
  intent: string,
  usageMode: string,
  durationMs: number
): AIContextBuilt {
  return {
    type: "ai.context.built",
    traceId,
    requestId,
    timestamp: new Date().toISOString(),
    durationMs,
    memoriesQueried,
    memoriesIncluded,
    intent,
    usageMode,
  };
}

/**
 * Create a prompt assembled event
 */
export function createPromptAssembledEvent(
  traceId: string,
  requestId: string,
  tokenCount: number,
  messagesCount: number,
  toolsEnabled: string[],
  durationMs: number
): AIPromptAssembled {
  return {
    type: "ai.prompt.assembled",
    traceId,
    requestId,
    timestamp: new Date().toISOString(),
    durationMs,
    tokenCount,
    messagesCount,
    toolsEnabled,
  };
}

/**
 * Create a model called event
 */
export function createModelCalledEvent(
  traceId: string,
  requestId: string,
  model: string,
  latencyMs: number,
  inputTokens: number,
  outputTokens: number,
  finishReason: string,
  toolCallCount: number,
  tokenDetails?: {
    inputTokenDetails?: AIModelCalled["inputTokenDetails"];
    outputTokenDetails?: AIModelCalled["outputTokenDetails"];
  }
): AIModelCalled {
  return {
    type: "ai.model.called",
    traceId,
    requestId,
    timestamp: new Date().toISOString(),
    durationMs: latencyMs,
    model,
    latencyMs,
    inputTokens,
    inputTokenDetails: tokenDetails?.inputTokenDetails,
    outputTokens,
    outputTokenDetails: tokenDetails?.outputTokenDetails,
    finishReason,
    toolCallCount,
  };
}

/**
 * Create an actions extracted event
 */
export function createActionsExtractedEvent(
  traceId: string,
  requestId: string,
  totalExtracted: number,
  validated: number,
  dropped: number,
  actionTypes: string[],
  durationMs: number
): AIActionsExtracted {
  return {
    type: "ai.actions.extracted",
    traceId,
    requestId,
    timestamp: new Date().toISOString(),
    durationMs,
    totalExtracted,
    validated,
    dropped,
    actionTypes,
  };
}

/**
 * Create a response delivered event
 */
export function createResponseDeliveredEvent(
  traceId: string,
  requestId: string,
  contentLength: number,
  actionCount: number,
  responseType: string,
  totalLatencyMs: number
): AIResponseDelivered {
  return {
    type: "ai.response.delivered",
    traceId,
    requestId,
    timestamp: new Date().toISOString(),
    contentLength,
    actionCount,
    responseType,
    totalLatencyMs,
  };
}

/**
 * Create an error event
 */
export function createErrorEvent(
  traceId: string,
  requestId: string,
  errorType: string,
  errorMessage: string,
  stage: string,
  recoverable: boolean = false
): AIError {
  return {
    type: "ai.error",
    traceId,
    requestId,
    timestamp: new Date().toISOString(),
    errorType,
    errorMessage,
    stage,
    recoverable,
  };
}
