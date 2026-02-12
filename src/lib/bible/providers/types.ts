/**
 * Bible Provider Types
 *
 * Interface and error types for Bible API providers.
 */

import type {
  BibleBook,
  BibleChapter,
  BibleChapterContent,
} from '@/core/models/bibleModels';

/**
 * Abstract interface for Bible API providers.
 * Implementations transform provider-specific responses to canonical models.
 */
export interface BibleProvider {
  /** Provider identifier (e.g., 'aolab', 'apibible') */
  readonly name: string;

  /** Translations supported by this provider */
  readonly supportedTranslations: readonly string[];

  /**
   * Get list of books for a translation.
   */
  getBooks(translation: string): Promise<BibleBook[]>;

  /**
   * Get chapters for a specific book.
   */
  getChapters(bookId: string, translation: string): Promise<BibleChapter[]>;

  /**
   * Get full content of a chapter.
   */
  getChapterContent(
    chapterId: string,
    translation: string
  ): Promise<BibleChapterContent>;
}

/**
 * Error thrown by Bible providers.
 */
export class BibleProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly provider: string = 'unknown',
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'BibleProviderError';
  }
}

/**
 * Provider type identifiers.
 */
export type BibleProviderType = 'aolab' | 'apibible';
