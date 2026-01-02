/**
 * Memory System
 *
 * Structured memory system with closed-world vocabularies,
 * signal-based reinforcement, and async post-response extraction.
 *
 * Key components:
 * - Vocabularies: Canonical enums for intents, memory types, themes, stages
 * - Candidate Extraction: LLM-based extraction constrained to closed vocabularies
 * - Signal Evaluation: Signal → memory promotion after repeated observation
 * - Intent Classification: Fast heuristic-based intent detection
 *
 * The memory extraction runs as an async pipeline stage (MEMORY_EXTRACTION)
 * after MODEL_CALL, extracting candidates and evaluating them for promotion.
 */

// =============================================================================
// Canonical Vocabularies
// =============================================================================

export {
  // Intents
  type Intent,
  INTENTS,
  isValidIntent,
  // Response Modes
  type ResponseMode,
  RESPONSE_MODES,
  isValidResponseMode,
  // Memory Types
  type MemoryType,
  MEMORY_TYPES,
  isValidMemoryType,
  // Signal Types
  type SignalType,
  SIGNAL_TYPES,
  isValidSignalType,
  // Struggle Themes
  type StruggleTheme,
  STRUGGLE_THEMES,
  isValidStruggleTheme,
  // Faith Stages
  type FaithStage,
  FAITH_STAGES,
  isValidFaithStage,
  // Memory Strength
  type MemoryStrength,
  MEMORY_STRENGTHS,
  computeStrength,
  // Memory Sources
  type MemorySource,
  MEMORY_SOURCES,
  // Mappings
  INTENT_RESPONSE_MAP,
  INTENT_CONTEXT_MAP,
  MEMORY_EXTRACTION_ELIGIBLE_INTENTS,
  // Config
  MEMORY_CONFIG,
} from "./vocabularies";

// =============================================================================
// Memory Candidate Extraction
// =============================================================================

export {
  extractCandidates,
  type MemoryCandidate,
  type ExtractionContext,
} from "./candidateExtractor";

// =============================================================================
// Signal Evaluation and Promotion
// =============================================================================

export {
  evaluateAndPromote,
  cleanupExpiredSignals,
  type EvaluationResult,
} from "./signalEvaluator";

// =============================================================================
// Intent Classification
// =============================================================================

export {
  type IntentClassification,
  type IntentResult,
  type IntentFlags,
  type QuestionType,
  type RequiredContext,
  type ScriptureScope,
  type LengthTarget,
  type TaskSpec,
  type RetrievalKnobs,
  classifyIntent,
  classifyIntentAsync,
  classifyIntentRules,
} from "./intentClassifier";

// =============================================================================
// Safety Rules
// =============================================================================

export {
  type SafetyCheckResult,
  containsSensitiveContent,
  sanitizeMemoryForPrompt,
  validatePromptSafety,
  sanitizePhrasings,
  filterSafeMemories,
  isMemoryAllowedByConsent,
  isMemoryAllowedByPolicy,
  logSafetyEvent,
} from "./safetyRules";
