/**
 * AO Lab Bible Provider
 *
 * Implementation for bible.helloao.org API.
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
  AO_LAB_TRANSLATION_IDS,
  SUPPORTED_TRANSLATIONS,
  type SupportedTranslation,
} from './translationMaps';

const AO_LAB_BASE_URL = 'https://bible.helloao.org';

// MARK: - AO Lab Response Types

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

// MARK: - Helper Functions

function normalizeTranslation(translation: string): string {
  const normalized = translation.trim().toUpperCase();
  return normalized || DEFAULT_TRANSLATION;
}

function toAoLabTranslationId(translation: string): string {
  const normalized = normalizeTranslation(translation) as SupportedTranslation;
  return AO_LAB_TRANSLATION_IDS[normalized] ?? AO_LAB_TRANSLATION_IDS[DEFAULT_TRANSLATION as SupportedTranslation];
}

function normalizeWhitespace(text: string): string {
  // Some translations (notably KJV) include pilcrow "¶" paragraph marks in-line.
  // We render paragraphs structurally, so strip these markers from the text layer.
  return text.replace(/¶/g, '').replace(/\s+/g, ' ').trim();
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

// MARK: - Transformation Functions

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

// MARK: - AO Lab Provider Class

export class AoLabBibleProvider implements BibleProvider {
  readonly name = 'aolab';
  readonly supportedTranslations = SUPPORTED_TRANSLATIONS;

  private async fetch<T>(path: string): Promise<T> {
    const url = `${AO_LAB_BASE_URL}${path}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new BibleProviderError(
        `AO Lab Bible API request failed: ${response.status} ${errorText}`.trim(),
        response.status,
        this.name
      );
    }

    return (await response.json()) as T;
  }

  async getBooks(translation: string = DEFAULT_TRANSLATION): Promise<BibleBook[]> {
    const normalizedTranslation = normalizeTranslation(translation);
    const aoLabId = toAoLabTranslationId(normalizedTranslation);

    const ao = await this.fetch<AoLabBooksResponse>(
      `/api/${encodeURIComponent(aoLabId)}/books.json`
    );

    return ao.books.map((b) => ({
      id: b.id,
      name: b.name || b.commonName || b.title,
      abbreviation: b.id,
      testament: determineTestament(b.id),
      chapterCount: b.numberOfChapters,
      order: b.order,
    }));
  }

  async getChapters(
    bookId: string,
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleChapter[]> {
    // AO Lab doesn't have a chapters endpoint, so we synthesize from books metadata
    const books = await this.getBooks(translation);
    const book = books.find((b) => b.id.toUpperCase() === bookId.toUpperCase());

    if (!book) {
      throw new BibleProviderError(`Unknown bookId: ${bookId}`, 400, this.name);
    }

    return Array.from({ length: book.chapterCount }, (_, idx) => {
      const number = idx + 1;
      return {
        id: `${book.id}.${number}`,
        bookId: book.id,
        number,
        reference: `${book.name} ${number}`,
      };
    });
  }

  async getChapterContent(
    chapterId: string,
    translation: string = DEFAULT_TRANSLATION
  ): Promise<BibleChapterContent> {
    const normalizedTranslation = normalizeTranslation(translation);

    const [bookIdRaw, chapterNumRaw] = chapterId.split('.');
    const bookId = bookIdRaw?.trim().toUpperCase();
    const chapterNum = Number.parseInt(chapterNumRaw || '', 10);

    if (!bookId || !Number.isFinite(chapterNum) || chapterNum <= 0) {
      throw new BibleProviderError(`Invalid chapterId: ${chapterId}`, 400, this.name);
    }

    const aoLabId = toAoLabTranslationId(normalizedTranslation);
    const ao = await this.fetch<AoLabChapterResponse>(
      `/api/${encodeURIComponent(aoLabId)}/${encodeURIComponent(bookId)}/${encodeURIComponent(String(chapterNum))}.json`
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

    return {
      translation: normalizedTranslation,
      chapter,
      elements,
      footnotes,
    };
  }
}
