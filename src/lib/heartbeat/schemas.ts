import { z } from "zod";
import { GOAL_CATEGORIES, GOAL_RHYTHMS, GOAL_SHAPES } from "@/lib/goals/goalTypes";
import { ACTIVITY_TYPES } from "@/lib/heartbeat/activityRegistry";
import type { GuideBlock } from "@/lib/guide/uiBlocks";

/**
 * The heartbeat's three shapes: the brief it reads, the activity it plans and posts, and the
 * output of one beat. All camelCase; days are yyyy-MM-dd in the user's own timezone, instants are
 * ISO 8601. Nothing here is stored on the server.
 */

const isRealDay = (value: string): boolean => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(value);
};

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDay, "not a real date");
export const instant = z.string().datetime({ offset: true });
export const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const timeZone = z.string().min(1).max(64).refine(isTimeZone, "not a timezone");

export const ACTIVITY_STATUSES = ["planned", "posted", "started", "done", "skipped", "expired"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** About 8,000 tokens, at roughly four characters a token. The brief is rejected above this. */
export const BRIEF_MAX_CHARS = 32_000;

// MARK: - The brief

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(600),
  at: instant,
});

/** One line of a goal's activity ledger: what was offered and what became of it. */
const ledgerEntrySchema = z.object({
  id: z.string().min(1).max(160),
  type: z.enum(ACTIVITY_TYPES),
  status: z.enum(ACTIVITY_STATUSES),
  scheduledFor: day,
  scheduledTime: clock.optional(),
  expiresAt: instant,
  postedAt: instant.optional(),
  /** What a planned activity is for, when it was scheduled from a promise. */
  note: z.string().max(160).optional(),
  outcome: z.object({ at: instant, note: z.string().max(80).optional() }).optional(),
});

const openLoopSchema = z.object({
  kind: z.enum(["question", "promise"]),
  text: z.string().min(1).max(200),
  at: instant.optional(),
});

const goalFileSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  why: z.string().max(300).optional(),
  shape: z.enum(GOAL_SHAPES),
  category: z.enum(GOAL_CATEGORIES),
  rhythm: z.enum(GOAL_RHYTHMS),
  targetDate: day.optional(),
  /** True: never named in a notification. When absent, Grow goals are discreet and others are not. */
  discreet: z.boolean().optional(),
  /** Step titles, in order. */
  path: z.array(z.string().max(120)).max(12),
  /** Written on the device. */
  progressSummary: z.string().max(300),
  /** Reading goals: the next readings on the schedule, soonest first, as BOOK:CHAPTER or BOOK:FIRST-LAST. */
  nextReadings: z.array(z.string().max(30)).max(3).optional(),
  /** The last time the user did anything on the goal. */
  lastActivityAt: instant.optional(),
  workingNotes: z.string().max(1000).optional(),
  /**
   * Things the device has checked are really finished and are not yet marked: a path step done or a
   * book completed, in the last 14 days. Never for a Grow goal. The only proof a milestone has.
   */
  completions: z
    .array(z.object({ id: z.string().min(1).max(64), kind: z.enum(["path_step", "book"]), label: z.string().min(1).max(80), at: instant }))
    .max(5)
    .optional(),
  thread: z.object({
    summary: z.string().max(1500).optional(),
    /** The last 12 or so turns, word for word, oldest first. */
    turns: z.array(turnSchema).max(12),
  }),
  /** The last 20 activities, planned ones included, oldest first. */
  activities: z.array(ledgerEntrySchema).max(20),
  openLoops: z.array(openLoopSchema).max(5),
  relatedMemory: z.array(z.string().max(200)).max(6),
  noteExcerpts: z.array(z.string().max(240)).max(5),
});

export const briefSchema = z
  .object({
    v: z.literal(1),
    person: z.object({
      firstName: z.string().max(60).optional(),
      tone: z.string().max(40).optional(),
      depth: z.string().max(40).optional(),
      experience: z.string().max(40).optional(),
      studyIntent: z.array(z.string().max(40)).max(8).optional(),
      /** anxious, grieving, discerning, thankful, lonely, struggling or seeking_discipline. */
      season: z.string().max(40).optional(),
      seasonNote: z.string().max(200).optional(),
      carrying: z.string().max(300).optional(),
      hoping: z.string().max(300).optional(),
      busyDays: z.array(z.enum(WEEKDAYS)).max(7).optional(),
      /** The time of day they like to be reached, HH:mm. */
      preferredTime: clock.optional(),
      timezone: timeZone,
      /** Local time. The range may cross midnight (21:30 to 07:00). */
      quietHours: z.object({ start: clock, end: clock }),
    }),
    pulse: z.object({
      /** Days in the last 14 on which the app was opened. */
      daysOpened: z.number().int().min(0).max(14),
      /** References only, BOOK:CHAPTER. */
      passagesRead: z.array(z.string().max(30)).max(20),
      /** Conversations outside goal threads. */
      conversations: z
        .array(z.object({ at: instant, summary: z.string().max(200), concerns: z.array(z.string().max(100)).max(3) }))
        .max(5),
    }),
    goals: z.array(goalFileSchema).max(3),
    /** The last 10 notifications, newest first. */
    outreach: z.object({
      recent: z
        .array(
          z.object({
            at: instant,
            goalId: z.string().max(128).optional(),
            text: z.string().max(120),
            opened: z.boolean().nullable(),
          })
        )
        .max(10),
    }),
    /** What the user has said about how they want to be helped, in their words. */
    wishes: z.array(z.string().max(160)).max(10),
    /** When a device last wrote each section. */
    freshness: z.object({ person: instant, pulse: instant, goals: instant, outreach: instant, wishes: instant }),
  })
  .superRefine((brief, ctx) => {
    if (new Set(brief.goals.map((g) => g.id)).size !== brief.goals.length) {
      ctx.addIssue({ code: "custom", path: ["goals"], message: "goal ids must be distinct" });
    }
    if (JSON.stringify(brief).length > BRIEF_MAX_CHARS) {
      ctx.addIssue({ code: "custom", message: `the brief is over ${BRIEF_MAX_CHARS} characters` });
    }
  });

export type Brief = z.infer<typeof briefSchema>;
export type GoalFile = Brief["goals"][number];
export type LedgerEntry = GoalFile["activities"][number];

// MARK: - Activity

const cardSchema = z.custom<GuideBlock>(
  (v) => typeof v === "object" && v !== null && typeof (v as any).id === "string" && typeof (v as any).kind === "string"
);

/** The record behind a message the Guide offers: what gets scheduled, deduplicated and marked done. */
export const activitySchema = z.object({
  /** goalId:type:scheduledFor, so a repeated beat cannot duplicate it. */
  id: z.string().min(1).max(160),
  goalId: z.string().min(1).max(128),
  type: z.enum(ACTIVITY_TYPES),
  status: z.enum(ACTIVITY_STATUSES),
  scheduledFor: day,
  scheduledTime: clock.optional(),
  expiresAt: instant,
  /** What the Guide says in the thread. Set when the activity is posted. */
  message: z.string().max(400).optional(),
  /** The card shown with it. Set when the activity is posted. */
  card: cardSchema.optional(),
  /** Set if this one earns a notification. */
  notify: z.object({ at: instant, text: z.string().min(1).max(100) }).optional(),
  postedAt: instant.optional(),
  /** What a planned activity is for, when it was scheduled from a promise. */
  note: z.string().max(160).optional(),
  outcome: z.object({ at: instant, note: z.string().max(300).optional(), noteId: z.string().max(128).optional() }).optional(),
});

export type Activity = z.infer<typeof activitySchema>;

// MARK: - The beat

/** Why the app is asking. Only `app_open` may post; the others may plan. */
export const BEAT_TRIGGERS = ["app_open", "thread_turn", "activity_done", "goal_change"] as const;
/** The server's own clock (the cron run). It may post, like `app_open`, and is never accepted from a device. */
export const HEARTBEAT_TRIGGER = "heartbeat" as const;
export type BeatTrigger = (typeof BEAT_TRIGGERS)[number] | typeof HEARTBEAT_TRIGGER;

export const beatRequestSchema = z.object({ brief: briefSchema, trigger: z.enum(BEAT_TRIGGERS) });
export type BeatRequest = z.infer<typeof beatRequestSchema>;

export const POST_REASONS = ["due", "rhythm", "follow_up", "caring_word", "gentle_word", "review", "milestone"] as const;
export type PostReason = (typeof POST_REASONS)[number];

export const STALENESS_TIERS = ["fresh", "aging", "gentle", "lapsed"] as const;
export type Staleness = (typeof STALENESS_TIERS)[number];

export const beatOutputSchema = z.object({
  v: z.literal(1),
  /** The only goal change a beat can make: a lighter rhythm. */
  goalChanges: z.array(z.object({ goalId: z.string(), rhythm: z.enum(GOAL_RHYTHMS) })),
  activities: z.array(
    z.discriminatedUnion("action", [
      /** Upsert by `activity.id`. Planned for a later time, or posted now with its message and card. */
      z.object({ action: z.literal("create"), activity: activitySchema }),
      z.object({ action: z.literal("reschedule"), activityId: z.string(), scheduledFor: day, scheduledTime: clock.optional() }),
      z.object({ action: z.literal("cancel"), activityId: z.string() }),
    ])
  ),
  /** Messages for the goal threads. `id` is stable: the app adds a post it has not already added. */
  posts: z.array(
    z.object({
      id: z.string(),
      goalId: z.string(),
      activityId: z.string().optional(),
      message: z.string(),
      card: cardSchema.optional(),
      notify: z.object({ at: instant, text: z.string() }).optional(),
      reason: z.enum(POST_REASONS),
    })
  ),
  workingNotes: z.array(z.object({ goalId: z.string(), workingNotes: z.string().max(1000) })),
  /** The earliest time another beat could have something to do. */
  nextBeatAt: instant,
  /** Counts and codes only. Nothing the user wrote. */
  meta: z.object({
    staleness: z.enum(STALENESS_TIERS),
    careMode: z.boolean(),
    modelCalled: z.boolean(),
    dropped: z.array(z.object({ what: z.string(), code: z.string() })),
  }),
});

export type BeatOutput = z.infer<typeof beatOutputSchema>;
export type BeatPost = BeatOutput["posts"][number];

// MARK: - What the model returns

/** The model's answer, before any of it is checked. Each item is checked on its own. */
export const modelOutputSchema = z.object({
  workingNotes: z.array(z.unknown()).max(6).optional(),
  goalChanges: z.array(z.unknown()).max(6).optional(),
  plan: z.array(z.unknown()).max(12).optional(),
  posts: z.array(z.unknown()).max(6).optional(),
});

export const modelPostSchema = z.object({
  goalId: z.string().min(1).max(128),
  reason: z.enum(POST_REASONS),
  message: z.string().trim().min(1).max(600),
  type: z.enum(ACTIVITY_TYPES).nullish(),
  payload: z.record(z.string(), z.unknown()).nullish(),
  notify: z.object({ text: z.string().trim().min(1).max(200) }).nullish(),
});

export const modelPlanSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    goalId: z.string().min(1).max(128),
    type: z.enum(ACTIVITY_TYPES),
    date: day,
    time: clock.nullish(),
    note: z.string().trim().max(160).nullish(),
    notify: z.object({ text: z.string().trim().min(1).max(200) }).nullish(),
  }),
  z.object({ action: z.literal("reschedule"), activityId: z.string().min(1).max(160), date: day, time: clock.nullish() }),
  z.object({ action: z.literal("cancel"), activityId: z.string().min(1).max(160) }),
]);

export const modelWorkingNotesSchema = z.object({ goalId: z.string().min(1).max(128), notes: z.string().trim().min(1).max(1000) });
export const modelGoalChangeSchema = z.object({ goalId: z.string().min(1).max(128), rhythm: z.enum(GOAL_RHYTHMS) });
