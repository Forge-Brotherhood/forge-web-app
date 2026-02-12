/**
 * Bible Service
 * Server-side service for Bible API integration with KV caching.
 * Uses provider abstraction to support multiple Bible APIs.
 */

import {
  DEFAULT_TRANSLATION,
  type BibleBook,
  type BibleChapter,
  type BibleChapterContent,
  type BiblePassage,
  type BibleContentElement,
  type BibleFootnote,
} from '@/core/models/bibleModels';
import {
  getKVClient,
  CacheKeys,
  CACHE_TTL_SECONDS,
  isCacheFresh,
} from '@/lib/kv';
import { BOOK_NAME_TO_CODE } from '@/lib/bible/bookCodes';
import { getBibleProvider, BibleProviderError } from '@/lib/bible/providers';

export { BOOK_NAME_TO_CODE, getBookDisplayNameFromCode } from '@/lib/bible/bookCodes';
export { BibleProviderError } from '@/lib/bible/providers';

// MARK: - Error Handling

export class BibleServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'BibleServiceError';
  }
}

// MARK: - Helper Functions

function normalizeTranslation(translation: string): string {
  const normalized = translation.trim().toUpperCase();
  return normalized || DEFAULT_TRANSLATION;
}

/**
 * Parse a contiguous reference.
 * Examples:
 * - "John 3:16"
 * - "Proverbs 3:5-6"
 * - "Psalms 51" (whole chapter)
 */
function parseContiguousReference(reference: string): {
  bookId: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
} | null {
  // Try "Book Chapter:Verse(-Verse)" first
  const verseMatch = reference.trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (verseMatch) {
    const [, bookName, chapterStr, verseStartStr, verseEndStr] = verseMatch;
    const bookId = BOOK_NAME_TO_CODE[bookName.toLowerCase()];
    if (!bookId) return null;

    const chapter = Number.parseInt(chapterStr, 10);
    const verseStart = Number.parseInt(verseStartStr, 10);
    const verseEnd = verseEndStr ? Number.parseInt(verseEndStr, 10) : verseStart;

    if (!Number.isFinite(chapter) || !Number.isFinite(verseStart) || !Number.isFinite(verseEnd)) return null;
    if (chapter <= 0 || verseStart <= 0 || verseEnd < verseStart) return null;

    return { bookId, chapter, verseStart, verseEnd };
  }

  // Try "Book Chapter" (whole chapter, no verse)
  const chapterMatch = reference.trim().match(/^(.+?)\s+(\d+)$/);
  if (chapterMatch) {
    const [, bookName, chapterStr] = chapterMatch;
    const bookId = BOOK_NAME_TO_CODE[bookName.toLowerCase()];
    if (!bookId) return null;

    const chapter = Number.parseInt(chapterStr, 10);
    if (!Number.isFinite(chapter) || chapter <= 0) return null;

    return { bookId, chapter, verseStart: null, verseEnd: null };
  }

  return null;
}

function filterFootnotesForElements(
  footnotes: BibleFootnote[],
  elements: BibleContentElement[]
): BibleFootnote[] {
  const referenced = new Set<number>();
  for (const el of elements) {
    if (el.type === 'line_break') continue;
    for (const item of el.inline) {
      if (item.type === 'footnote_ref') referenced.add(item.noteId);
    }
  }
  if (referenced.size === 0) return [];
  return footnotes.filter((f) => referenced.has(f.noteId));
}

// MARK: - Bible Service Class

class BibleService {
  private kv = getKVClient();

  private isStructuredChapterContent(value: unknown): value is BibleChapterContent {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
      typeof v.chapter === 'object' &&
      v.chapter !== null &&
      Array.isArray(v.elements) &&
      Array.isArray(v.footnotes)
    );
  }

  private isStructuredPassage(value: unknown): value is BiblePassage {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
      typeof v.id === 'string' &&
      typeof v.reference === 'string' &&
      Array.isArray(v.elements) &&
      Array.isArray(v.footnotes)
    );
  }

  /**
   * Get list of books in a Bible translation
   * Cached in KV for 30 days
   */
  async getBooks(
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleBook[]> {
    const provider = getBibleProvider();
    const normalizedTranslation = normalizeTranslation(translation);
    const cacheKey = CacheKeys.bibleBooks(normalizedTranslation, provider.name);

    // 1. Check cache first
    const cached = await this.kv.get<BibleBook[]>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) {
      console.log(`[KV Cache] HIT: books for ${translation.toUpperCase()} (${provider.name})`);
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: books for ${normalizedTranslation.toUpperCase()} (${provider.name}), fetching from provider`
    );

    try {
      const books = await provider.getBooks(normalizedTranslation);

      // 3. Cache results
      await this.kv.set(cacheKey, books, CACHE_TTL_SECONDS);

      console.log(
        `[KV Cache] Cached ${books.length} books for ${normalizedTranslation.toUpperCase()} (${provider.name})`
      );
      return books;
    } catch (error) {
      if (error instanceof BibleProviderError) {
        throw new BibleServiceError(error.message, error.statusCode, error);
      }
      throw error;
    }
  }

  /**
   * Get chapters for a specific book
   * Cached in KV for 30 days
   */
  async getChapters(
    bookId: string,
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleChapter[]> {
    const provider = getBibleProvider();
    const normalizedTranslation = normalizeTranslation(translation);
    const cacheKey = CacheKeys.bibleChapters(normalizedTranslation, bookId, provider.name);

    // 1. Check cache first
    const cached = await this.kv.get<BibleChapter[]>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) {
      console.log(
        `[KV Cache] HIT: chapters for ${bookId} (${translation.toUpperCase()}, ${provider.name})`
      );
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: chapters for ${bookId} (${normalizedTranslation.toUpperCase()}, ${provider.name}), fetching from provider`
    );

    try {
      const chapters = await provider.getChapters(bookId, normalizedTranslation);

      // 3. Cache results
      await this.kv.set(cacheKey, chapters, CACHE_TTL_SECONDS);

      console.log(
        `[KV Cache] Cached ${chapters.length} chapters for ${bookId} (${normalizedTranslation.toUpperCase()}, ${provider.name})`
      );
      return chapters;
    } catch (error) {
      if (error instanceof BibleProviderError) {
        throw new BibleServiceError(error.message, error.statusCode, error);
      }
      throw error;
    }
  }

  /**
   * Get content of a specific chapter
   * Cached in KV for 30 days
   */
  async getChapterContent(
    chapterId: string,
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleChapterContent> {
    const provider = getBibleProvider();
    const normalizedTranslation = normalizeTranslation(translation);
    const cacheKey = CacheKeys.chapterContent(normalizedTranslation, chapterId, provider.name);

    // 1. Check cache first
    const cached = await this.kv.get<BibleChapterContent>(cacheKey);
    if (
      cached &&
      isCacheFresh(cached.lastRefreshedAt) &&
      this.isStructuredChapterContent(cached.data)
    ) {
      console.log(
        `[KV Cache] HIT: content for ${chapterId} (${translation.toUpperCase()}, ${provider.name})`
      );
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: content for ${chapterId} (${normalizedTranslation.toUpperCase()}, ${provider.name}), fetching from provider`
    );

    try {
      const chapterContent = await provider.getChapterContent(chapterId, normalizedTranslation);

      // 3. Cache result
      await this.kv.set(cacheKey, chapterContent, CACHE_TTL_SECONDS);

      console.log(
        `[KV Cache] Cached content for ${chapterId} (${normalizedTranslation.toUpperCase()}, ${provider.name})`
      );
      return chapterContent;
    } catch (error) {
      if (error instanceof BibleProviderError) {
        throw new BibleServiceError(error.message, error.statusCode, error);
      }
      throw error;
    }
  }

  /**
   * Get a passage by reference (e.g., "John 3:16" or "John 3:16-17")
   * Cached in KV for 30 days
   */
  async getPassage(
    reference: string,
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BiblePassage> {
    const provider = getBibleProvider();
    const normalizedTranslation = normalizeTranslation(translation);
    const normalizedReference = reference.trim();
    const cacheKey = CacheKeys.passage(normalizedTranslation, normalizedReference, provider.name);

    // 1. Check cache first
    const cached = await this.kv.get<BiblePassage>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt) && this.isStructuredPassage(cached.data)) {
      console.log(
        `[KV Cache] HIT: passage "${normalizedReference}" (${translation.toUpperCase()}, ${provider.name})`
      );
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: passage "${normalizedReference}" (${normalizedTranslation.toUpperCase()}, ${provider.name}), building from chapter data`
    );

    const parsed = parseContiguousReference(normalizedReference);
    if (!parsed) {
      throw new BibleServiceError(
        `Invalid reference format: ${reference}. Expected e.g. "John 3:16" or "John 3:16-17"`,
        400
      );
    }

    const chapterId = `${parsed.bookId}.${parsed.chapter}`;
    const chapter = await this.getChapterContent(chapterId, normalizedTranslation);

    const verseElements = chapter.elements.filter(
      (el): el is Extract<BibleContentElement, { type: 'verse' }> =>
        el.type === 'verse' &&
        (parsed.verseStart === null || el.number >= parsed.verseStart) &&
        (parsed.verseEnd === null || el.number <= parsed.verseEnd)
    );

    const footnotes = filterFootnotesForElements(chapter.footnotes, verseElements);

    const passage: BiblePassage = {
      id: `${normalizedTranslation}:${normalizedReference.toLowerCase()}`,
      reference: normalizedReference,
      translation: normalizedTranslation,
      elements: verseElements,
      footnotes,
    };

    // 3. Cache result
    await this.kv.set(cacheKey, passage, CACHE_TTL_SECONDS);

    console.log(
      `[KV Cache] Cached passage "${normalizedReference}" (${normalizedTranslation.toUpperCase()}, ${provider.name})`
    );
    return passage;
  }
}

// Export singleton instance
export const bibleService = new BibleService();
