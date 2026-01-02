/**
 * Bible Reference Parsing Utilities
 *
 * Used for multi-layer memory retrieval to match:
 * - Exact verse matches
 * - Same passage (book + chapter) matches
 */

export interface ParsedReference {
  book: string; // Normalized book name (e.g., "Matthew", "1 John")
  chapter: number;
  verseStart: number;
  verseEnd?: number; // For ranges like "1-3"
}

// Book name normalization map (common variations → canonical)
const BOOK_ALIASES: Record<string, string> = {
  // Old Testament
  gen: "Genesis",
  genesis: "Genesis",
  exo: "Exodus",
  exodus: "Exodus",
  lev: "Leviticus",
  leviticus: "Leviticus",
  num: "Numbers",
  numbers: "Numbers",
  deu: "Deuteronomy",
  deut: "Deuteronomy",
  deuteronomy: "Deuteronomy",
  jos: "Joshua",
  josh: "Joshua",
  joshua: "Joshua",
  jdg: "Judges",
  judg: "Judges",
  judges: "Judges",
  rut: "Ruth",
  ruth: "Ruth",
  "1sa": "1 Samuel",
  "1sam": "1 Samuel",
  "1 sam": "1 Samuel",
  "1 samuel": "1 Samuel",
  "2sa": "2 Samuel",
  "2sam": "2 Samuel",
  "2 sam": "2 Samuel",
  "2 samuel": "2 Samuel",
  "1ki": "1 Kings",
  "1 kings": "1 Kings",
  "2ki": "2 Kings",
  "2 kings": "2 Kings",
  "1ch": "1 Chronicles",
  "1 chronicles": "1 Chronicles",
  "2ch": "2 Chronicles",
  "2 chronicles": "2 Chronicles",
  ezr: "Ezra",
  ezra: "Ezra",
  neh: "Nehemiah",
  nehemiah: "Nehemiah",
  est: "Esther",
  esther: "Esther",
  job: "Job",
  psa: "Psalms",
  psalm: "Psalms",
  psalms: "Psalms",
  ps: "Psalms",
  pro: "Proverbs",
  prov: "Proverbs",
  proverbs: "Proverbs",
  ecc: "Ecclesiastes",
  eccl: "Ecclesiastes",
  ecclesiastes: "Ecclesiastes",
  sng: "Song of Solomon",
  song: "Song of Solomon",
  "song of solomon": "Song of Solomon",
  "song of songs": "Song of Solomon",
  sos: "Song of Solomon",
  isa: "Isaiah",
  isaiah: "Isaiah",
  jer: "Jeremiah",
  jeremiah: "Jeremiah",
  lam: "Lamentations",
  lamentations: "Lamentations",
  ezk: "Ezekiel",
  ezek: "Ezekiel",
  ezekiel: "Ezekiel",
  dan: "Daniel",
  daniel: "Daniel",
  hos: "Hosea",
  hosea: "Hosea",
  jol: "Joel",
  joel: "Joel",
  amo: "Amos",
  amos: "Amos",
  oba: "Obadiah",
  obad: "Obadiah",
  obadiah: "Obadiah",
  jon: "Jonah",
  jonah: "Jonah",
  mic: "Micah",
  micah: "Micah",
  nam: "Nahum",
  nahum: "Nahum",
  hab: "Habakkuk",
  habakkuk: "Habakkuk",
  zep: "Zephaniah",
  zeph: "Zephaniah",
  zephaniah: "Zephaniah",
  hag: "Haggai",
  haggai: "Haggai",
  zec: "Zechariah",
  zech: "Zechariah",
  zechariah: "Zechariah",
  mal: "Malachi",
  malachi: "Malachi",

  // New Testament
  mat: "Matthew",
  matt: "Matthew",
  matthew: "Matthew",
  mrk: "Mark",
  mark: "Mark",
  luk: "Luke",
  luke: "Luke",
  jhn: "John",
  john: "John",
  act: "Acts",
  acts: "Acts",
  rom: "Romans",
  romans: "Romans",
  "1co": "1 Corinthians",
  "1cor": "1 Corinthians",
  "1 cor": "1 Corinthians",
  "1 corinthians": "1 Corinthians",
  "2co": "2 Corinthians",
  "2cor": "2 Corinthians",
  "2 cor": "2 Corinthians",
  "2 corinthians": "2 Corinthians",
  gal: "Galatians",
  galatians: "Galatians",
  eph: "Ephesians",
  ephesians: "Ephesians",
  php: "Philippians",
  phil: "Philippians",
  philippians: "Philippians",
  col: "Colossians",
  colossians: "Colossians",
  "1th": "1 Thessalonians",
  "1thes": "1 Thessalonians",
  "1 thess": "1 Thessalonians",
  "1 thessalonians": "1 Thessalonians",
  "2th": "2 Thessalonians",
  "2thes": "2 Thessalonians",
  "2 thess": "2 Thessalonians",
  "2 thessalonians": "2 Thessalonians",
  "1ti": "1 Timothy",
  "1tim": "1 Timothy",
  "1 tim": "1 Timothy",
  "1 timothy": "1 Timothy",
  "2ti": "2 Timothy",
  "2tim": "2 Timothy",
  "2 tim": "2 Timothy",
  "2 timothy": "2 Timothy",
  tit: "Titus",
  titus: "Titus",
  phm: "Philemon",
  phlm: "Philemon",
  philemon: "Philemon",
  heb: "Hebrews",
  hebrews: "Hebrews",
  jas: "James",
  james: "James",
  "1pe": "1 Peter",
  "1pet": "1 Peter",
  "1 pet": "1 Peter",
  "1 peter": "1 Peter",
  "2pe": "2 Peter",
  "2pet": "2 Peter",
  "2 pet": "2 Peter",
  "2 peter": "2 Peter",
  "1jn": "1 John",
  "1john": "1 John",
  "1 john": "1 John",
  "2jn": "2 John",
  "2john": "2 John",
  "2 john": "2 John",
  "3jn": "3 John",
  "3john": "3 John",
  "3 john": "3 John",
  jud: "Jude",
  jude: "Jude",
  rev: "Revelation",
  revelation: "Revelation",
  revelations: "Revelation",
};

/**
 * Parse a Bible reference string into structured components.
 *
 * Examples:
 * - "John 3:16" → { book: "John", chapter: 3, verseStart: 16 }
 * - "1 John 2:1-3" → { book: "1 John", chapter: 2, verseStart: 1, verseEnd: 3 }
 * - "Matthew 6:14-15" → { book: "Matthew", chapter: 6, verseStart: 14, verseEnd: 15 }
 */
export function parseReference(ref: string): ParsedReference | null {
  if (!ref || typeof ref !== "string") return null;

  const trimmed = ref.trim();

  // Pattern: [optional number] [book name] [chapter]:[verse(s)]
  // Examples: "John 3:16", "1 John 2:1-3", "Song of Solomon 1:1"
  const pattern =
    /^(\d?\s*[A-Za-z]+(?:\s+[A-Za-z]+)?(?:\s+[A-Za-z]+)?)\s+(\d+):(\d+)(?:-(\d+))?$/i;
  const match = trimmed.match(pattern);

  if (!match) {
    // Try without verse (just book + chapter)
    const chapterOnly = /^(\d?\s*[A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(\d+)$/i;
    const chapterMatch = trimmed.match(chapterOnly);
    if (chapterMatch) {
      const bookKey = chapterMatch[1].toLowerCase().trim();
      const book = BOOK_ALIASES[bookKey];
      if (book) {
        return {
          book,
          chapter: parseInt(chapterMatch[2], 10),
          verseStart: 1,
        };
      }
    }
    return null;
  }

  const bookKey = match[1].toLowerCase().trim();
  const book = BOOK_ALIASES[bookKey];

  if (!book) {
    // Try to find a partial match
    const normalized = bookKey.replace(/\s+/g, " ");
    const found = Object.entries(BOOK_ALIASES).find(
      ([key]) => key === normalized || normalized.startsWith(key)
    );
    if (!found) return null;
    return {
      book: found[1],
      chapter: parseInt(match[2], 10),
      verseStart: parseInt(match[3], 10),
      verseEnd: match[4] ? parseInt(match[4], 10) : undefined,
    };
  }

  return {
    book,
    chapter: parseInt(match[2], 10),
    verseStart: parseInt(match[3], 10),
    verseEnd: match[4] ? parseInt(match[4], 10) : undefined,
  };
}

/**
 * Normalize a reference to a canonical format for comparison.
 *
 * Examples:
 * - "Jn 3:16" → "John 3:16"
 * - "1 Jn 2:1-3" → "1 John 2:1-3"
 */
export function normalizeReference(ref: string): string | null {
  const parsed = parseReference(ref);
  if (!parsed) return null;

  const { book, chapter, verseStart, verseEnd } = parsed;
  if (verseEnd) {
    return `${book} ${chapter}:${verseStart}-${verseEnd}`;
  }
  return `${book} ${chapter}:${verseStart}`;
}

/**
 * Check if two references are in the same passage (book + chapter).
 */
export function isSamePassage(ref1: string, ref2: string): boolean {
  const parsed1 = parseReference(ref1);
  const parsed2 = parseReference(ref2);

  if (!parsed1 || !parsed2) return false;

  return parsed1.book === parsed2.book && parsed1.chapter === parsed2.chapter;
}

/**
 * Check if two references are exactly the same verse (or overlapping ranges).
 */
export function isSameVerse(ref1: string, ref2: string): boolean {
  const parsed1 = parseReference(ref1);
  const parsed2 = parseReference(ref2);

  if (!parsed1 || !parsed2) return false;

  // Different book or chapter = not same verse
  if (parsed1.book !== parsed2.book || parsed1.chapter !== parsed2.chapter) {
    return false;
  }

  // Check for verse overlap
  const start1 = parsed1.verseStart;
  const end1 = parsed1.verseEnd ?? parsed1.verseStart;
  const start2 = parsed2.verseStart;
  const end2 = parsed2.verseEnd ?? parsed2.verseStart;

  // Ranges overlap if one starts before the other ends
  return start1 <= end2 && start2 <= end1;
}

