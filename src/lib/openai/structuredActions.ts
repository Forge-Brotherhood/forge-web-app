import { BOOK_NAME_TO_CODE } from "@/lib/bible/bookCodes";
import { getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";

export type AIActionType = "NAVIGATE_TO_VERSE";
export type AIActionPriority = "secondary";

export type AIAction = {
  id: string;
  type: AIActionType;
  version: 1;
  params: {
    reference: string;
    reason?: string;
    translation?: string;
  };
  resolved?: null;
  confidence?: number;
  priority: AIActionPriority;
  icon: "book.fill";
  color: "orange";
};

export type UiActionsPayload = {
  actions: AIAction[];
};

type ParsedVerseRef = {
  bookId: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
};

type ParsedChapterRef = {
  bookId: string;
  chapter: number;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeBookId = (bookIdRaw: string): string => {
  const trimmed = bookIdRaw.trim();
  if (!trimmed) return trimmed;
  const noDot = trimmed.replace(/\.+$/g, "").trim();
  const upper = trimmed.toUpperCase();
  if (/^(?:[A-Z]{3}|[1-3][A-Z]{2})$/.test(upper)) return upper;

  const lower = noDot.toLowerCase().replace(/\s+/g, " ").trim();

  // Common abbreviations (best-effort; avoids missing actions when assistant uses shorthand).
  // These are intentionally conservative; if unknown, we fall back to raw.
  const abbrevMap: Record<string, string> = {
    rom: "ROM",
    phil: "PHP",
    eph: "EPH",
    gal: "GAL",
    col: "COL",
    heb: "HEB",
    jas: "JAS",
    rev: "REV",
    gen: "GEN",
    ex: "EXO",
    exo: "EXO",
    lev: "LEV",
    num: "NUM",
    deut: "DEU",
    ps: "PSA",
    psa: "PSA",
    prov: "PRO",
    pr: "PRO",
    matt: "MAT",
    mat: "MAT",
    mk: "MRK",
    mrk: "MRK",
    lk: "LUK",
    luk: "LUK",
    jn: "JHN",
    john: "JHN",
    acts: "ACT",
    act: "ACT",
  };

  const mapped = BOOK_NAME_TO_CODE[lower] ?? abbrevMap[lower];
  return mapped ?? noDot;
};

const parseVerseRef = (ref: string): ParsedVerseRef | null => {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  // Input should already be a book+verse ref. We still parse defensively.
  // e.g. "Romans 8:1-4", "Philippians 1:1–12", "Rom. 8:1"
  const m = trimmed.match(/^(.+?)\s*(\d{1,3}):(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/);
  if (!m) return null;

  const bookRaw = String(m[1] ?? "").trim();
  const chapter = Number(m[2]);
  const verseStart = Number(m[3]);
  const verseEnd = m[4] ? Number(m[4]) : verseStart;

  if (!Number.isFinite(chapter) || !Number.isFinite(verseStart) || !Number.isFinite(verseEnd)) return null;
  if (chapter < 1 || verseStart < 1 || verseEnd < verseStart) return null;

  const bookId = normalizeBookId(bookRaw);
  if (!/^(?:[A-Z]{3}|[1-3][A-Z]{2})$/.test(bookId)) return null;

  return { bookId, chapter, verseStart, verseEnd };
};

const BOOK_ALT = (() => {
  // Build an alternation of known book names + common abbreviations to avoid greedy matches.
  const names = Object.keys(BOOK_NAME_TO_CODE);
  const abbrevs = [
    "rom",
    "phil",
    "eph",
    "gal",
    "col",
    "heb",
    "jas",
    "rev",
    "gen",
    "ex",
    "exo",
    "lev",
    "num",
    "deut",
    "ps",
    "psa",
    "prov",
    "pr",
    "matt",
    "mat",
    "mk",
    "mrk",
    "lk",
    "luk",
    "jn",
    "act",
  ];
  const all = [...new Set([...names, ...abbrevs])];

  // Sort longest-first so multi-word books win.
  all.sort((a, b) => b.length - a.length);

  return all
    .map((name) => escapeRegExp(name).replace(/\\\s+/g, "\\s+"))
    .join("|");
})();

const findBookVerseRefs = (text: string): string[] => {
  // Match known Bible books + chapter:verse (case-insensitive).
  // Allows optional trailing dot in abbreviations, and optional whitespace before chapter.
  const re = new RegExp(
    `\\b(?:${BOOK_ALT})\\.?\\s*\\d{1,3}:\\d{1,3}(?:\\s*[-–]\\s*\\d{1,3})?\\b`,
    "gi"
  );
  const matches = text.match(re) ?? [];
  return matches.map((m) => m.trim());
};

const findBareChapterVerseRefs = (text: string): string[] => {
  // Match chapter:verse without a book (e.g., "8:5-11"), commonly used after a book was mentioned.
  const re = /\b\d{1,3}:\d{1,3}(?:\s*[-–]\s*\d{1,3})?\b/g;
  const matches = text.match(re) ?? [];
  return matches.map((m) => m.trim());
};

const parseBareChapterVerseRef = (
  ref: string,
  context: { bookId: string } | null
): ParsedVerseRef | null => {
  if (!context) return null;
  const trimmed = ref.trim();
  const m = trimmed.match(/^(\d{1,3}):(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/);
  if (!m) return null;
  const chapter = Number(m[1]);
  const verseStart = Number(m[2]);
  const verseEnd = m[3] ? Number(m[3]) : verseStart;
  if (!Number.isFinite(chapter) || !Number.isFinite(verseStart) || !Number.isFinite(verseEnd)) return null;
  if (chapter < 1 || verseStart < 1 || verseEnd < verseStart) return null;
  return { bookId: context.bookId, chapter, verseStart, verseEnd };
};

const parseChapterRef = (ref: string): ParsedChapterRef | null => {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  // e.g. "Psalm 121", "Psalms 121", "Ps 121", "Rom 8"
  const m = trimmed.match(/^(.+?)\s+(\d{1,3})$/);
  if (!m) return null;
  const bookRaw = String(m[1] ?? "").trim();
  const chapter = Number(m[2]);
  if (!Number.isFinite(chapter) || chapter < 1) return null;
  const bookId = normalizeBookId(bookRaw);
  if (!/^(?:[A-Z]{3}|[1-3][A-Z]{2})$/.test(bookId)) return null;
  return { bookId, chapter };
};

const uniqueByKey = <T,>(items: T[], keyFn: (t: T) => string): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = keyFn(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
};

const toVerseReferenceString = (ref: ParsedVerseRef): string => {
  const bookName = getBookDisplayNameFromCode(ref.bookId) ?? ref.bookId;
  const range =
    ref.verseEnd === ref.verseStart
      ? `${ref.chapter}:${ref.verseStart}`
      : `${ref.chapter}:${ref.verseStart}-${ref.verseEnd}`;
  return `${bookName} ${range}`;
};

const toChapterReferenceString = (ref: ParsedChapterRef): string => {
  const bookName = getBookDisplayNameFromCode(ref.bookId) ?? ref.bookId;
  return `${bookName} ${ref.chapter}`;
};

const makeNavigateToVerseAction = (reference: string, confidence: number): AIAction => {
  const id = `NAVIGATE_TO_VERSE:${reference}`;
  return {
    id,
    type: "NAVIGATE_TO_VERSE",
    version: 1,
    params: { reference },
    resolved: null,
    confidence,
    priority: "secondary",
    icon: "book.fill",
    color: "orange",
  };
};

export const extractUiActionsDeterministic = (args: {
  answerText: string;
  verseReference?: string;
}): AIAction[] => {
  const answer = args.answerText.trim();
  if (!answer) return [];

  // Permissive deterministic extraction: every verse/chapter reference gets an action.
  const contextParsed =
    typeof args.verseReference === "string" && args.verseReference.trim()
      ? parseVerseRef(args.verseReference.trim())
      : null;

  const refs = [...findBookVerseRefs(answer)];
  const bareRefs = findBareChapterVerseRefs(answer);
  const chapterRefs = (() => {
    const re = new RegExp(`\\b(?:${BOOK_ALT})\\.?\\s+\\d{1,3}\\b(?!\\s*:)`, "gi");
    return (answer.match(re) ?? []).map((m) => m.trim());
  })();

  return uniqueByKey(
    [
      ...refs
        .map((r) => parseVerseRef(r))
        .filter((x): x is ParsedVerseRef => Boolean(x)),
      ...bareRefs
        .map((r) => parseBareChapterVerseRef(r, contextParsed ? { bookId: contextParsed.bookId } : null))
        .filter((x): x is ParsedVerseRef => Boolean(x)),
      ...(contextParsed ? [contextParsed] : []),
      ...chapterRefs
        .map((r) => parseChapterRef(r))
        .filter((x): x is ParsedChapterRef => Boolean(x)),
    ]
      .map((x) => {
        if ("verseStart" in x) {
          const ref = x as ParsedVerseRef;
          return makeNavigateToVerseAction(toVerseReferenceString(ref), 0.95);
        }
        const ref = x as ParsedChapterRef;
        return makeNavigateToVerseAction(toChapterReferenceString(ref), 0.95);
      }),
    (a) => a.id
  ).slice(0, 15);
};


