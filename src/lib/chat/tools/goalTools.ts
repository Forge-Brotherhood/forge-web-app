import { z } from "zod";
import { getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";
import type { ContextGoal } from "@/lib/chat/chatContextBundle";
import { looksInstructional, looksSensitive } from "@/lib/chat/tools/contextTools";
import {
  GOAL_CATEGORIES,
  GOAL_RHYTHMS,
  GOAL_SHAPES,
  MAX_ACTIVE_GOALS,
  MAX_CHAPTERS_PER_DAY,
  chaptersPerDaySchema,
} from "@/lib/goals/goalTypes";
import type { ContextToolCall, ResponsesTool } from "@/lib/openai/responsesClient";

/**
 * Tools the Guide uses to start, change and record progress on a user's goals. Goals live in the
 * user's own encrypted records, so these tools store nothing: each call is checked here and
 * handed back as a `goal` event for the app to apply.
 */

export const GOAL_TOOL_NAMES: ReadonlySet<string> = new Set(["set_goal", "update_goal", "log_progress"]);

export type GoalEvent =
  | {
      action: "create";
      goal: {
        title: string;
        why?: string;
        shape: (typeof GOAL_SHAPES)[number];
        category: (typeof GOAL_CATEGORIES)[number];
        rhythm?: (typeof GOAL_RHYTHMS)[number];
        reading?: { books: string[]; endDate?: string; chaptersPerDay?: number };
        path?: string[];
        status: "active" | "suggested";
      };
    }
  | {
      action: "update";
      goalId: string;
      changes: {
        title?: string;
        path?: string[];
        rhythm?: (typeof GOAL_RHYTHMS)[number];
        endDate?: string;
        status?: "paused" | "released" | "completed";
        workingNotes?: string;
        reading?: { books: string[]; endDate?: string; chaptersPerDay?: number };
        shape?: Exclude<(typeof GOAL_SHAPES)[number], "grow">;
      };
    }
  | {
      action: "log_progress";
      goalId: string;
      entry: { kind: "reading" | "practice" | "checkin"; ref?: string; note?: string; date: string };
    };

/** `statusIgnored` marks an update whose `status` was left out because the call also changed something else. */
export type GoalToolResult = { output: string; event?: GoalEvent; statusIgnored?: true };

const MAX_BOOKS = 66;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : undefined));

const requiredText = (max: number) => z.string().trim().min(1).max(max);

const isRealDate = (value: string): boolean => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(value);
};

const dayText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, "not a real date");

const pathSchema = z.array(requiredText(200)).min(1).max(12);

const readingSchema = z
  .object({
    books: z.array(z.string().trim().min(1).max(8)).min(1).max(MAX_BOOKS),
    endDate: dayText.nullish(),
    chaptersPerDay: chaptersPerDaySchema.nullish(),
  })
  .nullish();

const setGoalSchema = z.object({
  title: requiredText(120),
  why: optionalText(300),
  shape: z.enum(GOAL_SHAPES),
  category: z.enum(GOAL_CATEGORIES),
  rhythm: z.enum(GOAL_RHYTHMS).nullish(),
  reading: readingSchema,
  path: pathSchema.nullish(),
  status: z.enum(["active", "suggested"]),
  confidence: z.enum(["explicit", "strong", "weak"]),
});

const updateGoalSchema = z.object({
  goalId: requiredText(128),
  title: requiredText(120).nullish(),
  path: pathSchema.nullish(),
  rhythm: z.enum(GOAL_RHYTHMS).nullish(),
  endDate: dayText.nullish(),
  status: z.enum(["paused", "released", "completed"]).nullish(),
  workingNotes: optionalText(1000),
  reading: readingSchema,
  shape: z.enum(["finish", "practice", "learn"]).nullish(),
});

const logProgressSchema = z.object({
  goalId: requiredText(128),
  kind: z.enum(["reading", "practice", "checkin"]),
  ref: optionalText(20),
  note: optionalText(300),
  date: dayText,
});

/** A chapter (NUM:14) or a run of chapters (NUM:14-16), the way the app counts what was read. */
const parseChapterRef = (ref: string): string | null => {
  const m = ref.trim().toUpperCase().match(/^([1-3]?[A-Z]{2,3}):(\d{1,3})(?:-(\d{1,3}))?$/);
  if (!m || !getBookDisplayNameFromCode(m[1])) return null;
  const first = Number(m[2]);
  const last = m[3] ? Number(m[3]) : first;
  if (first < 1 || last < first) return null;
  return last === first ? `${m[1]}:${first}` : `${m[1]}:${first}-${last}`;
};

/** Book ids upper-cased and checked, repeats dropped; the first unknown id is named so the model can correct it. */
const checkReading = (
  input: { books: string[]; endDate?: string | null; chaptersPerDay?: number | null } | null | undefined
): { reading?: { books: string[]; endDate?: string; chaptersPerDay?: number }; unknown?: string } => {
  if (!input) return {};
  const books: string[] = [];
  for (const raw of input.books) {
    const code = raw.toUpperCase();
    if (!getBookDisplayNameFromCode(code)) return { unknown: raw };
    if (!books.includes(code)) books.push(code);
  }
  return {
    reading: {
      books,
      ...(input.endDate ? { endDate: input.endDate } : {}),
      ...(input.chaptersPerDay ? { chaptersPerDay: input.chaptersPerDay } : {}),
    },
  };
};

const refuse = (reason: string): GoalToolResult => ({ output: JSON.stringify({ ok: false, reason }) });

const accept = (event: GoalEvent): GoalToolResult => ({ output: JSON.stringify({ ok: true }), event });

/** The same checks as a memory note: no secrets, nothing that reads as an instruction to the model. */
const blocked = (texts: Array<string | undefined>): "sensitive" | "instruction_like" | null => {
  for (const text of texts) {
    if (!text) continue;
    if (looksSensitive(text)) return "sensitive";
    if (looksInstructional(text)) return "instruction_like";
  }
  return null;
};

const invalid = (error: z.ZodError): GoalToolResult =>
  refuse(`invalid_arguments: ${[...new Set(error.issues.map((i) => i.path.join(".") || "arguments"))].join(", ")}`);

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, i) => item === b[i]);

type Reading = { books: string[]; endDate?: string; chaptersPerDay?: number };

/** With a pace the end date is left to the app, which works it out from the chapters left. */
const withoutEndDateWhenPaced = (reading: Reading): Reading =>
  reading.chaptersPerDay ? { books: reading.books, chaptersPerDay: reading.chaptersPerDay } : reading;

const addDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Answers the goal tools for one request. A goal made earlier in the same request counts toward
 * the limit; `today` is the user's date, so a log for "today" is never refused as the future.
 */
export function createGoalToolRunner(args: {
  goals: ContextGoal[] | undefined;
  memoryEnabled?: boolean;
  today: string;
}): (call: ContextToolCall) => GoalToolResult {
  const goals = args.goals ?? [];
  const known = new Set(goals.map((g) => g.id));
  const titles = goals.map((g) => ({ id: g.id as string | undefined, title: g.title }));
  let activeCount = goals.length;

  const setGoal = (raw: unknown): GoalToolResult => {
    const parsed = setGoalSchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    const input = parsed.data;

    const text = blocked([input.title, input.why, ...(input.path ?? [])]);
    if (text) return refuse(text);

    // Only a goal the user stated may become active. Suggested goals need at least a strong signal,
    // and nothing is inferred about someone who has turned memory off.
    if (input.status === "active" && input.confidence !== "explicit") return refuse("confidence_not_explicit");
    if (input.status === "suggested") {
      if (input.confidence === "weak") return refuse("confidence_too_weak");
      if (args.memoryEnabled === false) return refuse("memory_off");
    }

    const { reading: checked, unknown } = checkReading(input.reading);
    if (unknown) return refuse(`unknown_book: ${unknown}`);
    const reading = checked && withoutEndDateWhenPaced(checked);

    if (titles.some((t) => sameTitle(t.title, input.title))) return refuse("already_a_goal");
    if (input.status === "active" && activeCount >= MAX_ACTIVE_GOALS) return refuse("goal_limit_reached");

    titles.push({ id: undefined, title: input.title });
    if (input.status === "active") activeCount += 1;
    return accept({
      action: "create",
      goal: {
        title: input.title,
        ...(input.why ? { why: input.why } : {}),
        shape: input.shape,
        category: input.category,
        ...(input.rhythm ? { rhythm: input.rhythm } : {}),
        ...(reading ? { reading } : {}),
        ...(input.path ? { path: input.path } : {}),
        status: input.status,
      },
    });
  };

  const updateGoal = (raw: unknown): GoalToolResult => {
    const parsed = updateGoalSchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    const input = parsed.data;
    const current = goals.find((g) => g.id === input.goalId);
    if (!current) return refuse("unknown_goal");
    // A Grow goal is about who someone is becoming, so it never turns into a plan with a figure.
    if (input.shape && current.shape === "grow") return refuse("grow_goal_shape_fixed");
    const { reading: checked, unknown } = checkReading(input.reading);
    if (unknown) return refuse(`unknown_book: ${unknown}`);

    // The model fills in fields nobody asked to change, so a field equal to the goal's current value
    // is left out. Only exact equality counts. Titles are compared with this request's renames too.
    const currentTitle = titles.find((t) => t.id === input.goalId)?.title ?? current.title;
    const currentReading = current.reading;
    const paced = Boolean(checked?.chaptersPerDay);
    const readingEcho =
      checked &&
      currentReading &&
      sameList(checked.books, currentReading.books) &&
      checked.endDate === currentReading.endDate &&
      checked.chaptersPerDay === currentReading.chaptersPerDay;
    // With a pace, the app works out the finish date: neither date is passed on.
    const reading = checked && !readingEcho ? withoutEndDateWhenPaced(checked) : undefined;
    const endDate = !paced && input.endDate && input.endDate !== currentReading?.endDate ? input.endDate : undefined;
    const title = input.title && !sameTitle(input.title, currentTitle) ? input.title : undefined;
    const path = input.path && !sameList(input.path, current.path) ? input.path : undefined;
    const rhythm = input.rhythm && input.rhythm !== current.rhythm ? input.rhythm : undefined;
    const shape = input.shape && input.shape !== current.shape ? input.shape : undefined;

    // Pausing, letting go or finishing a goal is something the user asks for on its own. Next to any
    // other field it is the model's own addition, so it is ignored.
    const statusIgnored = Boolean(
      input.status && (input.title || input.path || input.rhythm || input.endDate || input.reading || input.shape || input.workingNotes)
    );
    const status = statusIgnored ? undefined : input.status;

    const changes: Extract<GoalEvent, { action: "update" }>["changes"] = {
      ...(title ? { title } : {}),
      ...(path ? { path } : {}),
      ...(rhythm ? { rhythm } : {}),
      ...(endDate ? { endDate } : {}),
      ...(status ? { status } : {}),
      ...(input.workingNotes ? { workingNotes: input.workingNotes } : {}),
      ...(reading ? { reading } : {}),
      ...(shape ? { shape } : {}),
    };
    if (!Object.keys(changes).length) {
      // Asked for values the goal already has (say, saving steps it already holds): that is done,
      // not a failure, so the model must not tell the user it could not save. Nothing is changed.
      const asked = Boolean(
        input.title || input.path || input.rhythm || input.endDate || input.status || input.reading || input.shape || input.workingNotes
      );
      return asked ? { output: JSON.stringify({ ok: true, unchanged: true }) } : refuse("nothing_to_change");
    }
    const text = blocked([title, ...(path ?? []), input.workingNotes]);
    if (text) return refuse(text);

    // The goal's own title is fine; another goal's is not.
    if (title) {
      if (titles.some((t) => t.id !== input.goalId && sameTitle(t.title, title))) return refuse("already_a_goal");
      const own = titles.find((t) => t.id === input.goalId);
      if (own) own.title = title;
    }

    if (statusIgnored) return { ...accept({ action: "update", goalId: input.goalId, changes }), statusIgnored: true };
    return accept({ action: "update", goalId: input.goalId, changes });
  };

  const logProgress = (raw: unknown): GoalToolResult => {
    const parsed = logProgressSchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    const input = parsed.data;
    if (!known.has(input.goalId)) return refuse("unknown_goal");
    // A day ahead is allowed for users whose date is ahead of the one the app reported.
    if (input.date > addDays(args.today, 1)) return refuse("future_date");
    const text = blocked([input.note]);
    if (text) return refuse(text);

    // A reference only means something for reading, where it says which chapters were read.
    const ref = input.kind === "reading" && input.ref ? parseChapterRef(input.ref) : undefined;
    if (input.kind === "reading" && input.ref && !ref) return refuse("invalid_ref");

    return accept({
      action: "log_progress",
      goalId: input.goalId,
      entry: {
        kind: input.kind,
        ...(ref ? { ref } : {}),
        ...(input.note ? { note: input.note } : {}),
        date: input.date,
      },
    });
  };

  return (call) => {
    let raw: unknown;
    try {
      raw = JSON.parse(call.argumentsJson);
    } catch {
      return refuse("invalid_arguments: not valid JSON");
    }
    if (call.name === "set_goal") return setGoal(dropEmpty(raw));
    if (call.name === "update_goal") return updateGoal(dropEmpty(raw));
    if (call.name === "log_progress") return logProgress(dropEmpty(raw));
    return refuse("unknown_tool");
  };
}

/**
 * The model often fills a field it means to leave out with an empty placeholder (`""`, `[]`, `null`,
 * or an object holding only those). Such a value says nothing, so it is treated as not given; left
 * in, it fails validation and the model gives up after a few refusals. A field that is required
 * and empty is then simply missing, and is refused as before.
 */
const dropEmpty = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const kept: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (field === null || field === undefined) continue;
    if (typeof field === "string" && field.trim() === "") continue;
    if (Array.isArray(field)) {
      if (field.length) kept[key] = field;
      continue;
    }
    if (typeof field === "object") {
      const inner = dropEmpty(field);
      if (inner && Object.keys(inner as object).length) kept[key] = inner;
      continue;
    }
    kept[key] = field;
  }
  return kept;
};

const shapeProperty = { type: "string", enum: [...GOAL_SHAPES] };
const categoryProperty = { type: "string", enum: [...GOAL_CATEGORIES] };
const rhythmProperty = { type: "string", enum: [...GOAL_RHYTHMS] };
const pathProperty = (description: string) => ({
  type: "array",
  maxItems: 12,
  description,
  items: { type: "string", maxLength: 200 },
});

export const buildGoalTools = (): ResponsesTool[] => [
  {
    type: "function",
    name: "set_goal",
    description:
      "Start a goal for the user, in their words. Call it only when the user has plainly stated something they want to do or become in their life with God. Nothing is stored here; the app creates the goal and its conversation. For a reading goal, call it right away: work out reading.books from what they said (\"the Gospel of Mark\" is MRK) and reading.endDate from any length of time or date they gave (\"in 30 days\", \"by Christmas\") counted from today's date in <goals>. Do not ask for either when it is already implied. If they gave a pace instead (\"a chapter a day\", \"two chapters a morning\"), pass it as reading.chaptersPerDay and leave endDate out: the app works out the finish date, so never count chapters or dates from a pace yourself. If something is truly missing, ask one short plain question instead of calling, and never mention setup, fields or what the goal needs.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "shape", "category", "status", "confidence"],
      properties: {
        title: { type: "string", maxLength: 120, description: "The aim in the user's own words, without a duration, date, pace or counts, e.g. 'Read the Bible', not 'Read the Bible in a year': those live in the goal's schedule and the app shows them beside the title." },
        why: { type: "string", maxLength: 300, description: "Their reason, in their words. Only if they gave one." },
        shape: {
          ...shapeProperty,
          description:
            "finish: something to get through by a date (read the Bible in a year). practice: a rhythm to keep (pray every morning). learn: a subject to study (Paul's letters). grow: a change in who they are (overcome anger).",
        },
        category: categoryProperty,
        rhythm: rhythmProperty,
        reading: {
          type: "object",
          additionalProperties: false,
          required: ["books"],
          description: "Reading goals only: what to read.",
          properties: {
            books: {
              type: "array",
              maxItems: 66,
              description:
                "Book codes in reading order, taken from what they said: ['MRK'] for the Gospel of Mark, ['ROM','1CO'] and so on for Paul's letters, all 66 for the whole Bible.",
              items: { type: "string", maxLength: 8 },
            },
            endDate: {
              type: "string",
              description: "yyyy-MM-dd. Whenever they gave a length of time or a date, count it from today's date in <goals> and put it here. Leave it out when they gave only a pace.",
            },
            chaptersPerDay: {
              type: "integer",
              minimum: 1,
              maximum: MAX_CHAPTERS_PER_DAY,
              description: "Chapters a day, when they stated a pace (\"a chapter a day\" is 1). Without endDate the app works out the finish date from it; do not compute one yourself.",
            },
          },
        },
        path: pathProperty("Optional first steps, in order, as short plain titles. For a grow goal include a step toward a real person."),
        status: {
          type: "string",
          enum: ["active", "suggested"],
          description: "active when the user stated the goal. Use suggested only if you must record a goal they have not stated.",
        },
        confidence: {
          type: "string",
          enum: ["explicit", "strong", "weak"],
          description: "explicit only when the user said the goal themselves in this conversation.",
        },
      },
    },
  },
  {
    type: "function",
    name: "update_goal",
    description:
      "Change one of the user's active goals because they asked, or keep your own working notes on it. Use the goal id from the goals list. Also use it to give a reading goal that has no reading schedule one, once the user agrees, and to change the pace or finish date of one that has. When a change makes the goal's title wrong or misleading (a duration, date or pace in it that no longer matches, or the aim itself changed), pass title in the same call with the smallest change to the user's wording; also pass it when the user asks to rename the goal. Never for another reason. Include only the fields the user asked to change and leave every other field out; do not repeat the goal's current values.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["goalId"],
      properties: {
        goalId: { type: "string", description: "The id of the goal, from the goals list." },
        title: {
          type: "string",
          maxLength: 120,
          description: "A new name for the goal, in the user's own words and without a duration, date, pace or counts. Only when the old title has become wrong or misleading because of this change, or the user asked to rename it; otherwise leave it out. Never for a grow goal unless the user asks.",
        },
        path: pathProperty("The new steps, in order, replacing the old path. Only when the user asked to change the steps; otherwise leave it out."),
        rhythm: { ...rhythmProperty, description: "Only when the user asked to change how often; otherwise leave it out." },
        endDate: { type: "string", description: "yyyy-MM-dd, a new finish date. Only when the user asked to change the date; otherwise leave it out." },
        reading: {
          type: "object",
          additionalProperties: false,
          required: ["books"],
          description:
            "Set or replace the goal's reading schedule, for a reading goal the user has agreed to give one or whose pace or date they want changed. Always include books: take them from what they said, or from the goal's Reading schedule in <goals> when changing it. Pass endDate only for a length of time or date they gave, counted from today's date in <goals>. For a pace (\"a chapter a day\") pass chaptersPerDay and leave endDate out, so the app recomputes the finish date; never count chapters or dates from a pace yourself.",
          properties: {
            books: {
              type: "array",
              maxItems: 66,
              description: "Book codes in reading order, e.g. ['EXO'] or all 66 for the whole Bible.",
              items: { type: "string", maxLength: 8 },
            },
            endDate: { type: "string", description: "yyyy-MM-dd, when they want to finish. Leave it out when they gave only a pace." },
            chaptersPerDay: {
              type: "integer",
              minimum: 1,
              maximum: MAX_CHAPTERS_PER_DAY,
              description: "Chapters a day, when they stated a pace (\"two chapters a morning\" is 2). Without endDate the app works out the finish date.",
            },
          },
        },
        shape: {
          type: "string",
          enum: ["finish", "practice", "learn"],
          description: "Change what kind of goal this is. Set finish together with reading for a read-through goal. Never for a grow goal. Otherwise leave it out.",
        },
        status: { type: "string", enum: ["paused", "released", "completed"], description: "Only when the user asks to pause, let go of, or finish the goal, and then it must be the ONLY field in the call. Never add it to a call that changes anything else." },
        workingNotes: {
          type: "string",
          maxLength: 1000,
          description: "Your own short notes on this goal: what you are trying, what to watch for, what not to repeat. Replaces the old notes. Leave it out unless you are updating them.",
        },
      },
    },
  },
  {
    type: "function",
    name: "log_progress",
    description:
      "Record something the user tells you they did toward one of their goals that the app could not see, such as reading on paper. Never record something you assumed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["goalId", "kind", "date"],
      properties: {
        goalId: { type: "string", description: "The id of the goal, from the goals list." },
        kind: { type: "string", enum: ["reading", "practice", "checkin"] },
        ref: { type: "string", description: "reading only: the chapters read, as BOOK:CHAPTER or BOOK:FIRST-LAST, e.g. NUM:14 or NUM:14-16." },
        note: { type: "string", maxLength: 300, description: "What they said, in one short factual sentence." },
        date: { type: "string", description: "yyyy-MM-dd, the day it happened. Today's date unless they said otherwise." },
      },
    },
  },
];
