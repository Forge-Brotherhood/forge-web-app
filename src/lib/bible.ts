/**
 * Bible Service
 * Server-side service for API.Bible integration with KV caching
 */

import {
  BIBLE_TRANSLATIONS,
  DEFAULT_TRANSLATION,
  type SupportedTranslation,
  type BibleBook,
  type BibleChapter,
  type BibleChapterContent,
  type BiblePassage,
  type BibleVerse,
  type ApiBibleBook,
  type ApiBibleChapter,
  type ApiBibleChapterContent,
  type ApiBiblePassage,
  type ApiBibleVerse,
} from '@/core/models/bibleModels';
import {
  getKVClient,
  CacheKeys,
  CACHE_TTL_SECONDS,
  isCacheFresh,
} from '@/lib/kv';

const API_BIBLE_BASE_URL = 'https://rest.api.bible/v1';
const API_BIBLE_KEY = process.env.API_BIBLE_KEY;

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

function getTranslationId(translation: string): string {
  const key = translation.toUpperCase() as SupportedTranslation;
  const bibleId =
    BIBLE_TRANSLATIONS[key]?.id || BIBLE_TRANSLATIONS[DEFAULT_TRANSLATION].id;
  console.log(
    `getTranslationId: translation="${translation}" -> key="${key}" -> bibleId="${bibleId}"`
  );
  return bibleId;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

// Book name to API.Bible code mapping
const BOOK_NAME_TO_CODE: Record<string, string> = {
  genesis: 'GEN',
  exodus: 'EXO',
  leviticus: 'LEV',
  numbers: 'NUM',
  deuteronomy: 'DEU',
  joshua: 'JOS',
  judges: 'JDG',
  ruth: 'RUT',
  '1 samuel': '1SA',
  '2 samuel': '2SA',
  '1 kings': '1KI',
  '2 kings': '2KI',
  '1 chronicles': '1CH',
  '2 chronicles': '2CH',
  ezra: 'EZR',
  nehemiah: 'NEH',
  esther: 'EST',
  job: 'JOB',
  psalms: 'PSA',
  psalm: 'PSA',
  proverbs: 'PRO',
  ecclesiastes: 'ECC',
  'song of solomon': 'SNG',
  'song of songs': 'SNG',
  isaiah: 'ISA',
  jeremiah: 'JER',
  lamentations: 'LAM',
  ezekiel: 'EZK',
  daniel: 'DAN',
  hosea: 'HOS',
  joel: 'JOL',
  amos: 'AMO',
  obadiah: 'OBA',
  jonah: 'JON',
  micah: 'MIC',
  nahum: 'NAM',
  habakkuk: 'HAB',
  zephaniah: 'ZEP',
  haggai: 'HAG',
  zechariah: 'ZEC',
  malachi: 'MAL',
  matthew: 'MAT',
  mark: 'MRK',
  luke: 'LUK',
  john: 'JHN',
  acts: 'ACT',
  romans: 'ROM',
  '1 corinthians': '1CO',
  '2 corinthians': '2CO',
  galatians: 'GAL',
  ephesians: 'EPH',
  philippians: 'PHP',
  colossians: 'COL',
  '1 thessalonians': '1TH',
  '2 thessalonians': '2TH',
  '1 timothy': '1TI',
  '2 timothy': '2TI',
  titus: 'TIT',
  philemon: 'PHM',
  hebrews: 'HEB',
  james: 'JAS',
  '1 peter': '1PE',
  '2 peter': '2PE',
  '1 john': '1JN',
  '2 john': '2JN',
  '3 john': '3JN',
  jude: 'JUD',
  revelation: 'REV',
};

/**
 * Convert human-readable reference to API.Bible passage ID format
 * e.g., "Proverbs 3:5-6" -> "PRO.3.5-PRO.3.6"
 * e.g., "John 3:16" -> "JHN.3.16"
 */
function convertReferenceToPassageId(reference: string): string {
  // Parse reference: "Book Chapter:Verse" or "Book Chapter:StartVerse-EndVerse"
  const match = reference.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) {
    console.error('Could not parse reference:', reference);
    return reference; // Return as-is if we can't parse
  }

  const [, bookName, chapter, startVerse, endVerse] = match;
  const bookCode = BOOK_NAME_TO_CODE[bookName.toLowerCase()];

  if (!bookCode) {
    console.error('Unknown book name:', bookName);
    return reference;
  }

  if (endVerse) {
    // Range: PRO.3.5-PRO.3.6
    return `${bookCode}.${chapter}.${startVerse}-${bookCode}.${chapter}.${endVerse}`;
  } else {
    // Single verse: JHN.3.16
    return `${bookCode}.${chapter}.${startVerse}`;
  }
}

// MARK: - Transformers

function transformBook(apiBook: ApiBibleBook): BibleBook {
  return {
    id: apiBook.id,
    name: apiBook.name,
    abbreviation: apiBook.abbreviation,
    testament: determineTestament(apiBook.id),
    chapterCount: 0, // Will be populated when chapters are fetched
  };
}

function transformChapter(apiChapter: ApiBibleChapter): BibleChapter {
  return {
    id: apiChapter.id,
    bookId: apiChapter.bookId,
    number: parseInt(apiChapter.number, 10),
    reference: apiChapter.reference,
  };
}

function transformChapterContent(
  apiContent: ApiBibleChapterContent,
  translation: string
): BibleChapterContent {
  return {
    chapter: {
      id: apiContent.id,
      bookId: apiContent.bookId,
      number: parseInt(apiContent.number, 10),
      reference: apiContent.reference,
    },
    content: apiContent.content,
    contentText: stripHtml(apiContent.content),
    copyright: apiContent.copyright,
  };
}

function transformPassage(
  apiPassage: ApiBiblePassage,
  translation: string
): BiblePassage {
  return {
    id: apiPassage.id,
    reference: apiPassage.reference,
    translationId: apiPassage.bibleId,
    translationAbbreviation: translation.toUpperCase(),
    content: apiPassage.content,
    contentText: stripHtml(apiPassage.content),
    copyright: apiPassage.copyright,
  };
}

function transformVerse(apiVerse: ApiBibleVerse): BibleVerse {
  return {
    id: apiVerse.id,
    reference: apiVerse.reference,
    bookId: apiVerse.bookId,
    chapterId: apiVerse.chapterId,
    verseNumber: parseInt(apiVerse.id.split('.').pop() || '0', 10),
    content: apiVerse.text,
    contentText: stripHtml(apiVerse.text),
  };
}

// MARK: - Bible Service Class

class BibleService {
  private kv = getKVClient();

  private async fetch<T>(endpoint: string): Promise<T> {
    if (!API_BIBLE_KEY) {
      throw new BibleServiceError('API_BIBLE_KEY is not configured', 500);
    }

    const url = `${API_BIBLE_BASE_URL}${endpoint}`;
    console.log('Bible API request URL:', url);

    const response = await fetch(url, {
      headers: {
        'api-key': API_BIBLE_KEY,
        Accept: 'application/json',
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API.Bible error:', response.status, errorText);
      throw new BibleServiceError(
        `API.Bible request failed: ${response.status}`,
        response.status
      );
    }

    const json = await response.json();
    return json.data as T;
  }

  /**
   * Get list of books in a Bible translation
   * Cached in KV for 30 days
   */
  async getBooks(
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleBook[]> {
    const cacheKey = CacheKeys.bibleBooks(translation);

    // 1. Check cache first
    const cached = await this.kv.get<BibleBook[]>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) {
      console.log(`[KV Cache] HIT: books for ${translation.toUpperCase()}`);
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: books for ${translation.toUpperCase()}, fetching from API.Bible`
    );

    // 2. Fetch from API.Bible
    const bibleId = getTranslationId(translation);
    const apiBooks = await this.fetch<ApiBibleBook[]>(
      `/bibles/${bibleId}/books`
    );
    const books = apiBooks.map(transformBook);

    // 3. Cache results
    await this.kv.set(cacheKey, books, CACHE_TTL_SECONDS);

    console.log(
      `[KV Cache] Cached ${books.length} books for ${translation.toUpperCase()}`
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
    const cacheKey = CacheKeys.bibleChapters(translation, bookId);

    // 1. Check cache first
    const cached = await this.kv.get<BibleChapter[]>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) {
      console.log(
        `[KV Cache] HIT: chapters for ${bookId} (${translation.toUpperCase()})`
      );
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: chapters for ${bookId} (${translation.toUpperCase()}), fetching from API.Bible`
    );

    // 2. Fetch from API.Bible
    const bibleId = getTranslationId(translation);
    const apiChapters = await this.fetch<ApiBibleChapter[]>(
      `/bibles/${bibleId}/books/${bookId}/chapters`
    );
    // Filter out intro chapters (usually "GEN.intro")
    const chapters = apiChapters
      .filter((ch) => !ch.id.includes('intro'))
      .map(transformChapter);

    // 3. Cache results
    await this.kv.set(cacheKey, chapters, CACHE_TTL_SECONDS);

    console.log(
      `[KV Cache] Cached ${chapters.length} chapters for ${bookId} (${translation.toUpperCase()})`
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
    const cacheKey = CacheKeys.chapterContent(translation, chapterId);

    // 1. Check cache first
    const cached = await this.kv.get<BibleChapterContent>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) {
      console.log(
        `[KV Cache] HIT: content for ${chapterId} (${translation.toUpperCase()})`
      );
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: content for ${chapterId} (${translation.toUpperCase()}), fetching from API.Bible`
    );

    // 2. Fetch from API.Bible
    const bibleId = getTranslationId(translation);
    const params = new URLSearchParams({
      'content-type': 'html',
      'include-notes': 'false',
      'include-titles': 'true',
      'include-chapter-numbers': 'false',
      'include-verse-numbers': 'true',
    });

    const apiContent = await this.fetch<ApiBibleChapterContent>(
      `/bibles/${bibleId}/chapters/${chapterId}?${params}`
    );
    const chapterContent = transformChapterContent(apiContent, translation);

    // 3. Cache result
    await this.kv.set(cacheKey, chapterContent, CACHE_TTL_SECONDS);

    console.log(
      `[KV Cache] Cached content for ${chapterId} (${translation.toUpperCase()})`
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
    const normalizedReference = reference.trim();
    const cacheKey = CacheKeys.passage(translation, normalizedReference);

    // 1. Check cache first
    const cached = await this.kv.get<BiblePassage>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) {
      console.log(
        `[KV Cache] HIT: passage "${normalizedReference}" (${translation.toUpperCase()})`
      );
      return cached.data;
    }

    console.log(
      `[KV Cache] MISS: passage "${normalizedReference}" (${translation.toUpperCase()}), fetching from API.Bible`
    );

    // 2. Fetch from API.Bible
    const bibleId = getTranslationId(translation);
    // Convert human-readable reference to API.Bible format
    const passageId = convertReferenceToPassageId(reference);
    console.log(`getPassage: reference="${reference}" -> passageId="${passageId}"`);

    const params = new URLSearchParams({
      'content-type': 'html',
      'include-notes': 'false',
      'include-titles': 'false',
      'include-chapter-numbers': 'false',
      'include-verse-numbers': 'true',
    });

    const apiPassage = await this.fetch<ApiBiblePassage>(
      `/bibles/${bibleId}/passages/${passageId}?${params}`
    );
    const passage = transformPassage(apiPassage, translation);

    // 3. Cache result
    await this.kv.set(cacheKey, passage, CACHE_TTL_SECONDS);

    console.log(
      `[KV Cache] Cached passage "${normalizedReference}" (${translation.toUpperCase()})`
    );
    return passage;
  }

  /**
   * Search for verses containing a query
   * Note: Search results are not cached as they're dynamic
   */
  async searchVerses(
    query: string,
    translation: string = DEFAULT_TRANSLATION,
    limit: number = 20
  ): Promise<{ verses: BibleVerse[]; total: number }> {
    const bibleId = getTranslationId(translation);
    const params = new URLSearchParams({
      query: query,
      limit: limit.toString(),
    });

    const result = await this.fetch<{ verses: ApiBibleVerse[]; total: number }>(
      `/bibles/${bibleId}/search?${params}`
    );

    return {
      verses: (result.verses || []).map(transformVerse),
      total: result.total || 0,
    };
  }
}

// Export singleton instance
export const bibleService = new BibleService();
