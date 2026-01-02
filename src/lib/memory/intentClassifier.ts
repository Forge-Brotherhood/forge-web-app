/**
 * Intent Classification Service
 *
 * Two-tier classification system:
 * 1. Rules-first: Fast heuristics return confident results or null
 * 2. LLM fallback: gpt-5-nano classifies when rules fail
 *
 * Key concepts:
 * - IntentResult: Routing layer (intent, responseMode, confidence, source, flags)
 * - TaskSpec: Retrieval layer (what context to load, how to respond)
 */

import {
  type Intent,
  type ResponseMode as VocabResponseMode,
  INTENTS,
  RESPONSE_MODES,
  INTENT_RESPONSE_MAP,
  isValidIntent,
  isValidResponseMode,
} from "./vocabularies";

// =============================================================================
// Intent Result Types (routing layer)
// =============================================================================

export interface IntentFlags {
  selfDisclosure?: boolean; // User reveals personal struggle/trait
  situational?: boolean; // Time-bound fact (travel/event)
  hasVerseRef?: boolean; // Bible verse reference present
  temporal?: TemporalModifier; // Temporal query modifier (oldest, newest, last week, etc.)
}

export interface IntentResult {
  intent: Intent;
  responseMode: VocabResponseMode;
  confidence: number; // 0-1
  signals: string[]; // Why this classification was chosen
  source: "rules" | "llm";
  flags?: IntentFlags;
}

// =============================================================================
// Task Specification Types (retrieval layer)
// =============================================================================

export type QuestionType =
  | "meaning" // What does X mean?
  | "context" // Who, when, audience, background
  | "application" // How do I apply this?
  | "word_study" // Greek/Hebrew, definitions
  | "cross_reference" // Related passages
  | "objection" // Addressing doubt/challenge
  | "comfort" // Emotional/pastoral need
  | "other"; // Fallback

export type RequiredContext =
  | "passage_text" // The verse(s) being discussed
  | "surrounding_context" // Paragraph/chapter around verse
  | "conversation_context" // Prior turns in this conversation
  | "user_memory" // User's past study/reflections
  | "group_context" // Small group/circle context
  | "definitions" // Word definitions, original language
  | "cross_refs" // Cross-references
  | "prior_notes" // User's notes on this passage
  | "reading_plan_state"; // Current position in reading plan

export type ResponseMode = "explain" | "pastoral" | "coach" | "study";
export type ScriptureScope = "verse" | "paragraph" | "section";
export type LengthTarget = "short" | "medium";

// Temporal query support
export type TemporalDirection = "oldest" | "newest";
export type TemporalRange =
  | "last_day"
  | "last_week"
  | "last_month"
  | "last_3_months"
  | "last_year"
  | "this_year"
  | "all_time";

export interface TemporalModifier {
  direction?: TemporalDirection;
  range?: TemporalRange;
}

export interface RetrievalKnobs {
  scriptureScope: ScriptureScope;
  maxCrossRefs: 0 | 1 | 2;
  includeUserMemory: boolean;
  includePriorNotes: boolean;
  memoryRecency: "recent" | "all";
  includeArtifacts: boolean;
  temporalModifier?: TemporalModifier;
}

export interface TaskSpec {
  questionType: QuestionType;
  requiredContext: RequiredContext[];
  responseMode: ResponseMode;
  scriptureScope: ScriptureScope;
  lengthTarget: LengthTarget;
  needsClarifyingQuestion: boolean;
  clarifyingQuestion?: string;
  retrievalKnobs: RetrievalKnobs;
}

/**
 * Combined classification result for pipeline use
 */
export interface IntentClassification {
  intent: Intent;
  confidence: number;
  signals: string[];
  source: "rules" | "llm";
  flags?: IntentFlags;
  taskSpec: TaskSpec;
}

interface ClassificationContext {
  verseReference?: string;
  conversationHistory: { role: string; content: string }[];
  isFirstMessage: boolean;
}

// =============================================================================
// Declarative Lookup Tables
// =============================================================================

/**
 * Base required context for each intent.
 * Note: scripture_understanding uses a minimal base; question type adds specifics.
 */
const INTENT_REQUIRED_CONTEXT: Record<Intent, RequiredContext[]> = {
  scripture_understanding: ["passage_text", "surrounding_context"],
  reflection_wrestling: ["passage_text", "surrounding_context", "conversation_context", "user_memory"],
  prayer_support: ["conversation_context"],
  group_guidance: ["conversation_context", "group_context"],
  habit_progress: ["reading_plan_state", "conversation_context"],
  conversation_recall: ["conversation_context"],
  conversation_resume: ["conversation_context"],
};

/**
 * Additional context requirements based on question type.
 * These are merged with the intent's base context.
 */
const QUESTION_TYPE_CONTEXT_ADDITIONS: Partial<Record<QuestionType, RequiredContext[]>> = {
  meaning: ["conversation_context"],
  context: ["conversation_context"],
  word_study: ["definitions"],
  cross_reference: ["cross_refs"],
};

/**
 * Default retrieval knobs configuration.
 */
const DEFAULT_RETRIEVAL_KNOBS: RetrievalKnobs = {
  scriptureScope: "verse",
  maxCrossRefs: 0,
  includeUserMemory: false,
  includePriorNotes: false,
  memoryRecency: "all",
  includeArtifacts: false,
};

/**
 * Intent-based overrides for retrieval knobs.
 */
const INTENT_RETRIEVAL_OVERRIDES: Partial<Record<Intent, Partial<RetrievalKnobs>>> = {
  reflection_wrestling: { includeUserMemory: true, includeArtifacts: true },
  prayer_support: { memoryRecency: "recent", includeArtifacts: true },
  conversation_recall: { includeArtifacts: true },
};

/**
 * Question type-based overrides for retrieval knobs.
 */
const QUESTION_TYPE_RETRIEVAL_OVERRIDES: Partial<Record<QuestionType, Partial<RetrievalKnobs>>> = {
  context: { scriptureScope: "section" },
  cross_reference: { maxCrossRefs: 2, scriptureScope: "paragraph" },
  application: { includeUserMemory: true, includeArtifacts: true },
  comfort: { includeUserMemory: true, includeArtifacts: true },
};

/**
 * Question type to response mode mapping.
 * Default: "explain"
 */
const QUESTION_TYPE_RESPONSE_MODE: Partial<Record<QuestionType, ResponseMode>> = {
  comfort: "pastoral",
  application: "coach",
  word_study: "study",
  cross_reference: "study",
};

/**
 * Question type to scripture scope mapping.
 * Default: "verse"
 */
const QUESTION_TYPE_SCRIPTURE_SCOPE: Partial<Record<QuestionType, ScriptureScope>> = {
  context: "section",
  cross_reference: "paragraph",
};

// =============================================================================
// Intent Patterns (routing heuristics)
// =============================================================================

const INTENT_PATTERNS: Record<Intent, RegExp[]> = {
  scripture_understanding: [
    // Meaning questions
    /what does (this|that|it) mean/i,
    /explain (this|that|the)/i,
    /help me understand/i,
    /what is (the meaning|paul|jesus|god) (saying|teaching)/i,
    /can you (explain|clarify|break down)/i,
    /how (should|do) (i|we) interpret/i,
    // Historical context (merged in)
    /who (was|were) (this|it|the letter|paul|the author) (written|speaking|writing) to/i,
    /who (is|was|were) the (audience|recipients|readers)/i,
    /what (was|were) (happening|going on|the circumstances)/i,
    /what('s| is) the (historic(al)? |)?(context|background|setting)/i,
    /when was (this|it) written/i,
    /where was (this|it) written/i,
    /why did (paul|jesus|the author|he|they) write/i,
    /what (time|period|era) was this/i,
    /tell me (about |)the (history|background|context)/i,
    /who wrote (this|it)/i,
    /(historic(al)?|cultural) (background|context|setting)/i,
  ],

  reflection_wrestling: [
    /i('m| am) (struggling|wrestling|having trouble)/i,
    /this is (hard|difficult|challenging) for me/i,
    /i don't (understand|get) (why|how)/i,
    /how (do|can) i (apply|live out|practice)/i,
    /i (feel|felt) (like|that)/i,
    /this (makes|made) me (think|feel|wonder)/i,
    /what if i/i,
    /i('ve| have) been (thinking|wondering|questioning)/i,
    // Self-disclosure patterns (e.g., "I have an anger issue", "I have anger issues")
    /i('ve| have|'ve got| got) (a |an )?[a-z]+ (issue|issues|problem|problems|struggle|struggles|difficulty|difficulties)/i,
    /i deal with/i,
    /i('m| am) (dealing|coping|living) with/i,
    /i have .{1,20} issues?\b/i,
  ],

  prayer_support: [
    /pray (for|with) me/i,
    /can you (pray|write a prayer)/i,
    /i need (prayer|a prayer)/i,
    /help me pray/i,
    /prayer for (my|this|the)/i,
    /write (me )?a prayer/i,
  ],

  group_guidance: [
    /my (small )?group/i,
    /our (bible )?study group/i,
    /(lead|leading) (a |my |our )?(group|discussion|study)/i,
    /group (discussion|study|meeting)/i,
    /small group (leader|leadership)/i,
    /discussion (question|guide|point)/i,
    /how (can|should) (i|we) discuss this (with|in) (my|our|the) group/i,
    /group (member|participant)/i,
    /(facilitate|facilitating) (a |the )?discussion/i,
  ],

  habit_progress: [
    /how('s| is) my (reading|bible|plan)/i,
    /my (reading|prayer) (streak|progress)/i,
    /am i (on track|behind|ahead)/i,
    /what('s| is) (next|my next)/i,
    /show (me )?my (progress|stats|history)/i,
  ],

  conversation_recall: [
    /when did we (talk|discuss|chat) about/i,
    /have we (discussed|talked about|covered)/i,
    /last time we (discussed|talked|chatted)/i,
    /did we (ever|already) (discuss|talk|cover)/i,
    /remember when we/i,
    /what did (you|we) say about/i,
  ],
  conversation_resume: [
    /^(and|but|so|also|what about)/i,
    /you (said|mentioned|were saying)/i,
    /going back to/i,
    /following up on/i,
    /^(yes|yeah|ok|okay|right|sure),? (and|but|so)/i,
    /more (about|on) (that|this)/i,
    /tell me more/i,
    /continue (from|with|where)/i,
    /pick up where/i,
    /back to what you were saying/i,
  ],
};

// Signals that indicate continuation even without explicit keywords
const CONTINUATION_SIGNALS = {
  shortMessage: 50, // Messages under 50 chars in mid-conversation are likely continuations
  startsWithPronoun: /^(it|this|that|they|he|she|the)\b/i,
  questionOnly: /^[^.!]+\?$/, // Single question without context
};

// Self-disclosure patterns for flags
const SELF_DISCLOSURE_PATTERNS = [
  /i('m| am) (struggling|wrestling|having trouble)/i,
  /i (have|'ve got|got) (a|an)/i,
  /i (feel|felt)/i,
  /i (deal|dealing|coping|living) with/i,
  /i (always|never|keep)/i,
  /my (problem|issue|struggle)/i,
];

// Situational patterns for flags
const SITUATIONAL_PATTERNS = [
  /\b(this|next|last) (week|weekend|month|year)\b/i,
  /\b(today|tomorrow|yesterday)\b/i,
  /\bi('m| am) (going|traveling|visiting|leaving)\b/i,
  /\b(trip|vacation|travel|conference|event)\b/i,
];

// Verse reference pattern
const VERSE_REF_PATTERN = /\b([1-3]?\s?[a-z]+)\s+\d+:\d+\b/i;

// Temporal query patterns
const OLDEST_PATTERNS = [
  /\b(oldest|earliest|first)\b/i,
  /\bwhen did (i|we) first\b/i,
];

const NEWEST_PATTERNS = [
  /\b(newest|latest|most recent)\b/i,
  /\brecently\b/i,
];

// Note: "last" is handled specially - it means "newest" except in "last week/month/year"
const LAST_AS_NEWEST_PATTERN = /\b(the )?last (time|conversation|discussion|thing)\b/i;

const RANGE_PATTERNS: Array<{ pattern: RegExp; range: TemporalRange }> = [
  { pattern: /\b(today|yesterday)\b/i, range: "last_day" },
  { pattern: /\blast week\b/i, range: "last_week" },
  { pattern: /\b(this|last) month\b/i, range: "last_month" },
  { pattern: /\blast (3|three) months\b/i, range: "last_3_months" },
  { pattern: /\blast year\b/i, range: "last_year" },
  { pattern: /\bthis year\b/i, range: "this_year" },
];

function detectTemporalModifier(message: string): TemporalModifier | undefined {
  let direction: TemporalDirection | undefined;

  if (OLDEST_PATTERNS.some((p) => p.test(message))) {
    direction = "oldest";
  } else if (NEWEST_PATTERNS.some((p) => p.test(message))) {
    direction = "newest";
  } else if (LAST_AS_NEWEST_PATTERN.test(message)) {
    direction = "newest";
  }

  let range: TemporalRange | undefined;
  for (const { pattern, range: r } of RANGE_PATTERNS) {
    if (pattern.test(message)) {
      range = r;
      break;
    }
  }

  if (!direction && !range) {
    return undefined;
  }

  return { direction, range };
}

export function computeDateBounds(range: TemporalRange): { after?: Date; before?: Date } {
  const now = new Date();
  const ms = (days: number) => days * 24 * 60 * 60 * 1000;

  switch (range) {
    case "last_day":
      return { after: new Date(now.getTime() - ms(1)) };
    case "last_week":
      return { after: new Date(now.getTime() - ms(7)) };
    case "last_month":
      return { after: new Date(now.getTime() - ms(30)) };
    case "last_3_months":
      return { after: new Date(now.getTime() - ms(90)) };
    case "last_year":
      return { after: new Date(now.getTime() - ms(365)) };
    case "this_year":
      return { after: new Date(now.getFullYear(), 0, 1) };
    case "all_time":
    default:
      return {};
  }
}

// =============================================================================
// Question Type Patterns (heuristic, not LLM)
// =============================================================================

const QUESTION_TYPE_PATTERNS: Partial<Record<QuestionType, RegExp[]>> = {
  context: [
    /context|background|who (is|was) (speaking|writing|the audience)/i,
    /when (was|did)|what time|historical/i,
    /why (was|did) (this|it|he|they)/i,
    /who (wrote|is|are|were)/i,
  ],
  application: [
    /apply|live out|practice|what should i do/i,
    /how (do|can|should) (i|we) (respond|act|change)/i,
    /what does this mean for (my|our)/i,
  ],
  word_study: [
    /greek|hebrew|original (language|word|text)/i,
    /(what|how) does? .* (mean|translate)/i,
    /define|definition|word (study|meaning)/i,
  ],
  cross_reference: [
    /where else|other (verses|passages)|cross.?reference/i,
    /related (passages|verses|scripture)/i,
    /does (the bible|scripture) (say|mention) .* elsewhere/i,
  ],
  objection: [
    /but (what about|how can|doesn't)/i,
    /seems? (unfair|wrong|contradictory)/i,
    /how (can|do) (you|we) (reconcile|explain)/i,
    /i (struggle|have trouble) (believing|accepting)/i,
  ],
  comfort: [
    /struggling|anxious|worried|afraid|scared|guilty/i,
    /hard (time|season|day)|going through/i,
    /i (feel|am feeling) (lost|alone|hopeless)/i,
    /comfort|encourage|hope/i,
  ],
  meaning: [
    /what does (this|that|it) mean/i,
    /explain|help me understand|clarify/i,
    /what (is|are) .* (saying|teaching)/i,
  ],
};

// =============================================================================
// LLM Classification Prompt
// =============================================================================

const INTENT_CLASSIFICATION_PROMPT = `Classify the user's message into exactly ONE intent and ONE response mode.

Allowed intents:
- scripture_understanding: Questions about what scripture means, historical context, interpretation
- reflection_wrestling: Personal struggles, applying faith, emotional/spiritual challenges
- prayer_support: Requests for prayer or help praying
- group_guidance: Small group leadership, facilitating discussions
- habit_progress: Reading plan progress, streaks, stats
- conversation_recall: Asking about when/where something was previously discussed
- conversation_resume: Wanting to continue or pick up a prior discussion

Allowed response modes:
- explanation: Teaching/explaining scripture or concepts
- coaching: Guiding personal application and growth
- prayer: Crafting or offering prayers
- action_guidance: Suggesting practical next steps
- continuity: Following up on existing conversation thread

Classification guidance:
- If the user is asking about when or where something was previously discussed, classify as conversation_recall.
- If the user is asking to continue or pick up a prior discussion, classify as conversation_resume.

Also detect these flags:
- selfDisclosure: true if the user reveals something personal about their own ongoing struggle, trait, or faith journey (e.g., "I have an anger issue", "I'm struggling with...")
- situational: true if the user shares a time-bound fact like travel, events, or schedule (e.g., "I'm going to Prague this weekend")
- hasVerseRef: true if there's a Bible verse reference (e.g., "Romans 8:1", "John 3:16")

Return JSON only with this exact schema:
{
  "intent": "<one of the allowed intents>",
  "responseMode": "<one of the allowed response modes>",
  "confidence": <number between 0 and 1>,
  "signals": ["<reason 1>", "<reason 2>"],
  "flags": {
    "selfDisclosure": <boolean>,
    "situational": <boolean>,
    "hasVerseRef": <boolean>
  }
}

User message:`;

// =============================================================================
// Helper Functions
// =============================================================================

function inferQuestionType(message: string): QuestionType {
  for (const [type, patterns] of Object.entries(QUESTION_TYPE_PATTERNS)) {
    if (!patterns) continue;
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return type as QuestionType;
      }
    }
  }
  return "meaning"; // Default
}

function deriveRequiredContext(
  intent: Intent,
  questionType: QuestionType,
  hasVerseReference: boolean
): RequiredContext[] {
  const base = [...INTENT_REQUIRED_CONTEXT[intent]];
  const additions = QUESTION_TYPE_CONTEXT_ADDITIONS[questionType] || [];

  if (hasVerseReference && !base.includes("passage_text")) {
    base.push("passage_text");
  }

  return [...new Set([...base, ...additions])];
}

function detectResponseMode(
  questionType: QuestionType,
  message: string
): ResponseMode {
  if (/struggling|anxious|worried|afraid/i.test(message)) return "pastoral";
  return QUESTION_TYPE_RESPONSE_MODE[questionType] ?? "explain";
}

function detectScriptureScope(questionType: QuestionType): ScriptureScope {
  return QUESTION_TYPE_SCRIPTURE_SCOPE[questionType] ?? "verse";
}

function deriveRetrievalKnobs(
  intent: Intent,
  questionType: QuestionType,
  hasVerseRef: boolean = false,
  temporal?: TemporalModifier
): RetrievalKnobs {
  const knobs: RetrievalKnobs = {
    ...DEFAULT_RETRIEVAL_KNOBS,
    ...INTENT_RETRIEVAL_OVERRIDES[intent],
    ...QUESTION_TYPE_RETRIEVAL_OVERRIDES[questionType],
  };

  // Enable artifacts for conversation_resume when verse reference is present
  if (intent === "conversation_resume" && hasVerseRef) {
    knobs.includeArtifacts = true;
  }

  // Pass through temporal modifier for date filtering and re-ranking
  if (temporal) {
    knobs.temporalModifier = temporal;
  }

  console.log("[IntentClassifier] deriveRetrievalKnobs:", { intent, questionType, hasVerseRef, temporal, includeArtifacts: knobs.includeArtifacts });
  return knobs;
}

function buildTaskSpec(
  intent: Intent,
  questionType: QuestionType,
  message: string,
  context: ClassificationContext,
  needsClarification: boolean = false
): TaskSpec {
  // Use same detection logic as detectFlags
  const hasVerseRef = VERSE_REF_PATTERN.test(message) || !!context.verseReference;
  const temporal = detectTemporalModifier(message);

  let clarifyingQuestion: string | undefined;
  if (needsClarification && intent === "scripture_understanding") {
    clarifyingQuestion = "Which verse or passage are you referring to?";
  }

  return {
    questionType,
    requiredContext: deriveRequiredContext(intent, questionType, hasVerseRef),
    responseMode: detectResponseMode(questionType, message),
    scriptureScope: detectScriptureScope(questionType),
    lengthTarget: questionType === "word_study" ? "medium" : "short",
    needsClarifyingQuestion: needsClarification,
    clarifyingQuestion,
    retrievalKnobs: deriveRetrievalKnobs(intent, questionType, hasVerseRef, temporal),
  };
}

function detectFlags(message: string, context: ClassificationContext): IntentFlags {
  const hasVerseRef = VERSE_REF_PATTERN.test(message) || !!context.verseReference;
  const selfDisclosure = SELF_DISCLOSURE_PATTERNS.some((p) => p.test(message));
  const situational = SITUATIONAL_PATTERNS.some((p) => p.test(message));
  const temporal = detectTemporalModifier(message);

  return {
    hasVerseRef,
    selfDisclosure,
    situational,
    temporal,
  };
}

// =============================================================================
// Validation & Clamping
// =============================================================================

interface RawLLMResponse {
  intent?: string;
  responseMode?: string;
  confidence?: number;
  signals?: string[];
  flags?: {
    selfDisclosure?: boolean;
    situational?: boolean;
    hasVerseRef?: boolean;
  };
}

function validateAndClampResult(raw: RawLLMResponse): IntentResult {
  // Validate intent
  const intent = isValidIntent(raw?.intent || "")
    ? (raw.intent as Intent)
    : "conversation_resume";

  // Validate responseMode
  const responseMode = isValidResponseMode(raw?.responseMode || "")
    ? (raw.responseMode as VocabResponseMode)
    : "continuity";

  // Clamp confidence
  let confidence =
    typeof raw?.confidence === "number" ? raw.confidence : 0.5;
  confidence = Math.max(0, Math.min(1, confidence));

  // Limit signals
  const signals = Array.isArray(raw?.signals)
    ? raw.signals.slice(0, 5).map(String)
    : ["llm_fallback"];

  // Parse flags
  const flags: IntentFlags =
    raw?.flags && typeof raw.flags === "object"
      ? {
          selfDisclosure: !!raw.flags.selfDisclosure,
          situational: !!raw.flags.situational,
          hasVerseRef: !!raw.flags.hasVerseRef,
        }
      : { selfDisclosure: false, situational: false, hasVerseRef: false };

  // If low confidence, force to conversation_resume
  if (confidence < 0.55) {
    return {
      intent: "conversation_resume",
      responseMode: "continuity",
      confidence,
      signals: [...signals, "clamped_low_confidence"],
      source: "llm",
      flags,
    };
  }

  return {
    intent,
    responseMode,
    confidence,
    signals,
    source: "llm",
    flags,
  };
}

// =============================================================================
// Rules-Based Classifier (Tier 1)
// =============================================================================

/**
 * Fast rules-based classification.
 * Returns null if no confident match (triggers LLM fallback).
 */
export function classifyIntentRules(
  message: string,
  context: ClassificationContext
): IntentResult | null {
  const signals: string[] = [];
  const flags = detectFlags(message, context);

  // Step 1: Detect if resume is LIKELY (but don't commit yet)
  let isContinuationLikely = false;
  if (!context.isFirstMessage && context.conversationHistory.length > 0) {
    if (message.length < CONTINUATION_SIGNALS.shortMessage) {
      isContinuationLikely = true;
      signals.push("Short message in ongoing conversation");
    } else if (CONTINUATION_SIGNALS.startsWithPronoun.test(message)) {
      isContinuationLikely = true;
      signals.push("Starts with context-referencing pronoun");
    }
  }

  // Step 2: Check conversation_recall patterns FIRST (asking about prior discussions)
  // These take priority because they're more specific (meta-questions about conversations)
  for (const pattern of INTENT_PATTERNS.conversation_recall) {
    if (pattern.test(message)) {
      signals.push(`Recall pattern: ${pattern.source.slice(0, 30)}...`);
      return {
        intent: "conversation_recall",
        responseMode: "continuity",
        confidence: 0.85,
        signals,
        source: "rules",
        flags,
      };
    }
  }

  // Step 3: Check conversation_resume patterns (continuing discussion)
  for (const pattern of INTENT_PATTERNS.conversation_resume) {
    if (pattern.test(message)) {
      signals.push(`Resume pattern: ${pattern.source.slice(0, 30)}...`);
      return {
        intent: "conversation_resume",
        responseMode: "continuity",
        confidence: 0.85,
        signals,
        source: "rules",
        flags,
      };
    }
  }

  // Step 4: Check for explicit intent patterns (general topic classification)
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (intent === "conversation_recall" || intent === "conversation_resume") continue;
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        signals.push(`Pattern match: ${pattern.source.slice(0, 30)}...`);
        return {
          intent: intent as Intent,
          responseMode: INTENT_RESPONSE_MAP[intent as Intent],
          confidence: 0.9,
          signals,
          source: "rules",
          flags,
        };
      }
    }
  }

  // Step 5: Apply conversation_resume heuristic if no explicit pattern match
  if (isContinuationLikely) {
    const lastTurn =
      context.conversationHistory[context.conversationHistory.length - 1];
    if (lastTurn) {
      // Check if this might be a new topic despite short length
      if (
        /pray|prayer/i.test(message) &&
        !/pray|prayer/i.test(lastTurn.content)
      ) {
        signals.push("Short message but mentions new topic (prayer)");
        return {
          intent: "prayer_support",
          responseMode: "prayer",
          confidence: 0.7,
          signals,
          source: "rules",
          flags,
        };
      }
    }

    return {
      intent: "conversation_resume",
      responseMode: "continuity",
      confidence: 0.7,
      signals,
      source: "rules",
      flags,
    };
  }

  // Step 6: No confident match - return null to trigger LLM fallback
  // Don't default to scripture_understanding; let LLM decide
  return null;
}

// =============================================================================
// LLM-Based Classifier (Tier 2)
// =============================================================================

/**
 * LLM fallback classification using gpt-5-nano.
 * Called when rules-based classifier returns null.
 */
async function classifyIntentLLM(message: string): Promise<IntentResult> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        messages: [
          { role: "system", content: INTENT_CLASSIFICATION_PROMPT },
          { role: "user", content: message },
        ],
        max_completion_tokens: 300,
        reasoning_effort: "minimal", // Minimize reasoning to preserve tokens for output
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.error(
        "[IntentClassifier] LLM API error:",
        response.status,
        await response.text()
      );
      // Graceful degradation: return conversation_resume
      return {
        intent: "conversation_resume",
        responseMode: "continuity",
        confidence: 0.5,
        signals: ["llm_api_error"],
        source: "llm",
        flags: {},
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.warn("[IntentClassifier] No content in LLM response, finish_reason:", data.choices?.[0]?.finish_reason);
      return {
        intent: "conversation_resume",
        responseMode: "continuity",
        confidence: 0.5,
        signals: ["llm_empty_response"],
        source: "llm",
        flags: {},
      };
    }

    const parsed = JSON.parse(content) as RawLLMResponse;
    return validateAndClampResult(parsed);
  } catch (error) {
    console.error("[IntentClassifier] LLM classification failed:", error);
    return {
      intent: "conversation_resume",
      responseMode: "continuity",
      confidence: 0.5,
      signals: ["llm_exception"],
      source: "llm",
      flags: {},
    };
  }
}

// =============================================================================
// Main Orchestrator (Public API)
// =============================================================================

/**
 * Classify user intent using two-tier system:
 * 1. Try fast rules-based classification
 * 2. Fall back to LLM if rules return null
 *
 * Returns IntentResult for routing decisions.
 */
export async function classifyIntentAsync(
  message: string,
  context: ClassificationContext
): Promise<IntentResult> {
  // Try rules first
  const ruleResult = classifyIntentRules(message, context);
  if (ruleResult) {
    console.log("[IntentClassifier] Rules matched:", ruleResult.intent, ruleResult.confidence);
    return ruleResult;
  }

  // Skip LLM for trivial messages
  if (message.trim().length < 3) {
    return {
      intent: "conversation_resume",
      responseMode: "continuity",
      confidence: 0.6,
      signals: ["short_message_default"],
      source: "rules",
      flags: {},
    };
  }

  // LLM fallback
  console.log("[IntentClassifier] No rule match, calling LLM...");
  const llmResult = await classifyIntentLLM(message);
  console.log("[IntentClassifier] LLM result:", llmResult.intent, llmResult.confidence);
  return llmResult;
}

/**
 * Full classification including TaskSpec for retrieval.
 * This is the main entry point for the pipeline.
 */
export async function classifyIntent(
  message: string,
  context: ClassificationContext
): Promise<IntentClassification> {
  const intentResult = await classifyIntentAsync(message, context);

  const questionType = inferQuestionType(message);
  const needsClarification =
    !context.verseReference &&
    intentResult.intent === "scripture_understanding" &&
    !/(verse|chapter|passage|bible|scripture)/i.test(message);

  const taskSpec = buildTaskSpec(
    intentResult.intent,
    questionType,
    message,
    context,
    needsClarification
  );

  return {
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    signals: intentResult.signals,
    source: intentResult.source,
    flags: intentResult.flags,
    taskSpec,
  };
}
