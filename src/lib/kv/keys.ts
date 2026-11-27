/**
 * Cache Key Builders
 *
 * Canonical key generation for consistent cache access
 */

export const CacheKeys = {
  /**
   * Key for list of Bible books for a translation
   * NOTE: versioned (v3) includes provider to prevent stale data when switching providers.
   * e.g., "bible:books:v3:aolab:BSB"
   */
  bibleBooks: (translation: string, provider: string): string =>
    `bible:books:v3:${provider}:${translation.toUpperCase()}`,

  /**
   * Key for chapters of a book in a translation
   * NOTE: versioned (v3) includes provider to prevent stale data when switching providers.
   * e.g., "bible:chapters:v3:aolab:BSB:GEN"
   */
  bibleChapters: (translation: string, bookId: string, provider: string): string =>
    `bible:chapters:v3:${provider}:${translation.toUpperCase()}:${bookId.toUpperCase()}`,

  /**
   * Key for chapter content (structured JSON)
   * NOTE: versioned (v4) includes provider to prevent stale data when switching providers.
   * e.g., "bible:content:v4:aolab:BSB:GEN.1"
   */
  chapterContent: (translation: string, chapterId: string, provider: string): string =>
    `bible:content:v4:${provider}:${translation.toUpperCase()}:${chapterId}`,

  /**
   * Key for a passage by reference
   * NOTE: versioned (v4) includes provider to prevent stale data when switching providers.
   * e.g., "bible:passage:v4:aolab:BSB:john 3:16"
   */
  passage: (translation: string, reference: string, provider: string): string =>
    `bible:passage:v4:${provider}:${translation.toUpperCase()}:${reference.trim().toLowerCase()}`,

  /**
   * Key for verse of the day
   * e.g., "bible:votd:BSB:2024-01-15"
   */
  verseOfTheDay: (translation: string, date: string): string =>
    `bible:votd:${translation.toUpperCase()}:${date}`,

  /**
   * Key for LLM explanation
   * e.g., "explain:full:john 3:16"
   */
  explanation: (
    reference: string,
    type: 'full' | 'summary' | 'context' | 'references'
  ): string => `explain:${type}:${reference.trim().toLowerCase()}`,

  /**
   * How many beats have called the model for a user on a local day (a count, nothing else).
   * e.g., "heartbeat:model-calls:v1:<userId>:2026-11-23"
   */
  heartbeatModelCalls: (userId: string, day: string): string => `heartbeat:model-calls:v1:${userId}:${day}`,

  /**
   * Quick actions for selected verses (public Bible text only, nothing about the reader).
   * v2: questions ranked up front; v1 answers are not reused.
   * e.g., "bible:quick-actions:v2:BSB:romans 8:14-15"
   */
  quickActions: (translation: string, reference: string): string =>
    `bible:quick-actions:v2:${translation.toUpperCase()}:${reference.trim().toLowerCase()}`,

  /**
   * (rollups removed) Intentionally no rollup cache keys.
   */
};
