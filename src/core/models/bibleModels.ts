/**
 * Bible API Response Models
 * Types for API.Bible integration
 */

// MARK: - Bible Translation

export interface BibleTranslation {
  id: string;           // API.Bible bibleId
  abbreviation: string; // NIV, ESV, NLT, KJV, WEB
  name: string;         // Full name
  language: string;     // en
}

// MARK: - Bible Book

export interface BibleBook {
  id: string;           // API.Bible bookId (e.g., "GEN")
  name: string;         // "Genesis"
  abbreviation: string; // "Gen"
  testament: 'OT' | 'NT';
  chapterCount: number;
}

// MARK: - Bible Chapter

export interface BibleChapter {
  id: string;           // API.Bible chapterId
  bookId: string;
  number: number;       // Chapter number (1-based)
  reference: string;    // "Genesis 1"
}

// MARK: - Bible Verse

export interface BibleVerse {
  id: string;           // API.Bible verseId
  reference: string;    // "John 3:16"
  bookId: string;
  chapterId: string;
  verseNumber: number;
  content: string;      // HTML content
  contentText: string;  // Plain text (stripped of HTML)
}

// MARK: - Bible Passage (multiple verses)

export interface BiblePassage {
  id: string;
  reference: string;    // "John 3:16-17"
  translationId: string;
  translationAbbreviation: string;
  content: string;      // Full HTML content
  contentText: string;  // Plain text
  copyright: string;    // Required by API.Bible
}

// MARK: - Bible Chapter Content

export interface BibleChapterContent {
  chapter: BibleChapter;
  content: string;       // HTML content
  contentText: string;   // Plain text
  copyright: string;
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
  book: BibleBook;
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

export interface BibleSearchResponse {
  verses: BibleVerse[];
  query: string;
  translation: string;
  total: number;
}

// MARK: - Supported Translations

export type SupportedTranslation = 'BSB' | 'KJV' | 'WEB' | 'ASV' | 'CEV';

export const BIBLE_TRANSLATIONS: Record<SupportedTranslation, { id: string; name: string }> = {
  BSB: { id: 'bba9f40183526463-01', name: 'Berean Standard Bible' },
  KJV: { id: 'de4e12af7f28f599-02', name: 'King James Version' },
  WEB: { id: '9879dbb7cfe39e4d-01', name: 'World English Bible' },
  ASV: { id: '06125adad2d5898a-01', name: 'American Standard Version' },
  CEV: { id: '555fef9a6cb31151-01', name: 'Contemporary English Version' },
};

// BSB is a modern, readable translation - good default
export const DEFAULT_TRANSLATION: SupportedTranslation = 'BSB';

// MARK: - API.Bible Raw Response Types (for internal transformation)

export interface ApiBibleBook {
  id: string;
  bibleId: string;
  abbreviation: string;
  name: string;
  nameLong: string;
}

export interface ApiBibleChapter {
  id: string;
  bibleId: string;
  bookId: string;
  number: string;
  reference: string;
}

export interface ApiBibleChapterContent {
  id: string;
  bibleId: string;
  bookId: string;
  number: string;
  reference: string;
  content: string;
  copyright: string;
}

export interface ApiBiblePassage {
  id: string;
  bibleId: string;
  orgId: string;
  bookId: string;
  chapterIds: string[];
  reference: string;
  content: string;
  copyright: string;
}

export interface ApiBibleVerse {
  id: string;
  orgId: string;
  bibleId: string;
  bookId: string;
  chapterId: string;
  reference: string;
  text: string;
}
