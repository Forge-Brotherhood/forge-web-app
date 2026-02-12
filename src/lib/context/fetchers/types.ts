/**
 * Context Fetcher Types
 *
 * Shared types for standalone context fetchers that replace the old pipeline.
 */

export type TemporalRange =
  | "last_day"
  | "last_week"
  | "last_month"
  | "last_3_months"
  | "last_year"
  | "this_year"
  | "all_time";

/**
 * Base options shared by all fetchers.
 */
export interface FetcherOptions {
  userId: string;
  temporalRange?: TemporalRange;
  limit?: number;
}

/**
 * Options specific to life context fetcher.
 */
export interface LifeContextFetcherOptions {
  userId: string;
  aiContext?: { userContext?: Record<string, unknown> };
}

/**
 * Candidate context from any source.
 * IDs are stable and derivable for provenance tracking:
 *   - life:<userId>:season
 *   - bible_chapter_daily_rollup:<bookId>:<chapter>:<localDate>
 *   - artifact:<uuid>
 */
export interface ContextCandidate {
  id: string;
  source:
    | "life_context"
    | "bible_reading_session"
    | "artifact";
  label: string;
  preview: string;
  metadata: Record<string, unknown>;
  features?: {
    scopeScore?: number;
    recencyScore?: number;
    semanticScore?: number;
    freshness?: number;
    temporalScore?: number;
    createdAt?: string;
  };
}
