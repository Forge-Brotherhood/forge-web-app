/**
 * API.Bible Provider
 *
 * Implementation for api.bible (rest.api.bible).
 * Requires API_BIBLE_KEY environment variable.
 */

import {
  DEFAULT_TRANSLATION,
  type BibleBook,
  type BibleChapter,
  type BibleChapterContent,
  type BibleContentElement,
  type BibleFootnote,
  type BibleInline,
} from '@/core/models/bibleModels';
import { type BibleProvider, BibleProviderError } from './types';
import {
  API_BIBLE_TRANSLATION_IDS,
  SUPPORTED_TRANSLATIONS,
  type SupportedTranslation,
} from './translationMaps';

const API_BIBLE_BASE_URL = 'https://rest.api.bible/v1';

// MARK: - API.Bible Response Types

interface ApiBibleBookResponse {
  data: Array<{
    id: string; // e.g., "GEN"
    bibleId: string;
    abbreviation: string;
    name: string;
    nameLong: string;
  }>;
}

interface ApiBibleChapterListResponse {
  data: Array<{
    id: string; // e.g., "GEN.1"
    bibleId: string;
    bookId: string;
    number: string;
    reference: string;
  }>;
}

interface ApiBibleChapterContentResponse {
  data: {
    id: string;
    bibleId: string;
    bookId: string;
    number: string;
    reference: string;
    content: ApiBibleContentItem[];
    verseCount: number;
    next?: { id: string; bookId: string; number: string };
    previous?: { id: string; bookId: string; number: string };
  };
  meta: {
    fums: string;
    fumsId: string;
    fumsJsInclude: string;
    fumsJs: string;
    fumsNoScript: string;
  };
}

// API.Bible JSON content structure (when using content-type=json)
type ApiBibleContentItem =
  | { name: 'para'; type: 'tag'; attrs: { style: string }; items: ApiBibleContentItem[] }
  | { name: 'verse'; type: 'tag'; attrs: { number: string; style: string; sid: string }; items?: ApiBibleContentItem[] }
  | { name: 'char'; type: 'tag'; attrs: { style: string }; items: ApiBibleContentItem[] }
  | { text: string; type: 'text'; attrs?: { verseId?: string; verseOrgIds?: string[] } };

// MARK: - Helper Functions

function normalizeTranslation(translation: string): string {
  const normalized = translation.trim().toUpperCase();
  return normalized || DEFAULT_TRANSLATION;
}

function toApiBibleId(translation: string): string {
  const normalized = normalizeTranslation(translation) as SupportedTranslation;
  return API_BIBLE_TRANSLATION_IDS[normalized] ?? API_BIBLE_TRANSLATION_IDS[DEFAULT_TRANSLATION as SupportedTranslation];
}

function determineTestament(bookId: string): 'OT' | 'NT' {
  const ntBooks = [
    'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO',
    'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI',
    'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN',
    '3JN', 'JUD', 'REV',
  ];
  return ntBooks.includes(bookId.toUpperCase()) ? 'NT' : 'OT';
}

// MARK: - Content Transformation

/**
 * Extract text from API.Bible content items recursively.
 */
function extractTextFromItems(items: ApiBibleContentItem[]): string {
  let text = '';
  for (const item of items) {
    if ('text' in item) {
      text += item.text;
    } else if ('items' in item && item.items) {
      text += extractTextFromItems(item.items);
    }
  }
  return text;
}

/**
 * Check if a paragraph style indicates poetry.
 */
function isPoetryStyle(style: string): number | undefined {
  // q, q1, q2, q3 = poetry with indent levels
  if (style === 'q' || style === 'q1') return 1;
  if (style === 'q2') return 2;
  if (style === 'q3') return 3;
  return undefined;
}

/**
 * Check if a char style indicates words of Jesus.
 */
function isWordsOfJesus(style: string): boolean {
  return style === 'wj';
}

/**
 * Transform API.Bible content items to canonical BibleInline elements.
 */
function transformInlineContent(
  items: ApiBibleContentItem[],
  contextPoem?: number
): BibleInline[] {
  const result: BibleInline[] = [];

  for (const item of items) {
    if ('text' in item) {
      const text = item.text.replace(/\s+/g, ' ');
      if (text) {
        if (contextPoem) {
          result.push({ type: 'formatted_text', text, poem: contextPoem });
        } else {
          result.push({ type: 'text', text });
        }
      }
    } else if (item.name === 'char') {
      const text = extractTextFromItems(item.items || []).replace(/\s+/g, ' ');
      if (text) {
        if (isWordsOfJesus(item.attrs.style)) {
          result.push({ type: 'formatted_text', text, wordsOfJesus: true, poem: contextPoem });
        } else if (contextPoem) {
          result.push({ type: 'formatted_text', text, poem: contextPoem });
        } else {
          result.push({ type: 'text', text });
        }
      }
    } else if ('items' in item && item.items) {
      result.push(...transformInlineContent(item.items, contextPoem));
    }
  }

  return result;
}

/**
 * Transform API.Bible JSON content to canonical BibleContentElement array.
 */
function transformContent(content: ApiBibleContentItem[]): {
  elements: BibleContentElement[];
  footnotes: BibleFootnote[];
} {
  const elements: BibleContentElement[] = [];
  const footnotes: BibleFootnote[] = [];
  let currentVerseNumber = 0;
  let currentVerseInline: BibleInline[] = [];

  function flushVerse() {
    if (currentVerseNumber > 0 && currentVerseInline.length > 0) {
      elements.push({
        type: 'verse',
        number: currentVerseNumber,
        inline: currentVerseInline,
      });
      currentVerseInline = [];
    }
  }

  function processItems(items: ApiBibleContentItem[], contextPoem?: number) {
    for (const item of items) {
      if ('text' in item) {
        const text = item.text.replace(/\s+/g, ' ');
        if (text && currentVerseNumber > 0) {
          if (contextPoem) {
            currentVerseInline.push({ type: 'formatted_text', text, poem: contextPoem });
          } else {
            currentVerseInline.push({ type: 'text', text });
          }
        }
      } else if (item.name === 'verse') {
        // Flush previous verse
        flushVerse();
        // Start new verse - the verse number is in attrs, not in items
        // items just contains the verse number text marker which we skip
        currentVerseNumber = parseInt(item.attrs.number, 10) || 0;
      } else if (item.name === 'para') {
        const style = item.attrs.style;
        const poem = isPoetryStyle(style);

        // Check for section headings
        if (style === 's' || style === 's1' || style === 's2') {
          flushVerse();
          const text = extractTextFromItems(item.items || []).trim();
          if (text) {
            const level = style === 's2' ? 3 : 2;
            elements.push({
              type: 'heading',
              level,
              inline: [{ type: 'text', text }],
            });
          }
        } else if (style === 'd') {
          // Hebrew subtitle (psalm inscription)
          flushVerse();
          const inline = transformInlineContent(item.items || []);
          if (inline.length > 0) {
            elements.push({ type: 'hebrew_subtitle', inline });
          }
        } else if (style === 'b') {
          // Blank line / line break
          flushVerse();
          elements.push({ type: 'line_break' });
        } else {
          // Regular paragraph content
          processItems(item.items || [], poem);
        }
      } else if (item.name === 'char') {
        const text = extractTextFromItems(item.items || []).replace(/\s+/g, ' ');
        if (text && currentVerseNumber > 0) {
          if (isWordsOfJesus(item.attrs.style)) {
            currentVerseInline.push({
              type: 'formatted_text',
              text,
              wordsOfJesus: true,
              poem: contextPoem,
            });
          } else if (contextPoem) {
            currentVerseInline.push({ type: 'formatted_text', text, poem: contextPoem });
          } else {
            currentVerseInline.push({ type: 'text', text });
          }
        }
      }
    }
  }

  processItems(content);
  flushVerse();

  return { elements, footnotes };
}

// MARK: - API.Bible Provider Class

export class ApiBibleProvider implements BibleProvider {
  readonly name = 'apibible';
  readonly supportedTranslations = SUPPORTED_TRANSLATIONS;

  private getApiKey(): string {
    const apiKey = process.env.API_BIBLE_KEY;
    if (!apiKey) {
      throw new BibleProviderError(
        'API_BIBLE_KEY environment variable is required for api.bible provider',
        500,
        this.name
      );
    }
    return apiKey;
  }

  private async fetch<T>(path: string): Promise<T> {
    const url = `${API_BIBLE_BASE_URL}${path}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'api-key': this.getApiKey(),
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new BibleProviderError(
        `api.bible request failed: ${response.status} ${errorText}`.trim(),
        response.status,
        this.name
      );
    }

    return (await response.json()) as T;
  }

  async getBooks(translation: string = DEFAULT_TRANSLATION): Promise<BibleBook[]> {
    const bibleId = toApiBibleId(translation);
    const response = await this.fetch<ApiBibleBookResponse>(
      `/bibles/${encodeURIComponent(bibleId)}/books`
    );

    return response.data.map((book, index) => ({
      id: book.id,
      name: book.name,
      abbreviation: book.abbreviation || book.id,
      testament: determineTestament(book.id),
      chapterCount: 0, // Will be populated when chapters are fetched
      order: index + 1,
    }));
  }

  async getChapters(
    bookId: string,
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleChapter[]> {
    const bibleId = toApiBibleId(translation);
    const normalizedBookId = bookId.toUpperCase();

    const response = await this.fetch<ApiBibleChapterListResponse>(
      `/bibles/${encodeURIComponent(bibleId)}/books/${encodeURIComponent(normalizedBookId)}/chapters`
    );

    // Filter out intro chapters (like "GEN.intro")
    return response.data
      .filter((ch) => !ch.id.includes('.intro'))
      .map((ch) => ({
        id: ch.id,
        bookId: ch.bookId,
        number: parseInt(ch.number, 10),
        reference: ch.reference,
      }));
  }

  async getChapterContent(
    chapterId: string,
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleChapterContent> {
    const normalizedTranslation = normalizeTranslation(translation);
    const bibleId = toApiBibleId(normalizedTranslation);

    // Validate chapterId format
    const [bookIdRaw, chapterNumRaw] = chapterId.split('.');
    const bookId = bookIdRaw?.trim().toUpperCase();
    const chapterNum = Number.parseInt(chapterNumRaw || '', 10);

    if (!bookId || !Number.isFinite(chapterNum) || chapterNum <= 0) {
      throw new BibleProviderError(`Invalid chapterId: ${chapterId}`, 400, this.name);
    }

    const normalizedChapterId = `${bookId}.${chapterNum}`;

    // Request JSON content format
    const response = await this.fetch<ApiBibleChapterContentResponse>(
      `/bibles/${encodeURIComponent(bibleId)}/chapters/${encodeURIComponent(normalizedChapterId)}?content-type=json&include-notes=false&include-titles=true&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false`
    );

    const { elements, footnotes } = transformContent(response.data.content);

    const chapter: BibleChapter = {
      id: normalizedChapterId,
      bookId,
      number: chapterNum,
      reference: response.data.reference,
    };

    return {
      translation: normalizedTranslation,
      chapter,
      elements,
      footnotes,
    };
  }
}
