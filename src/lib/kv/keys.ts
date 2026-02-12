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
   * Key for user AI context (preferences, retrieval policy, feature flags)
   * e.g., "ai:context:user123"
   */
  aiContext: (userId: string): string => `ai:context:${userId}`,

  /**
   * Key for cached Home suggestions (guide suggestions) for a user+config.
   * e.g., "guide:suggestions:v1:user123:sha256(...)".
   */
  guideSuggestions: (userId: string, configHash: string): string =>
    `guide:suggestions:v1:${userId}:${configHash}`,

  /**
   * (rollups removed) Intentionally no rollup cache keys.
   */
};
