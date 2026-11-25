import { z } from "zod";
import { getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";

/** The words a goal is described in, shared by the chat request, the goal tools and the goal cards. */
export const GOAL_SHAPES = ["finish", "practice", "learn", "grow"] as const;
export type GoalShape = (typeof GOAL_SHAPES)[number];

export const GOAL_CATEGORIES = ["reading", "prayer", "community", "growth", "other"] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];

export const GOAL_RHYTHMS = ["daily", "few_per_week", "weekly"] as const;
export type GoalRhythm = (typeof GOAL_RHYTHMS)[number];

/** At most this many goals are active at once. The app enforces it; the server refuses a fourth. */
export const MAX_ACTIVE_GOALS = 3;

/** A reading goal's pace: whole chapters a day. The device works out the end date from it when none is given. */
export const MAX_CHAPTERS_PER_DAY = 20;
export const chaptersPerDaySchema = z.number().int().min(1).max(MAX_CHAPTERS_PER_DAY);

/** At most this many books in one plan: the whole Bible. */
export const MAX_READING_BOOKS = 66;
/** At most this many passages in one plan. */
export const MAX_READING_PASSAGES = 100;
/** What a plan of books hands out: a chapter at a time, or whole books. Passages are their own portions. */
export const READING_UNITS = ["chapter", "book"] as const;
/** The window a plan's pace is counted in. */
export const READING_PERIODS = ["day", "week"] as const;
/** Whether the portions must be read in the order given. */
export const READING_ORDERS = ["in_order", "any"] as const;
/** A plan's pace counted per period: chapters, books or passages a day or a week. */
export const perPeriodSchema = z.number().int().min(1).max(MAX_CHAPTERS_PER_DAY);

/** A reading plan as the app builds it: books or passages, and how they are spread. */
export type GoalReading = {
  books?: string[];
  passages?: string[];
  unit?: (typeof READING_UNITS)[number];
  period?: (typeof READING_PERIODS)[number];
  perPeriod?: number;
  order?: (typeof READING_ORDERS)[number];
  endDate?: string;
  chaptersPerDay?: number;
};

const isBook = (code: string) => Boolean(getBookDisplayNameFromCode(code));

const isRealDay = (value: string): boolean => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(value);
};

/**
 * A passage the way the app reads it: a chapter (`JHN:17`), a run of chapters (`MAT:5-7`) or verses
 * of one chapter (`MAT:6:9-13`). Upper-cased and tidied; null for anything else or an unknown book.
 */
export const parsePassageRef = (ref: string): string | null => {
  const m = ref
    .trim()
    .toUpperCase()
    .match(/^([1-3]?[A-Z]{2,3}):(\d{1,3})(?:-(\d{1,3})|:(\d{1,3})(?:-(\d{1,3}))?)?$/);
  if (!m || !isBook(m[1])) return null;
  const [, book, chapterText, lastChapterText, firstVerseText, lastVerseText] = m;
  const chapter = Number(chapterText);
  if (chapter < 1) return null;
  if (firstVerseText) {
    const first = Number(firstVerseText);
    const last = lastVerseText ? Number(lastVerseText) : first;
    if (first < 1 || last < first) return null;
    return last === first ? `${book}:${chapter}:${first}` : `${book}:${chapter}:${first}-${last}`;
  }
  const last = lastChapterText ? Number(lastChapterText) : chapter;
  if (last < chapter) return null;
  return last === chapter ? `${book}:${chapter}` : `${book}:${chapter}-${last}`;
};

/** A reading plan as the model sends it, to a goal tool or on a goal proposal. */
export const goalReadingSchema = z
  .object({
    books: z.array(z.string().trim().min(1).max(8)).max(MAX_READING_BOOKS).nullish(),
    passages: z.array(z.string().trim().min(1).max(20)).max(MAX_READING_PASSAGES).nullish(),
    unit: z.enum(READING_UNITS).nullish(),
    period: z.enum(READING_PERIODS).nullish(),
    perPeriod: perPeriodSchema.nullish(),
    order: z.enum(READING_ORDERS).nullish(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDay, "not a real date").nullish(),
    chaptersPerDay: chaptersPerDaySchema.nullish(),
  })
  .nullish();

/**
 * Book ids and passages upper-cased and checked, repeats dropped. The first bad one is named in
 * `refused` so the model can correct it. A plan with nothing to read is no plan: the model fills
 * the spread fields with placeholders (unit "chapter", period "day") when it means to leave it out.
 */
export const checkGoalReading = (input: z.infer<typeof goalReadingSchema>): { reading?: GoalReading; refused?: string } => {
  if (!input) return {};
  const books: string[] = [];
  for (const raw of input.books ?? []) {
    const code = raw.toUpperCase();
    if (!isBook(code)) return { refused: `unknown_book: ${raw}` };
    if (!books.includes(code)) books.push(code);
  }
  const passages: string[] = [];
  for (const raw of input.passages ?? []) {
    const ref = parsePassageRef(raw);
    if (!ref) return { refused: `invalid_passage: ${raw}` };
    // A pace in chapters a day reads a run of chapters one chapter at a time, not in one sitting.
    const run = input.chaptersPerDay ? ref.match(/^([^:]+):(\d+)-(\d+)$/) : null;
    const refs = run ? Array.from({ length: Number(run[3]) - Number(run[2]) + 1 }, (_, i) => `${run[1]}:${Number(run[2]) + i}`) : [ref];
    for (const one of refs) if (!passages.includes(one)) passages.push(one);
  }
  if (passages.length > MAX_READING_PASSAGES) return { refused: "too_many_passages" };
  if (!books.length && !passages.length) return {};
  return {
    reading: {
      ...(books.length ? { books } : {}),
      ...(passages.length ? { passages } : {}),
      // Defaults are left out, so a plan repeated with them reads as the same plan. Passages are
      // the plan's portions themselves, so a unit only matters for books.
      ...(input.unit === "book" && !passages.length ? { unit: input.unit } : {}),
      ...(input.period === "week" ? { period: input.period } : {}),
      ...(input.perPeriod ? { perPeriod: input.perPeriod } : {}),
      ...(input.order === "any" ? { order: input.order } : {}),
      ...(input.endDate ? { endDate: input.endDate } : {}),
      ...(input.chaptersPerDay ? { chaptersPerDay: input.chaptersPerDay } : {}),
    },
  };
};

/** The model-facing description of how a plan is spread beyond its books, for every tool that takes a plan. */
export const READING_PLAN_JSON_PROPERTIES = {
  passages: {
    type: "array",
    maxItems: MAX_READING_PASSAGES,
    description:
      "For a study of chosen passages rather than whole books (Jesus' prayers, the parables), the passages in the order to read them: BOOK:CHAPTER (JHN:17), a run of chapters BOOK:FIRST-LAST (MAT:5-7) or verses of one chapter BOOK:CHAPTER:FIRST-LAST (MAT:6:9-13). Each passage is one sitting, so a run of chapters is read all at once: to go through a run one chapter at a time (\"Psalm 120 to 134, one a day\"), list each chapter as its own passage (PSA:120, PSA:121, and so on). Leave books out unless whole books are read too.",
    items: { type: "string", maxLength: 20 },
  },
  unit: {
    type: "string",
    enum: [...READING_UNITS],
    description: "book when a whole book is read at a time (\"one of Paul's letters a week\"). Otherwise leave it out: books are read chapter by chapter.",
  },
  period: {
    type: "string",
    enum: [...READING_PERIODS],
    description: "week when their pace is counted by the week (\"a letter a week\", \"three chapters a week\"). Otherwise leave it out.",
  },
  perPeriod: {
    type: "integer",
    minimum: 1,
    maximum: MAX_CHAPTERS_PER_DAY,
    description:
      "How many books, passages or chapters each day or week, for any pace other than chapters a day (\"one letter a week\" is 1 with unit book and period week; \"a prayer a day\" is 1). Without endDate the app works out the finish date.",
  },
  order: {
    type: "string",
    enum: [...READING_ORDERS],
    description: "any when they may take the books or passages in whatever order they like (\"one of Paul's letters\"). Otherwise leave it out.",
  },
};
