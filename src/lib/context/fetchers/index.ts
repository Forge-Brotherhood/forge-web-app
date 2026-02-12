/**
 * Context Fetchers
 *
 * Standalone data fetchers for building context candidates.
 * These replace the old pipeline stages for simple use cases.
 */

// Types
export type {
  ContextCandidate,
  FetcherOptions,
  LifeContextFetcherOptions,
  TemporalRange,
} from "./types";

// Helpers
export {
  calculateRecencyScore,
  createRedactedPreview,
  dedupeCandidates,
  groupBySource,
} from "./helpers";

// Fetchers
export { fetchLifeContext } from "./lifeContext";
export { fetchBibleReadingSessions } from "./bibleReadingSessions";
export { fetchVerseHighlights } from "./verseHighlights";
export { fetchVerseNotes } from "./verseNotes";
export { fetchConversationSummaries } from "./conversationSummaries";
