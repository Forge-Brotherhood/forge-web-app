/**
 * Bible Models (Canonical)
 *
 * Canonical structured schema used by Forge clients (web + iOS).
 * Source data is AO Lab's Free Use Bible API.
 */

// MARK: - Bible Translation

export interface BibleTranslation {
  id: string;           // AO Lab translation code, e.g. "BSB"
  abbreviation: string; // "BSB", "KJV", ...
  name: string;         // Full name
  language: string;     // "eng"
}

// MARK: - Bible Book

export interface BibleBook {
  id: string;           // USFM book id (e.g., "GEN")
  name: string;         // "Genesis"
  abbreviation: string; // Short label for UI (often equals id)
  testament: 'OT' | 'NT';
  chapterCount: number;
  order?: number;       // 1-based canonical order, if available
}

// MARK: - Bible Chapter

export interface BibleChapter {
  id: string;           // Canonical id: `${bookId}.${number}` (e.g., "GEN.1")
  bookId: string;
  number: number;       // Chapter number (1-based)
  reference: string;    // "Genesis 1"
}

// =============================================================================
// Canonical Structured Content Types
// =============================================================================

export type BibleInline =
  | { type: 'text'; text: string }
  | {
      type: 'formatted_text';
      text: string;
      poem?: number; // indent level (1+)
      wordsOfJesus?: boolean;
    }
  | { type: 'inline_heading'; heading: string }
  | { type: 'inline_line_break' }
  | { type: 'footnote_ref'; noteId: number };

export type BibleContentElement =
  | { type: 'heading'; level: number; inline: BibleInline[] }
  | { type: 'line_break' }
  | { type: 'hebrew_subtitle'; inline: BibleInline[] }
  | { type: 'verse'; number: number; inline: BibleInline[] };

export type BibleFootnote = {
  noteId: number;
  text: string;
  caller: '+' | string | null;
  reference?: {
    chapter: number;
    verse: number;
  };
};

// MARK: - Bible Passage (multiple verses)

export interface BiblePassage {
  id: string;              // deterministic id, e.g. `${translation}:${reference}`
  reference: string;       // "John 3:16-17"
  translation: string;     // "BSB"
  elements: BibleContentElement[];
  footnotes: BibleFootnote[];
}

// MARK: - Bible Chapter Content

export interface BibleChapterContent {
  translation: string; // "BSB"
  chapter: BibleChapter;
  elements: BibleContentElement[];
  footnotes: BibleFootnote[];
}

// MARK: - Verse of the Day

export interface VerseOfTheDay {
  date: string;         // ISO date "2025-01-15"
  verse: BiblePassage;
  devotionalTheme?: string;
}

// MARK: - API Response Types

export interface BibleBooksResponse {
  books: BibleBook[];
  translation: string;
}

export interface BibleChaptersResponse {
  chapters: BibleChapter[];
  bookId: string;
  translation: string;
}

export interface BibleChapterContentResponse {
  chapter: BibleChapterContent;
  translation: string;
}

export interface BiblePassageResponse {
  passage: BiblePassage;
}

export interface VerseOfTheDayResponse {
  verseOfTheDay: VerseOfTheDay;
}

export interface BibleTranslationInfo {
  code: string;
  name: string;
}

export interface BibleTranslationsResponse {
  translations: BibleTranslationInfo[];
  provider: string;
  defaultTranslation: string;
}

export interface BibleSearchResponse {
  // Search removed. This type is intentionally not used.
  // (Kept out of public exports by removal in hooks/api client.)
  verses: never[];
  query: string;
  translation: string;
  total: number;
}

// MARK: - Supported Translations

export type SupportedTranslation = 'BSB' | 'KJV' | 'WEB' | 'ASV' | 'NLT';

export const BIBLE_TRANSLATIONS: Record<SupportedTranslation, { id: string; name: string }> = {
  BSB: { id: 'BSB', name: 'Berean Standard Bible' },
  KJV: { id: 'eng_kjv', name: 'King James Version' },
  WEB: { id: 'ENGWEBP', name: 'World English Bible' },
  ASV: { id: 'eng_asv', name: 'American Standard Version' },
  NLT: { id: 'NLT', name: 'New Living Translation' },
};

// BSB is a modern, readable translation - good default
export const DEFAULT_TRANSLATION: SupportedTranslation = 'BSB';
