/**
 * AI Observability Module
 *
 * End-to-end tracing and debugging for AI requests.
 */

// Trace context
export {
  extractTraceContext,
  createFallbackTraceContext,
  serializeTraceContext,
  type TraceContext,
} from "./traceContext";

// Debug envelope
export {
  type AIDebugEnvelope,
  type ContextReport,
  type ConversationCompaction,
  type PromptArtifacts,
  type ModelCallInfo,
  type PostProcessingInfo,
  type ResponseInfo,
  type ReplayData,
  type ExclusionReason,
  estimateTokens,
  hashString,
  truncatePreview,
} from "./debugEnvelope";

// Envelope builder
export { AIDebugEnvelopeBuilder } from "./envelopeBuilder";

// Events
export {
  type AIEvent,
  type AIRequestReceived,
  type AIContextBuilt,
  type AIPromptAssembled,
  type AIModelCalled,
  type AIActionsExtracted,
  type AIResponseDelivered,
  type AIError,
  createRequestReceivedEvent,
  createContextBuiltEvent,
  createPromptAssembledEvent,
  createModelCalledEvent,
  createActionsExtractedEvent,
  createResponseDeliveredEvent,
  createErrorEvent,
} from "./events";

// Logger
export {
  logEvent,
  logEnvelope,
  logError,
  aiLogger,
  eventBatcher,
} from "./logger";
