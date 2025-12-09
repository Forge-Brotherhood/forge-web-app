/**
 * Cache Key Builders
 *
 * Canonical key generation for consistent cache access
 */

export const CacheKeys = {
  /**
   * Key for list of Bible books for a translation
   * e.g., "bible:books:BSB"
   */
  bibleBooks: (translation: string): string =>
    `bible:books:${translation.toUpperCase()}`,

  /**
   * Key for chapters of a book in a translation
   * e.g., "bible:chapters:BSB:GEN"
   */
  bibleChapters: (translation: string, bookId: string): string =>
    `bible:chapters:${translation.toUpperCase()}:${bookId.toUpperCase()}`,

  /**
   * Key for chapter content (HTML)
   * e.g., "bible:content:BSB:GEN.1"
   */
  chapterContent: (translation: string, chapterId: string): string =>
    `bible:content:${translation.toUpperCase()}:${chapterId}`,

  /**
   * Key for a passage by reference
   * e.g., "bible:passage:BSB:john 3:16"
   */
  passage: (translation: string, reference: string): string =>
    `bible:passage:${translation.toUpperCase()}:${reference.trim().toLowerCase()}`,

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
};
