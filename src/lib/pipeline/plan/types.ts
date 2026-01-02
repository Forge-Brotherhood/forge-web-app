/**
 * Unified planning types for the AI pipeline.
 *
 * Intent (routing) and retrieval are decoupled:
 * - ResponsePlan: how to respond (mode/style/length/safety)
 * - RetrievalPlan: what to retrieve (needs + filters)
 */

import type { ArtifactType } from "@/lib/artifacts/types";

export const RESPONSE_MODES = {
  explain: "explain",
  study: "study",
  coach: "coach",
  pastoral: "pastoral",
  continuity: "continuity",
} as const;

export type ResponseMode = (typeof RESPONSE_MODES)[keyof typeof RESPONSE_MODES];

export type LengthTarget = "short" | "medium";

export type ResponsePlan = {
  responseMode: ResponseMode;
  lengthTarget: LengthTarget;
  safetyFlags: {
    selfHarm: boolean;
    violence: boolean;
  };
  flags: {
    selfDisclosure: boolean;
    situational: boolean;
  };
  /**
   * Debuggability: compact explanation for why this plan was chosen.
   * Keep short; do not include sensitive content.
   */
  signals: string[];
  source: "rules" | "llm";
  confidence: number; // 0..1
};

export const RETRIEVAL_NEEDS = {
  user_memory: "user_memory",
  artifact_semantic: "artifact_semantic",
  verse_highlights: "verse_highlights",
  verse_notes: "verse_notes",
  conversation_session_summaries: "conversation_session_summaries",
  bible_reading_sessions: "bible_reading_sessions",
} as const;

export type RetrievalNeed = (typeof RETRIEVAL_NEEDS)[keyof typeof RETRIEVAL_NEEDS];

export type TemporalRange =
  | "last_day"
  | "last_week"
  | "last_month"
  | "last_3_months"
  | "last_year"
  | "this_year"
  | "all_time";

export type TemporalDirection = "oldest" | "newest";

export type TemporalFilter = {
  range?: TemporalRange;
  direction?: TemporalDirection;
};

export type ScriptureScope =
  | { kind: "book"; bookId: string; bookName?: string }
  | { kind: "chapter"; bookId: string; bookName?: string; chapter: number };

export type RetrievalFilters = {
  temporal?: TemporalFilter;
  scope?: ScriptureScope;
};

export type RetrievalLimits = Partial<Record<RetrievalNeed, number>>;

export type RetrievalPlan = {
  needs: RetrievalNeed[];
  filters?: RetrievalFilters;
  /**
   * Query to use for semantic artifact retrieval.
   * If omitted, default to the user message.
   */
  query?: string;
  /**
   * When a need maps directly to artifact types, specify them.
   * This is also used for topic queries that should search across multiple types.
   */
  artifactTypes?: ArtifactType[];
  limits?: RetrievalLimits;
};

export type Plan = {
  response: ResponsePlan;
  retrieval: RetrievalPlan;
};


