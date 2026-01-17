/**
 * Bible Service
 * Server-side service for AO Lab Bible API integration with KV caching
 */

import {
  DEFAULT_TRANSLATION,
  type BibleBook,
  type BibleChapter,
  type BibleChapterContent,
  type BiblePassage,
  type BibleContentElement,
  type BibleFootnote,
  type BibleInline,
} from '@/core/models/bibleModels';
import {
  getKVClient,
  CacheKeys,
  CACHE_TTL_SECONDS,
  isCacheFresh,
} from '@/lib/kv';
import { BOOK_NAME_TO_CODE } from "@/lib/bible/bookCodes";
export { BOOK_NAME_TO_CODE, getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";

const AO_LAB_BASE_URL = 'https://bible.helloao.org';

/**
 * Forge-supported translation short codes -> AO Lab translation IDs.
 *
 * AO Lab's `{translation}` path segment expects the translation `id` from:
 * `GET https://bible.helloao.org/api/available_translations.json`
 *
 * (This is NOT always the common abbreviation like "KJV"/"WEB".)
 */
const FORGE_TRANSLATION_TO_AO_LAB_ID: Record<string, string> = {
  BSB: 'BSB',
  KJV: 'eng_kjv',
  WEB: 'ENGWEBP',
  ASV: 'eng_asv',
};

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

function toAoLabTranslationId(translation: string): string {
  const normalized = normalizeTranslation(translation);
  return FORGE_TRANSLATION_TO_AO_LAB_ID[normalized] ?? FORGE_TRANSLATION_TO_AO_LAB_ID[DEFAULT_TRANSLATION];
}

function normalizeWhitespace(text: string): string {
  // Some translations (notably KJV) include pilcrow "¶" paragraph marks in-line.
  // We render paragraphs structurally, so strip these markers from the text layer.
  return text.replace(/¶/g, '').replace(/\s+/g, ' ').trim();
}

function determineTestament(bookId: string): 'OT' | 'NT' {
  const ntBooks = [
    'MAT',
    'MRK',
    'LUK',
    'JHN',
    'ACT',
    'ROM',
    '1CO',
    '2CO',
    'GAL',
    'EPH',
    'PHP',
    'COL',
    '1TH',
    '2TH',
    '1TI',
    '2TI',
    'TIT',
    'PHM',
    'HEB',
    'JAS',
    '1PE',
    '2PE',
    '1JN',
    '2JN',
    '3JN',
    'JUD',
    'REV',
  ];
  return ntBooks.includes(bookId.toUpperCase()) ? 'NT' : 'OT';
}

/**
 * Parse a contiguous reference.
 * Examples:
 * - "John 3:16"
 * - "Proverbs 3:5-6"
 */
function parseContiguousReference(reference: string): {
  bookId: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
} | null {
  const match = reference.trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) return null;

  const [, bookName, chapterStr, verseStartStr, verseEndStr] = match;
  const bookId = BOOK_NAME_TO_CODE[bookName.toLowerCase()];
  if (!bookId) return null;

  const chapter = Number.parseInt(chapterStr, 10);
  const verseStart = Number.parseInt(verseStartStr, 10);
  const verseEnd = verseEndStr ? Number.parseInt(verseEndStr, 10) : verseStart;

  if (!Number.isFinite(chapter) || !Number.isFinite(verseStart) || !Number.isFinite(verseEnd)) return null;
  if (chapter <= 0 || verseStart <= 0 || verseEnd < verseStart) return null;

  return { bookId, chapter, verseStart, verseEnd };
}

type AoLabBooksResponse = {
  translation: {
    id: string;
    name: string;
    shortName: string;
    englishName: string;
    language: string;
    textDirection: 'ltr' | 'rtl';
  };
  books: Array<{
    id: string; // USFM
    translationId: string;
    name: string;
    commonName: string;
    title: string;
    order: number;
    numberOfChapters: number;
    firstChapterNumber: number;
    lastChapterNumber: number;
    totalNumberOfVerses: number;
  }>;
};

type AoLabFormattedText = { text: string; poem?: number; wordsOfJesus?: boolean };
type AoLabInlineHeading = { heading: string };
type AoLabInlineLineBreak = { lineBreak: true };
type AoLabVerseFootnoteRef = { noteId: number };

type AoLabChapterContent =
  | { type: 'heading'; content: string[] }
  | { type: 'line_break' }
  | {
      type: 'hebrew_subtitle';
      content: Array<
        string | AoLabFormattedText | AoLabInlineHeading | AoLabInlineLineBreak | AoLabVerseFootnoteRef
      >;
    }
  | {
      type: 'verse';
      number: number;
      content: Array<
        string | AoLabFormattedText | AoLabInlineHeading | AoLabInlineLineBreak | AoLabVerseFootnoteRef
      >;
    };

type AoLabChapterResponse = {
  translation: {
    id: string;
    name: string;
    shortName: string;
    englishName: string;
    language: string;
    textDirection: 'ltr' | 'rtl';
  };
  book: {
    id: string;
    translationId: string;
    name: string;
    commonName: string;
    title: string;
    order: number;
    numberOfChapters: number;
    totalNumberOfVerses: number;
  };
  numberOfVerses: number;
  chapter: {
    number: number;
    content: AoLabChapterContent[];
    footnotes: Array<{
      noteId: number;
      text: string;
      caller: '+' | string | null;
      reference?: { chapter: number; verse: number };
    }>;
  };
};

function aoLabInlineToCanonical(
  value:
    | string
    | AoLabFormattedText
    | AoLabInlineHeading
    | AoLabInlineLineBreak
    | AoLabVerseFootnoteRef
): BibleInline[] {
  if (typeof value === 'string') {
    const text = normalizeWhitespace(value);
    if (!text) return [];
    return [{ type: 'text', text }];
  }

  if ('text' in value) {
    const text = normalizeWhitespace(value.text);
    if (!text) return [];
    return [
      {
        type: 'formatted_text',
        text,
        poem: value.poem,
        wordsOfJesus: value.wordsOfJesus,
      },
    ];
  }

  if ('heading' in value) {
    const heading = normalizeWhitespace(value.heading);
    if (!heading) return [];
    return [{ type: 'inline_heading', heading }];
  }

  if ('lineBreak' in value) {
    return [{ type: 'inline_line_break' }];
  }

  if ('noteId' in value) {
    return [{ type: 'footnote_ref', noteId: value.noteId }];
  }

  return [];
}

function aoLabBlockToCanonical(block: AoLabChapterContent): BibleContentElement {
  if (block.type === 'line_break') return { type: 'line_break' };

  if (block.type === 'heading') {
    const inline = block.content.flatMap((s) => aoLabInlineToCanonical(String(s)));
    return { type: 'heading', level: 2, inline };
  }

  if (block.type === 'hebrew_subtitle') {
    const inline = block.content.flatMap(aoLabInlineToCanonical);
    return { type: 'hebrew_subtitle', inline };
  }

  const inline = block.content.flatMap(aoLabInlineToCanonical);
  return { type: 'verse', number: block.number, inline };
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

  private async fetchAoLab<T>(path: string): Promise<T> {
    const url = `${AO_LAB_BASE_URL}${path}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new BibleServiceError(
        `AO Lab Bible API request failed: ${response.status} ${errorText}`.trim(),
        response.status
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Get list of books in a Bible translation
   * Cached in KV for 30 days
   */
  async getBooks(
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleBook[]> {
    const normalizedTranslation = normalizeTranslation(translation);
    const cacheKey = CacheKeys.bibleBooks(normalizedTranslation);

    // 1. Check cache first
    const cached = await this.kv.get<BibleBook[]>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) {
      console.log(`[KV Cache] HIT: books for ${translation.toUpperCase()}`);
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: books for ${normalizedTranslation.toUpperCase()}, fetching from AO Lab`
    );

    const ao = await this.fetchAoLab<AoLabBooksResponse>(
      `/api/${encodeURIComponent(toAoLabTranslationId(normalizedTranslation))}/books.json`
    );

    const books: BibleBook[] = ao.books.map((b) => ({
      id: b.id,
      name: b.name || b.commonName || b.title,
      abbreviation: b.id,
      testament: determineTestament(b.id),
      chapterCount: b.numberOfChapters,
      order: b.order,
    }));

    // 3. Cache results
    await this.kv.set(cacheKey, books, CACHE_TTL_SECONDS);

    console.log(
      `[KV Cache] Cached ${books.length} books for ${normalizedTranslation.toUpperCase()}`
    );
    return books;
  }

  /**
   * Get chapters for a specific book
   * Cached in KV for 30 days
   */
  async getChapters(
    bookId: string,
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleChapter[]> {
    const normalizedTranslation = normalizeTranslation(translation);
    const cacheKey = CacheKeys.bibleChapters(normalizedTranslation, bookId);

    // 1. Check cache first
    const cached = await this.kv.get<BibleChapter[]>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) {
      console.log(
        `[KV Cache] HIT: chapters for ${bookId} (${translation.toUpperCase()})`
      );
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: chapters for ${bookId} (${normalizedTranslation.toUpperCase()}), synthesizing from AO Lab books metadata`
    );

    const books = await this.getBooks(normalizedTranslation);
    const book = books.find((b) => b.id.toUpperCase() === bookId.toUpperCase());
    if (!book) throw new BibleServiceError(`Unknown bookId: ${bookId}`, 400);

    const chapters: BibleChapter[] = Array.from({ length: book.chapterCount }, (_, idx) => {
      const number = idx + 1;
      return {
        id: `${book.id}.${number}`,
        bookId: book.id,
        number,
        reference: `${book.name} ${number}`,
      };
    });

    // 3. Cache results
    await this.kv.set(cacheKey, chapters, CACHE_TTL_SECONDS);

    console.log(
      `[KV Cache] Cached ${chapters.length} chapters for ${bookId} (${normalizedTranslation.toUpperCase()})`
    );
    return chapters;
  }

  /**
   * Get content of a specific chapter
   * Cached in KV for 30 days
   */
  async getChapterContent(
    chapterId: string,
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleChapterContent> {
    const normalizedTranslation = normalizeTranslation(translation);
    const cacheKey = CacheKeys.chapterContent(normalizedTranslation, chapterId);

    // 1. Check cache first
    const cached = await this.kv.get<BibleChapterContent>(cacheKey);
    if (
      cached &&
      isCacheFresh(cached.lastRefreshedAt) &&
      this.isStructuredChapterContent(cached.data)
    ) {
      console.log(
        `[KV Cache] HIT: content for ${chapterId} (${translation.toUpperCase()})`
      );
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: content for ${chapterId} (${normalizedTranslation.toUpperCase()}), fetching from AO Lab`
    );

    const [bookIdRaw, chapterNumRaw] = chapterId.split('.');
    const bookId = bookIdRaw?.trim().toUpperCase();
    const chapterNum = Number.parseInt(chapterNumRaw || '', 10);
    if (!bookId || !Number.isFinite(chapterNum) || chapterNum <= 0) {
      throw new BibleServiceError(`Invalid chapterId: ${chapterId}`, 400);
    }

    const ao = await this.fetchAoLab<AoLabChapterResponse>(
      `/api/${encodeURIComponent(toAoLabTranslationId(normalizedTranslation))}/${encodeURIComponent(bookId)}/${encodeURIComponent(
        String(chapterNum)
      )}.json`
    );

    const chapter: BibleChapter = {
      id: `${bookId}.${chapterNum}`,
      bookId,
      number: chapterNum,
      reference: `${ao.book.name} ${chapterNum}`,
    };

    const elements = ao.chapter.content.map(aoLabBlockToCanonical);
    const footnotes: BibleFootnote[] = (ao.chapter.footnotes || []).map((f) => ({
      noteId: f.noteId,
      text: f.text,
      caller: f.caller,
      reference: f.reference,
    }));

    const chapterContent: BibleChapterContent = {
      translation: normalizedTranslation,
      chapter,
      elements,
      footnotes,
    };

    // 3. Cache result
    await this.kv.set(cacheKey, chapterContent, CACHE_TTL_SECONDS);

    console.log(
      `[KV Cache] Cached content for ${chapterId} (${normalizedTranslation.toUpperCase()})`
    );
    return chapterContent;
  }

  /**
   * Get a passage by reference (e.g., "John 3:16" or "John 3:16-17")
   * Cached in KV for 30 days
   */
  async getPassage(
    reference: string,
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BiblePassage> {
    const normalizedTranslation = normalizeTranslation(translation);
    const normalizedReference = reference.trim();
    const cacheKey = CacheKeys.passage(normalizedTranslation, normalizedReference);

    // 1. Check cache first
    const cached = await this.kv.get<BiblePassage>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt) && this.isStructuredPassage(cached.data)) {
      console.log(
        `[KV Cache] HIT: passage "${normalizedReference}" (${translation.toUpperCase()})`
      );
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: passage "${normalizedReference}" (${normalizedTranslation.toUpperCase()}), building from AO Lab chapter data`
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
        el.type === 'verse' && el.number >= parsed.verseStart && el.number <= parsed.verseEnd
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
      `[KV Cache] Cached passage "${normalizedReference}" (${normalizedTranslation.toUpperCase()})`
    );
    return passage;
  }

  // Search is intentionally removed in this provider migration.
}

// Export singleton instance
export const bibleService = new BibleService();
