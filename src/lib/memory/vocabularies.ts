/**
 * Canonical Vocabularies - Closed-World Enums
 *
 * All memory types, signals, intents, and related values are constrained
 * to these closed sets. This enables structured extraction and reliable evaluation.
 *
 * These vocabularies are used for:
 * - Classification outputs (intent, response mode)
 * - Memory candidate extraction outputs
 * - Database validation
 */

// =============================================================================
// Intents (7 total)
// =============================================================================

export const INTENTS = [
  "scripture_understanding", // "What does this mean?" / historical context
  "reflection_wrestling",    // "I'm struggling with..."
  "prayer_support",          // "Can you pray for me?"
  "group_guidance",          // Small group leadership/guidance
  "habit_progress",          // "How's my reading plan?"
  "conversation_recall",     // Asking about prior conversations (when, where, what was discussed)
  "conversation_resume",     // Wanting to continue or pick up where they left off
] as const;

export type Intent = (typeof INTENTS)[number];

// =============================================================================
// Response Modes (how the assistant should respond)
// =============================================================================

export const RESPONSE_MODES = [
  "explanation",      // Teaching/explaining scripture
  "coaching",         // Guiding application/growth
  "prayer",           // Crafting prayers
  "action_guidance",  // Suggesting next steps
  "continuity",       // Following up on thread
] as const;

export type ResponseMode = (typeof RESPONSE_MODES)[number];

// =============================================================================
// Memory Types (durable facts about user)
// =============================================================================

export const MEMORY_TYPES = [
  "struggle_theme",      // Recurring struggles
  "faith_stage",         // Where user is on faith journey
  "scripture_affinity",  // Preferred passages/themes
  "tone_preference",     // How they like to be addressed
  "group_role",          // Leader, participant, etc.
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

// =============================================================================
// Signal Types (short-lived reinforcement counters)
// =============================================================================

export const SIGNAL_TYPES = [
  "struggle_theme_signal",
  "faith_stage_signal",
  "tone_preference_signal",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

// =============================================================================
// Struggle Themes (StruggleThemeKey) - v1
// =============================================================================

export const STRUGGLE_THEMES = [
  "fear_of_failure",
  "work_anxiety",
  "loneliness",
  "identity_doubt",
  "discipline",
  "leadership_pressure",
  "shame_guilt",
  "relationship_conflict",
  "grief_loss",
  "anger_bitterness",
] as const;

export type StruggleTheme = (typeof STRUGGLE_THEMES)[number];

// =============================================================================
// Faith Stages (FaithStageKey) - v1
// =============================================================================

export const FAITH_STAGES = [
  "seeking",     // Exploring faith
  "rebuilding",  // Deconstructing/reconstructing
  "grounded",    // Established faith
  "leading",     // Discipling others
] as const;

export type FaithStage = (typeof FAITH_STAGES)[number];

// =============================================================================
// Memory Strength Levels
// =============================================================================

export const MEMORY_STRENGTHS = ["light", "moderate", "strong"] as const;

export type MemoryStrength = (typeof MEMORY_STRENGTHS)[number];

export function computeStrength(occurrences: number): MemoryStrength {
  if (occurrences >= 7) return "strong";
  if (occurrences >= 4) return "moderate";
  return "light";
}

// =============================================================================
// Memory Sources
// =============================================================================

export const MEMORY_SOURCES = [
  "signal_promotion",  // Promoted from signal after threshold
  "user_explicit",     // User explicitly requested to remember
  "onboarding",        // Set during onboarding flow
] as const;

export type MemorySource = (typeof MEMORY_SOURCES)[number];

// =============================================================================
// Intent → Response Mode Mapping
// =============================================================================

export const INTENT_RESPONSE_MAP: Record<Intent, ResponseMode> = {
  scripture_understanding: "explanation",
  reflection_wrestling: "coaching",
  prayer_support: "prayer",
  group_guidance: "action_guidance",
  habit_progress: "action_guidance",
  conversation_recall: "continuity",
  conversation_resume: "continuity",
};

// =============================================================================
// Intents Eligible for Memory Extraction
// =============================================================================

export const MEMORY_EXTRACTION_ELIGIBLE_INTENTS: Intent[] = [
  "reflection_wrestling",
];

// =============================================================================
// Intent → Context Loaders Mapping
// =============================================================================

export const INTENT_CONTEXT_MAP: Record<Intent, string[]> = {
  scripture_understanding: [
    "conversationSummary",
    "readingPlan",
    "recentHighlights",
    "priorExplanations",
  ],
  reflection_wrestling: [
    "conversationSummary",
    "durableMemories",
    "groupContext",
    "tonePreference",
  ],
  prayer_support: [
    "conversationSummary",
    "minimalUserContext",
  ],
  group_guidance: [
    "conversationSummary",
    "groupContext",
    "groupNorms",
    "recentGroupPrayers",
  ],
  habit_progress: [
    "readingPlanProgress",
    "conversationSummary",
  ],
  conversation_recall: [
    "conversationSummary",
    "priorExplanations",
  ],
  conversation_resume: [
    "conversationSummary",
  ],
};

// =============================================================================
// Configuration Constants
// =============================================================================

export const MEMORY_CONFIG = {
  /** Days before a signal expires without reinforcement */
  SIGNAL_TTL_DAYS: 7,

  /** Number of sightings required to promote signal to memory */
  PROMOTION_THRESHOLD: 2,

  /** Minimum confidence score for candidate extraction */
  MIN_EXTRACTION_CONFIDENCE: 0.7,

  /** Maximum candidates per conversation turn */
  MAX_CANDIDATES_PER_TURN: 2,

  /** Minimum strength for memory to be included in context */
  MIN_STRENGTH_FOR_CONTEXT: 0.3,

  /** Maximum memories to load for context */
  MAX_MEMORIES_FOR_CONTEXT: 10,

  /** Maximum recent messages to keep in conversation state */
  MAX_RECENT_MESSAGES: 6,
} as const;

// =============================================================================
// Type Guards
// =============================================================================

export function isValidIntent(value: string): value is Intent {
  return INTENTS.includes(value as Intent);
}

export function isValidStruggleTheme(value: string): value is StruggleTheme {
  return STRUGGLE_THEMES.includes(value as StruggleTheme);
}

export function isValidFaithStage(value: string): value is FaithStage {
  return FAITH_STAGES.includes(value as FaithStage);
}

export function isValidMemoryType(value: string): value is MemoryType {
  return MEMORY_TYPES.includes(value as MemoryType);
}

export function isValidSignalType(value: string): value is SignalType {
  return SIGNAL_TYPES.includes(value as SignalType);
}

export function isValidResponseMode(value: string): value is ResponseMode {
  return RESPONSE_MODES.includes(value as ResponseMode);
}
