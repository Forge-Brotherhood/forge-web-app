import { createHash } from "node:crypto";
import { z } from "zod";
import { parseReadingRef, type GuideBlockKind } from "@/lib/guide/uiBlocks";
import type { GoalShape } from "@/lib/goals/goalTypes";
import { goalCorpus, type GoalText } from "@/lib/heartbeat/terms";

/**
 * The kinds of activity the Guide can offer toward a goal. Adding a type is one entry here: what
 * the model supplies when it offers one, the card that goes with it, who it serves and how it is
 * worded. Everything else (the brief, the validation, the prompt) reads this table.
 */

type ShowBlockArgs = { kind: GuideBlockKind } & Record<string, unknown>;

/**
 * The part of a brief goal that a payload is checked against. Described here, not taken from the
 * brief schema, because the schema is built from this registry's type names.
 */
export type GoalFile = GoalText & {
  path: string[];
  nextReadings?: string[];
  completions?: Array<{ id: string; kind: "path_step" | "book"; label: string; at: string }>;
  noteExcerpts: string[];
};

/** What a payload is checked against: the goal it is for and the passages the person has read lately. */
export type ActivityContext = { goal: GoalFile; brief: { pulse: { passagesRead: string[] } } };

export type ActivityDefinition = {
  /** Who it serves. A beat may only offer it toward a goal of one of these shapes. */
  serves: readonly GoalShape[];
  /** What the model is told about it. */
  guidance: string;
  /** Done when. For the contract and the app; the app marks it, not the server. */
  doneWhen: string;
  /** The activity expires at the end of the local day this many days after the day it is for. */
  expiresAfterDays: number;
  /** False: only a beat that finds its own proof may post it. It is never planned ahead or scheduled from a chat. */
  plannable: boolean;
  /** What the model supplies when it offers this activity. */
  payload: z.ZodType<Record<string, unknown>>;
  /** The payload as the model is shown it. */
  payloadHint: string;
  /** The card that goes with the message, as show_block arguments. Absent: the message stands alone. */
  card?: (args: { goalId: string; payload: any; goal: GoalFile }) => ShowBlockArgs;
  /** A reason this payload cannot be used for this goal, or null. */
  check?: (payload: any, context: ActivityContext) => string | null;
  /** What the activity is recorded as being about, so a later beat can tell what was already offered. */
  noteFor?: (payload: any, goal: GoalFile) => string | undefined;
};

const define = <S extends z.ZodType<Record<string, unknown>>>(
  def: Omit<ActivityDefinition, "payload" | "card" | "check" | "noteFor"> & {
    payload: S;
    card?: (args: { goalId: string; payload: z.infer<S>; goal: GoalFile }) => ShowBlockArgs;
    check?: (payload: z.infer<S>, context: ActivityContext) => string | null;
    noteFor?: (payload: z.infer<S>, goal: GoalFile) => string | undefined;
  }
): ActivityDefinition => def as ActivityDefinition;

/** The chapters a reading reference covers, as BOOK:CHAPTER. */
const chaptersOf = (raw: string): string[] => {
  const ref = parseReadingRef(raw);
  if (!ref) return [];
  const run = ref.refKey.match(/^([^:]+):(\d+)-(\d+)$/);
  if (run) return Array.from({ length: Number(run[3]) - Number(run[2]) + 1 }, (_, i) => `${run[1]}:${Number(run[2]) + i}`);
  return [ref.refKey.split(":").slice(0, 2).join(":")];
};

/** Stable and short: two excerpts that read the same are the same excerpt. */
export const excerptKey = (excerpt: string): string =>
  createHash("sha1").update(excerpt.trim().replace(/\s+/g, " ").toLowerCase()).digest("hex").slice(0, 12);

/** Notes on a ledger entry that say what it was about. A later beat reads these. */
export const NOTE_PREFIX = { memorize: "verse:", note_recall: "excerpt:", milestone: "completion:" } as const;

const MAX_MEMORIZE_VERSES = 3;

export const ACTIVITY_REGISTRY = {
  reading: define({
    serves: ["finish", "practice", "learn", "grow"],
    guidance:
      "The next reading toward the goal. If the goal has nextReadings, offer one of those exactly. Otherwise pick one short passage that fits the goal. The message is a lead-in to the reading, two short paragraphs at most: why this passage today, in terms of the goal and their own reason for it; then one thing to read for and how to read it (slowly, aloud, stopping at a line that holds them). Build on what the goal's recentWork and thread show they marked, noted or wrote, in your own words: say 'you wrote' or 'you marked', never 'I noticed', and never say they read something. Never say or hint whether they have already read it, and never say they have not: you cannot see that. No figures, days or counts. In payload.focus, give the one thing to read for as a short plain line ('What the shepherd does for his sheep.'); the card shows it.",
    doneWhen: "The passage is read.",
    expiresAfterDays: 1,
    plannable: true,
    payload: z.object({ ref: z.string().trim().min(1).max(30), focus: z.string().trim().min(1).max(120).optional() }),
    payloadHint: '{"ref": "NUM:14" | "NUM:14-16" | "PSA:23:1-6", "focus"?: "one line to read for"}',
    card: ({ goalId, payload }) => ({ kind: "reading_card", goalId, ref_key: payload.ref, ...(payload.focus ? { focus: payload.focus } : {}) }),
    check: (payload, { goal }) => {
      const ref = parseReadingRef(payload.ref);
      if (!ref) return "invalid_ref";
      const next = goal.nextReadings ?? [];
      return next.length && !next.some((n) => parseReadingRef(n)?.refKey === ref.refKey) ? "ref_not_on_schedule" : null;
    },
  }),
  check_in: define({
    serves: ["practice", "grow"],
    guidance:
      "Ask how it is going, in one plain question, with no guilt and no figures. Offer 2 to 4 short answers the person might give, in their own voice. After a long quiet stretch, make it easy to say it has been hard.",
    doneWhen: "The person replies.",
    expiresAfterDays: 2,
    plannable: true,
    payload: z.object({ options: z.array(z.string().trim().min(1).max(60)).min(2).max(4) }),
    payloadHint: '{"options": ["Going well", "It has been hard", "..."]}',
    card: ({ goalId: _goalId, payload }) => ({ kind: "quick_replies", options: payload.options }),
  }),
  reflection: define({
    serves: ["learn", "grow"],
    guidance:
      "One question to write on, drawn from what the goal and the conversation are already about. One question only. Not a quiz and not a test of what they remember.",
    doneWhen: "The person saves a note.",
    expiresAfterDays: 2,
    plannable: true,
    payload: z.object({ prompt: z.string().trim().min(10).max(280) }),
    payloadHint: '{"prompt": "the one question"}',
    card: ({ goalId, payload }) => ({ kind: "prompt_card", goalId, prompt: payload.prompt }),
  }),
  prayer: define({
    serves: ["practice", "grow"],
    guidance:
      "A short prayer the person can pray, in the first person, that fits where the goal is. It is theirs to pray. You do not pray it for them and you do not promise to pray.",
    doneWhen: "The person marks it prayed.",
    expiresAfterDays: 1,
    plannable: true,
    payload: z.object({ title: z.string().trim().max(80).optional(), body: z.string().trim().min(20).max(600) }),
    payloadHint: '{"title": "optional", "body": "the prayer, first person"}',
    card: ({ payload }) => ({ kind: "prayer_card", ...(payload.title ? { title: payload.title } : {}), body: payload.body }),
  }),
  review: define({
    serves: ["finish", "practice", "learn", "grow"],
    guidance:
      "The weekly look back. Offer it only when the goal's state says a review is due (reason \"review\"), and instead of the day's other offer, never as well. Say in one or two plain sentences how the week was, in words: what held, what got hard. Never a figure, a score, a count of days or a streak. On a Grow goal say only where things stand, in words, and never measure anything. You may ask whether they want to change something about the path, but never as a matter of pace or speed; you do not change it. It is a look back with them, not a report on them. The card that follows fills in the rest from their own records. payload.note is one optional short line for the card.",
    doneWhen: "The person answers the card (Keep going or Change something) or replies in the thread.",
    expiresAfterDays: 2,
    plannable: true,
    payload: z.object({ note: z.string().trim().max(200).optional() }),
    payloadHint: '{"note": "optional, one short line, no figures"}',
    card: ({ goalId, payload }) => ({ kind: "recap_card", goalId, period: "week", ...(payload.note ? { note: payload.note } : {}) }),
  }),
  milestone: define({
    serves: ["finish", "practice", "learn"],
    guidance:
      "Marks something that is really finished: a path step or a book listed in the goal's completions. Offer it only with reason \"milestone\", naming that completion's id. Be glad with them, briefly, in one or two plain sentences, and do not turn it into a lesson or say what comes next. No figures, no scores, no streaks, no comparing to anyone. Never for a Grow goal. If the goal lists no completion, offer nothing.",
    doneWhen: "Nothing to do. The app marks it done when the thread is opened with the card in view.",
    expiresAfterDays: 1,
    plannable: false,
    payload: z.object({ completionId: z.string().trim().min(1).max(64) }),
    payloadHint: '{"completionId": "an id from the goal\'s completions"}',
    card: ({ goalId, payload }) => ({ kind: "milestone_card", goalId, completionId: payload.completionId }),
    check: (payload, { goal }) => {
      const completion = goal.completions?.find((c) => c.id === payload.completionId);
      if (!completion) return "no_completion";
      return completion.kind === "path_step" && !goal.path.includes(completion.label) ? "completion_not_on_path" : null;
    },
    noteFor: (payload) => `${NOTE_PREFIX.milestone}${payload.completionId}`,
  }),
  lesson: define({
    serves: ["learn"],
    guidance:
      "A short teaching prepared ahead for a Learn goal. Teach the next step on the goal's path, in order, building on what the thread shows they have already read. Your message is one or two plain sentences that lead into it. payload is the lesson itself: a short title, a category (historical, cultural, literary or geographic) and a body of 2 to 3 sentences of well-established background that helps the passage read the way its first readers heard it. Where scholars differ, say so plainly. Never state a fact you are not sure of; leave it out. No quiz, no homework.",
    doneWhen: "The person has read it. The app marks it done when the card is opened or the person replies.",
    expiresAfterDays: 2,
    plannable: true,
    payload: z.object({
      title: z.string().trim().min(1).max(60),
      category: z.enum(["historical", "cultural", "literary", "geographic"]),
      body: z.string().trim().min(40).max(700),
    }),
    payloadHint: '{"title": "Why Paul wrote Galatians", "category": "historical", "body": "2 to 3 sentences"}',
    card: ({ payload }) => ({ kind: "context_callout", category: payload.category, title: payload.title, body: payload.body }),
  }),
  memorize: define({
    serves: ["practice", "grow"],
    guidance:
      "A verse to carry, one to three verses, with a review later. The goal's state says whether to start a new verse or bring back the one in review; follow it exactly (a review uses that same ref). Choose a verse from the passages the goal and the thread have already been in. Say in one plain sentence what the verse is for. Invite, never test: no quiz, no 'can you say it', no score. The card shows the verse itself.",
    doneWhen: "The person opens the verse or replies in the thread.",
    expiresAfterDays: 2,
    plannable: true,
    payload: z.object({ ref: z.string().trim().min(1).max(30) }),
    payloadHint: '{"ref": "ROM:8:28" | "PSA:23:1-3"}',
    card: ({ payload }) => ({ kind: "passage_card", ref_key: payload.ref }),
    check: (payload) => {
      const ref = parseReadingRef(payload.ref);
      const verses = ref?.refKey.match(/^[^:]+:\d+:(\d+)(?:-(\d+))?$/);
      if (!ref || !verses) return "invalid_ref";
      return (verses[2] ? Number(verses[2]) - Number(verses[1]) + 1 : 1) > MAX_MEMORIZE_VERSES ? "verse_too_long" : null;
    },
    noteFor: (payload) => {
      const ref = parseReadingRef(payload.ref);
      return ref ? `${NOTE_PREFIX.memorize}${ref.refKey}` : undefined;
    },
  }),
  step: define({
    serves: ["grow"],
    guidance:
      "One practical thing to do today that comes straight out of a passage the goal or thread has already been in. Name the passage in payload.ref (it must be one of the goal's readings, the passages they read lately, or one the thread names). In the message say the one thing, plainly and small, and where it comes from. One thing only, never a list. An invitation, not an order: no 'you should', no 'you must'. Never measure it, count it or ask for a report back. It points toward grace and toward people, not toward performing.",
    doneWhen: "The person replies in the thread about it. There is no card, so a reply is the only signal.",
    expiresAfterDays: 2,
    plannable: true,
    payload: z.object({ ref: z.string().trim().min(1).max(30) }),
    payloadHint: '{"ref": "MAT:5" | "MAT:5:21-26"}',
    check: (payload, { goal, brief }) => {
      const ref = parseReadingRef(payload.ref);
      if (!ref) return "invalid_ref";
      const known = new Set([...brief.pulse.passagesRead.flatMap(chaptersOf), ...(goal.nextReadings ?? []).flatMap(chaptersOf)]);
      return chaptersOf(payload.ref).some((c) => known.has(c)) || goalCorpus(goal).includes(ref.reference) ? null : "passage_not_in_brief";
    },
  }),
  people: define({
    serves: ["grow"],
    guidance:
      "A step toward a real person: telling a friend, talking with a pastor, asking someone to walk with them. This matters most on a Grow goal, because you must not be the only one who knows. It is an invitation and never an assignment. Say it in one or two plain sentences, warmly, as something they might do when they are ready, never with a deadline, a task word or a report back. Name a person (payload.person) only if the thread or path already does. It is never the only thing you offer on a goal, so use it alongside the other activities, not instead of them.",
    doneWhen: "The person replies in the thread about it. There is no card.",
    expiresAfterDays: 2,
    plannable: true,
    payload: z.object({ person: z.string().trim().min(1).max(40).optional() }),
    payloadHint: '{"person": "optional, a name the thread already uses"}',
    // "your wife" names the wife the thread calls "my wife" or "his wife".
    check: (payload, { goal }) =>
      payload.person && !goalCorpus(goal).toLowerCase().includes(payload.person.toLowerCase().replace(/^(your|my|his|her|their) /, ""))
        ? "person_not_in_brief"
        : null,
  }),
  note_recall: define({
    serves: ["learn", "grow"],
    guidance:
      "Bring back something the person wrote. You may use only one of the goal's noteExcerpts, chosen by its position in that list (payload.excerptIndex, starting at 0); the app shows their own words, so never quote or describe them yourself. Your message is one plain sentence that says there is something of theirs to look at again, with no comment on what it says and no claim about how they have changed. Offer it only with a position the goal's state lists in availableExcerpts. If the goal has no noteExcerpts, offer nothing.",
    doneWhen: "The person opens the note or replies in the thread.",
    expiresAfterDays: 2,
    plannable: true,
    payload: z.object({ excerptIndex: z.number().int().min(0).max(4) }),
    payloadHint: '{"excerptIndex": 0}',
    card: ({ goalId, payload, goal }) => ({ kind: "note_recall", goalId, excerpt: goal.noteExcerpts[payload.excerptIndex].trim() }),
    check: (payload, { goal }) => (goal.noteExcerpts[payload.excerptIndex]?.trim() ? null : "no_excerpt"),
    noteFor: (payload, goal) => `${NOTE_PREFIX.note_recall}${excerptKey(goal.noteExcerpts[payload.excerptIndex])}`,
  }),
} satisfies Record<string, ActivityDefinition>;

export type ActivityType = keyof typeof ACTIVITY_REGISTRY;
export const ACTIVITY_TYPES = Object.keys(ACTIVITY_REGISTRY) as [ActivityType, ...ActivityType[]];

export const activityDefinition = (type: string): ActivityDefinition | undefined =>
  (ACTIVITY_REGISTRY as Record<string, ActivityDefinition>)[type];

/** The registry as the beat prompt describes it. */
export const describeActivityTypes = (): string =>
  ACTIVITY_TYPES.map((type) => {
    const def = ACTIVITY_REGISTRY[type];
    return `- ${type} (serves ${def.serves.join(", ")}). payload ${def.payloadHint}. ${def.guidance}`;
  }).join("\n");
