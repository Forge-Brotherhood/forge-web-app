import { z } from "zod";
import { getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";
import { TOOL_ENABLED_GUIDE_SYSTEM_PROMPT } from "@/lib/chat/toolEnabledSystemPrompt";
import type { ResponsesInputMessage } from "@/lib/openai/responsesClient";
import {
  GOAL_CATEGORIES,
  GOAL_RHYTHMS,
  GOAL_SHAPES,
  MAX_ACTIVE_GOALS,
  MAX_READING_BOOKS,
  MAX_READING_PASSAGES,
  READING_ORDERS,
  READING_PERIODS,
  READING_UNITS,
  chaptersPerDaySchema,
  parsePassageRef,
  perPeriodSchema,
  type GoalShape,
} from "@/lib/goals/goalTypes";

export type ChatEntrypoint = "bible_reader" | "home" | "community" | "goal_thread" | "other";
export type ChatMode = "general" | "bible";

const noteSchema = z.object({
  text: z.string().min(1).max(400),
  keywords: z.array(z.string().max(40)).max(8).optional(),
});

/**
 * A goal's reading schedule, as the app stores it. Lenient on purpose: a goal that is already
 * stored must never make a request fail, so unknown book ids, bad passages and other bad values
 * are dropped here rather than refused, and a schedule with nothing to read is treated as none.
 */
const readingSchema = z
  .object({
    books: z.array(z.unknown()).optional(),
    passages: z.array(z.unknown()).optional(),
    unit: z.unknown().optional(),
    period: z.unknown().optional(),
    perPeriod: z.unknown().optional(),
    order: z.unknown().optional(),
    endDate: z.unknown().optional(),
    chaptersPerDay: z.unknown().optional(),
  })
  .nullish()
  .transform((value) => {
    if (!value) return undefined;
    const books: string[] = [];
    for (const raw of value.books ?? []) {
      if (typeof raw !== "string") continue;
      const code = raw.trim().toUpperCase();
      if (getBookDisplayNameFromCode(code) && !books.includes(code)) books.push(code);
      if (books.length === MAX_READING_BOOKS) break;
    }
    const passages: string[] = [];
    for (const raw of value.passages ?? []) {
      const ref = typeof raw === "string" ? parsePassageRef(raw) : null;
      if (ref && !passages.includes(ref)) passages.push(ref);
      if (passages.length === MAX_READING_PASSAGES) break;
    }
    if (!books.length && !passages.length) return undefined;
    const endDate = typeof value.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.endDate) ? value.endDate : undefined;
    const pace = chaptersPerDaySchema.safeParse(value.chaptersPerDay);
    const perPeriod = perPeriodSchema.safeParse(value.perPeriod);
    const unit = z.enum(READING_UNITS).safeParse(value.unit);
    const period = z.enum(READING_PERIODS).safeParse(value.period);
    const order = z.enum(READING_ORDERS).safeParse(value.order);
    return {
      ...(books.length ? { books } : {}),
      ...(passages.length ? { passages } : {}),
      ...(unit.success ? { unit: unit.data } : {}),
      ...(period.success ? { period: period.data } : {}),
      ...(perPeriod.success ? { perPeriod: perPeriod.data } : {}),
      ...(order.success ? { order: order.data } : {}),
      ...(endDate ? { endDate } : {}),
      ...(pace.success ? { chaptersPerDay: pace.data } : {}),
    };
  })
  .optional();

/** An active goal, as the app describes it for this request. `progressSummary` is written on the device. */
const goalSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  why: z.string().max(500).optional(),
  shape: z.enum(GOAL_SHAPES),
  category: z.enum(GOAL_CATEGORIES),
  rhythm: z.enum(GOAL_RHYTHMS).optional(),
  /** Present only when the goal already has a reading schedule. */
  reading: readingSchema,
  /** Step titles, in order. */
  path: z.array(z.string().max(200)).max(12),
  progressSummary: z.string().max(300),
  workingNotes: z.string().max(1000).optional(),
});

/** The goal conversation this request belongs to. `summary` stands in for the turns left out of `history`. */
/** A `BOOK:CHAPTER` or `BOOK:CHAPTER:VERSE[-VERSE]` reference, as the app writes it. */
const refKey = z.string().trim().min(1).max(30);

export const goalThreadSchema = z.object({
  goalId: z.string().min(1).max(128),
  summary: z.string().max(2000).optional(),
  /**
   * Sent with GOAL_THREAD_REFLECT: the reading just done on this goal and what the user made while
   * reading it, read from their own records on the device. Kept nowhere.
   */
  reflection: z
    .object({
      ref: refKey,
      made: z.object({
        highlights: z.array(refKey).max(8),
        notes: z.array(z.object({ ref: refKey, text: z.string().max(240) })).max(4),
        questions: z.array(z.string().max(300)).max(4),
        minutes: z.number().int().min(0).max(600).optional(),
      }),
    })
    .optional(),
  /** The last three reminders to reflect on this goal went unopened; Lumen asks once whether they help. */
  remindersUnopened: z.boolean().optional(),
});

/**
 * Set while the conversation is setting up a new goal ("New goal" in the app), until the goal is
 * made and the conversation becomes its thread. Read from the user's own records on the device
 * for this request; kept nowhere.
 */
export const goalSetupSchema = z.object({
  /** Goals Lumen noticed in past conversations that the user has not said yes or no to. */
  noticed: z.array(z.string().trim().min(1).max(120)).max(3).default([]),
  /** Chapters read lately, most recent first, as `BOOK:CHAPTER`. */
  recentReading: z.array(refKey).max(8).default([]),
});

export type ContextGoal = z.infer<typeof goalSchema>;
export type GoalThread = z.infer<typeof goalThreadSchema>;
export type GoalSetup = z.infer<typeof goalSetupSchema>;

/** Sent by the app as the first message of a new goal thread; the Guide then opens the thread. */
export const GOAL_THREAD_START_MESSAGE = "GOAL_THREAD_START";

/** Sent by the app, hidden, as the first message of a goal setup conversation; the Guide then asks what they want to work toward. */
export const GOAL_SETUP_START_MESSAGE = "GOAL_SETUP_START";

/** Sent by the app, hidden, when the user comes back to a goal's thread after its reading; the Guide then begins a reflection. */
export const GOAL_THREAD_REFLECT_MESSAGE = "GOAL_THREAD_REFLECT";

/**
 * What the Guide knows about the user for this request. The app sends it each time, read from
 * the user's own encrypted records; the server keeps none of it.
 */
export const chatContextSchema = z.object({
  profile: z
    .object({
      name: z.string().max(100).optional(),
      preferredTranslation: z.string().max(20).optional(),
      explanationStyle: z.string().max(40).optional(),
      experienceLevel: z.string().max(40).optional(),
      studyIntent: z.array(z.string().max(40)).max(8).optional(),
      season: z.string().max(40).optional(),
      seasonNote: z.string().max(200).optional(),
      weeklyCarrying: z.string().max(500).optional(),
      weeklyHoping: z.string().max(500).optional(),
      prayerTopics: z.array(z.string().max(200)).max(5).optional(),
    })
    .optional(),
  /** False when the user has turned memory off. */
  memoryEnabled: z.boolean().optional(),
  sessionNotes: z.array(noteSchema).max(20).optional(),
  globalNotes: z.array(noteSchema).max(20).optional(),
  /** The user's active goals (the app keeps at most 3). */
  goals: z.array(goalSchema).max(MAX_ACTIVE_GOALS).optional(),
  /** The user's local date (yyyy-MM-dd), so "today" in a goal is theirs and not the server's. */
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type ChatContext = z.infer<typeof chatContextSchema>;

type MemoryNote = z.infer<typeof noteSchema>;

export type ChatContextBundle = {
  /** The profile and memory blocks, as given to the model. */
  injectedInstructions: string;
  /** System messages for this request. They are rebuilt each time and never part of the history. */
  instructions: ResponsesInputMessage[];
  /** What the user's message adds to the conversation. */
  input: ResponsesInputMessage[];
};

/** A neutral line of guidance from what the user said they hope to find in study. */
const userGuidanceFrom = (studyIntent: string[] | undefined): string => {
  const descriptors = (studyIntent ?? [])
    .map((intent) => ({ peace: "peaceful", understanding: "clear", encouragement: "encouraging", guidance: "practical" })[intent])
    .filter(Boolean)
    .slice(0, 2);
  return descriptors.length ? `appreciates ${descriptors.join(", ")} explanations` : "";
};

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

const formatKeywords = (keywords: string[] | undefined): string => {
  const kws = (keywords ?? []).filter(Boolean).slice(0, 6);
  return kws.length ? ` Keywords: ${kws.join(", ")}.` : "";
};

const buildUserProfileBlock = (args: {
  name?: string;
  preferredTranslation?: string;
  explanationStyle?: string;
  experienceLevel?: string;
  userGuidance?: string;
  life?: {
    currentSeason?: string;
    seasonNote?: string;
    weeklyCarrying?: string;
    weeklyHoping?: string;
    prayerTopics?: string[];
  };
}): string => {
  const name = args.name?.trim() || "";
  const lines: string[] = [];
  lines.push("<user_profile>");
  if (name) lines.push(`Name: ${name}.`);
  if (args.preferredTranslation) lines.push(`Preferred translation: ${args.preferredTranslation}.`);
  if (args.explanationStyle) lines.push(`Explanation style: ${args.explanationStyle}.`);
  if (args.experienceLevel) lines.push(`Experience level: ${args.experienceLevel}.`);
  if (args.userGuidance?.trim()) lines.push(`Guidance: ${args.userGuidance.trim()}.`);

  const season = args.life?.currentSeason?.trim();
  const seasonNote = args.life?.seasonNote?.trim();
  if (season) lines.push(`Current season: ${season}${seasonNote ? ` (${seasonNote})` : ""}.`);
  if (args.life?.weeklyCarrying?.trim()) lines.push(`Weekly carrying: ${args.life.weeklyCarrying.trim()}.`);
  if (args.life?.weeklyHoping?.trim()) lines.push(`Weekly hoping: ${args.life.weeklyHoping.trim()}.`);
  if (args.life?.prayerTopics?.length) {
    lines.push(`Prayer topics: ${args.life.prayerTopics.slice(0, 5).join(", ")}.`);
  }
  lines.push("</user_profile>");
  return lines.join("\n");
};

const buildMemoryNotesBlock = (args: {
  sessionNotes: MemoryNote[];
  globalNotes: MemoryNote[];
}): { blockText: string; sessionCount: number; globalCount: number } => {
  const session = args.sessionNotes.filter((n) => normalizeWhitespace(n.text).length > 0).slice(0, 20);
  const global = args.globalNotes.filter((n) => normalizeWhitespace(n.text).length > 0).slice(0, 20);

  const lines: string[] = [];
  lines.push("<memory_notes>");
  lines.push("Precedence: current user message > session notes > global notes.");
  lines.push("");
  lines.push("Session notes:");
  if (session.length) {
    for (const n of session) lines.push(`Session note: ${n.text.trim()}.${formatKeywords(n.keywords)}`);
  } else {
    lines.push("Session note: (none).");
  }
  lines.push("");
  lines.push("Global notes:");
  if (global.length) {
    for (const n of global) lines.push(`Global note: ${n.text.trim()}.${formatKeywords(n.keywords)}`);
  } else {
    lines.push("Global note: (none).");
  }
  lines.push("</memory_notes>");

  return { blockText: lines.join("\n"), sessionCount: session.length, globalCount: global.length };
};

/** A list in words, short enough not to cost much: a long one is named by its ends. */
const shortList = (items: string[], noun: string): string =>
  items.length <= 8 ? items.join(", ") : `${items.length} ${noun}, ${items[0]} to ${items[items.length - 1]}`;

/**
 * What a schedule reads, how it is spread and when it ends, in words. Passages are left as the
 * app stores them (MAT:6:9-13), so a change to the plan can name them the same way.
 */
const describeReading = (reading: NonNullable<ContextGoal["reading"]>): string => {
  const parts: string[] = [];
  if (reading.passages?.length) parts.push(`passages ${shortList(reading.passages, "passages")}`);
  if (reading.books?.length) parts.push(shortList(reading.books.map((code) => getBookDisplayNameFromCode(code) ?? code), "books"));
  const unit = reading.passages?.length ? "passage" : reading.unit ?? "chapter";
  const period = reading.period ?? "day";
  const pace = reading.perPeriod ?? reading.chaptersPerDay;
  if (pace) parts.push(`${pace} ${unit}${pace === 1 ? "" : "s"} a ${period}`);
  else if (unit !== "chapter" || period !== "day") parts.push(`${unit}s spread by the ${period}`);
  if (reading.order === "any") parts.push("in any order");
  if (pace) parts.push(reading.endDate ? `finishing by ${reading.endDate}` : "no end date yet");
  else if (reading.endDate) parts.push(`to finish by ${reading.endDate}`);
  return parts.join(", ");
};

const buildGoalsBlock = (goals: ContextGoal[], today: string): string => {
  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const lines: string[] = ["<goals>", `Today: ${today}, a ${weekday}.`];
  if (!goals.length) lines.push("No active goals.");
  for (const goal of goals) {
    const facts = [goal.shape, goal.category, goal.rhythm].filter(Boolean).join(", ");
    lines.push(`Goal ${goal.id} (${facts}): "${goal.title.trim()}".`);
    if (goal.why?.trim()) lines.push(`Why: ${goal.why.trim()}`);
    if (goal.reading) lines.push(`Reading schedule: ${describeReading(goal.reading)}.`);
    else if (goal.category === "reading") lines.push("Reading schedule: none yet.");
    if (goal.path.length) lines.push(`Path: ${goal.path.map((s) => s.trim()).join("; ")}.`);
    if (goal.progressSummary.trim()) lines.push(`Progress: ${goal.progressSummary.trim()}`);
    if (goal.workingNotes?.trim()) lines.push(`Your working notes: ${goal.workingNotes.trim()}`);
  }
  lines.push("</goals>");
  return lines.join("\n");
};

const GOAL_SHAPE_POSTURE: Record<GoalShape, string> = {
  finish:
    "This is a Finish goal. Progress is measurable. Keep the pace realistic. When they fall behind, offer to make the plan smaller or move the date, and never shame them.",
  practice:
    "This is a Practice goal. Progress is a rhythm over recent weeks. Protect the rhythm. Don't talk about streaks or days in a row.",
  learn:
    "This is a Learn goal. Teach in order and build on what they have already read. Progress is the ground covered on the path and what stuck.",
  grow:
    "This is a Grow goal. Progress is not a number, so never score it, rate it or give a figure. Walk alongside them. Be honest about sin and quick with grace, and after a failure give them a way back. Keep pointing them to real people.",
};

/** "John 10" or "John 10:14-15", from the app's `JHN:10` or `JHN:10:14-15`. */
const readableRef = (ref: string): string => {
  const [book, chapter, verses] = ref.split(":");
  return `${getBookDisplayNameFromCode(book) ?? book} ${chapter ?? ""}${verses ? `:${verses}` : ""}`.trim();
};

/** The turn that begins a reflection after the goal's reading (plan section 17.5). */
const buildReflectionSection = (reflection: GoalThread["reflection"]): string => {
  const made = reflection?.made;
  const done = [
    ...(made?.highlights.length ? [`- Marked: ${made.highlights.map(readableRef).join("; ")}`] : []),
    ...(made?.notes ?? []).map((n) => `- Wrote beside ${readableRef(n.ref)}: "${n.text.trim()}"`),
    ...(made?.questions ?? []).map((q) => `- Asked you while reading: "${q.trim()}"`),
    ...(made?.minutes ? [`- Spent about ${made.minutes} minutes with it.`] : []),
  ];
  return [
    "This turn begins a reflection.",
    reflection
      ? `They have just finished the reading for this goal, ${readableRef(reflection.ref)}, and have come back to this thread. They have not written anything yet, so do not refer to a message of theirs.`
      : "They have just finished the reading for this goal and have come back to this thread. They have not written anything yet, so do not refer to a message of theirs.",
    done.length ? ["What they did while reading, for your direction only:", ...done].join("\n") : "They did not mark, note or ask anything while reading this time.",
    "",
    "How to lead it:",
    "- Begin a reflection on what God may be saying to them in this passage. Go deep and be real. This is a time to sit with the text and with their life, not to summarize the chapter.",
    "- What they marked, wrote or asked shows you where to go. Do not recite it back or list it (never \"You highlighted verse 14\"). Let it shape what you open up and the question you ask. If they did nothing, start from the heart of the passage and the goal.",
    "- Say a few plain sentences that open up what the passage presses on, then ask one honest question. One question at a time, in this turn and every turn after it.",
    "- Ask the hard question when it is the true one, and stay with their answer. Be honest about sin and quick to grace. Tie it back to the goal and to what they have said before in this thread.",
    "- Name a verse by its reference in your sentence (\"John 8:11\"); the app makes it a link. Show no card and no quick replies: let them answer in their own words.",
    "- If they say they would rather not now, let it go gently in one sentence.",
    "- Say the true thing directly. Never build a sentence on a contrast: no \"not X, but Y\", no \"not only X, but Y\", no \"the question is not X but Y\", no \"it isn't X, it's Y\". No quips and no clever closing lines.",
  ].join("\n");
};

/** A conversation that sets up a new goal; once the goal is made it becomes the goal's thread. */
const buildGoalSetupSection = (args: { setup: GoalSetup; opening: boolean; activeGoals: number }): string => {
  const lines: string[] = [
    "GOAL SETUP",
    "The user tapped \"New goal\". In this conversation you help them choose a goal and make it their own. Once you create it, this conversation becomes that goal's own thread.",
  ];
  if (args.activeGoals >= 3) {
    lines.push(
      "They already have three goals going, the most they can have. Say so plainly and kindly, and ask whether they would like to pause or let go of one first. Do not call set_goal until one has been paused or let go."
    );
  }
  const known = [
    ...(args.setup.noticed.length
      ? [`- Goals you noticed in past conversations that they have not said yes or no to: ${args.setup.noticed.map((t) => `"${t}"`).join(", ")}`]
      : []),
    ...(args.setup.recentReading.length ? [`- What they have read lately, most recent first: ${args.setup.recentReading.map(readableRef).join(", ")}`] : []),
  ];
  lines.push(
    "",
    "What you can draw on, for your direction only. Never recite it or say how you know it:",
    ...known,
    "- Their profile, life context, your memory notes and their current goals, above.",
    "",
    "How to lead it:"
  );
  if (args.opening) {
    lines.push(
      "- This is the start. They have not written anything yet, so do not refer to a message of theirs. In one or two warm sentences, ask what they would like to work toward. Then call quick_replies with 3 or 4 goals they might choose, each written as they would say it. Make them personal: draw on what you know (a goal you noticed, something they are carrying or hoping for, what they have been reading) and never offer a goal they already have. When you know little about them, offer familiar ones such as \"Read the Bible in a year\" or \"Pray every morning\". Do not list the options in your prose."
    );
  }
  lines.push(
    "- Make the goal theirs in a short back and forth: one short question per turn, and no more than two questions before you create it. Ask what would make it real (for a reading goal, what to read and by when, or how much at a time; for a practice, when in the day or how often) or why it matters to them now. Skip any question their words already answer. When their first answer already says what and how (\"Read the Bible in a year\"), ask only why it matters to them now. If they say they just want to start, create it.",
    "- Offer quick_replies when your question has obvious short answers. Leave them off when you ask why it matters, so they answer in their own words.",
    "- When you know what the goal is and enough to begin, call set_goal with status \"active\" and confidence \"explicit\", the title in their own words, and why when they gave one. Choosing one of your suggestions counts as stating it. In that same reply, say in one plain sentence that it is set, and stop there: do not lay out steps or ask another question, because that comes next.",
    "- If they would rather not set a goal now, let it go in one sentence.",
    "- Don't use goal_proposal here."
  );
  return lines.join("\n");
};

const buildGoalThreadSection = (args: {
  goal: ContextGoal | undefined;
  thread: GoalThread;
  opening: boolean;
  reflecting?: boolean;
  /** The thread was a goal setup conversation until this goal was made in it. */
  afterSetup?: boolean;
}): string => {
  const { goal, thread } = args;
  const lines: string[] = [
    "GOAL THREAD",
    "This conversation is the ongoing thread about one goal. It is where the goal is worked on, and you are the one helping with it. Talk the way you do everywhere else, as a close pastor, in plain sentences.",
    goal
      ? `The goal is ${goal.id}: "${goal.title.trim()}". ${GOAL_SHAPE_POSTURE[goal.shape]}`
      : `The goal is ${thread.goalId}. It is not in your goals list, so you can't see its details.`,
  ];
  if (thread.summary?.trim()) {
    lines.push(
      "",
      "The conversation so far, folded down (the earlier turns are not repeated):",
      thread.summary.trim()
    );
  }
  lines.push(
    "",
    "In this thread:",
    "- Say the true thing directly. Never build a sentence on a contrast: no \"not X, but Y\", no \"not only X, but Y\", no \"X, not Y\", no \"it isn't X, it's Y\". No quips and no clever closing lines (\"That is not a small prayer.\").",
    "- Move the goal forward by one small step at a time. Say one thing, then show a card if it helps. A card never replaces what a pastor would say, and never answers a hard moment on its own.",
    "- Only say what is in your goals list, the summary above and this conversation. Never say you noticed something you can't see.",
    "- You may say you will check in, or send a reading, a prayer or a question, later, but only in a turn where you also call schedule_activity for it. Never say you will pray for them.",
    "- When they change what they want (slower pace, a pause, letting it go, a new step), call update_goal. When they tell you something they did that the app can't see, call log_progress.",
    "- If this is a reading goal (or clearly about reading Scripture) and its Reading schedule says none yet or is missing, you may offer once, in plain words and only when it fits the conversation, to set up a reading schedule: what to read and by when. When they agree, call update_goal with reading (and shape finish for a read-through goal), working out any end date from today's date in <goals>. Never say you are updating the goal.",
    "- When they say how much they want to read at a time (\"a chapter a day\", \"two chapters a morning\"), that is a pace: call update_goal with reading holding what to read and how it is spread (the same as in its Reading schedule, or taken from the goal itself when it has none yet) and the new pace (chaptersPerDay, a whole number from 1 to 20, or perPeriod for a plan by books, passages or weeks), and leave endDate out so the finish date is worked out for them. Never count chapters or dates yourself.",
    "- In update_goal, include only what they asked to change and leave every other field out; never repeat the goal's current values. status (pause, let go, finish) goes alone in its own call, never together with another field.",
    "- Steps on a goal's path card are saved the moment they tap \"Looks good\". If they ask you to save steps and this goal's path already matches them, say in one plain sentence that they are saved and make no tool call. Only call update_goal with path when the steps differ, and then send the steps. Never say you could not save steps.",
    "- If update_goal, set_goal or log_progress answers ok false with a reason you can fix, correct the call and call it again in the same turn. If they ask for a change but what to change is vague (\"update my plan\") and the conversation does not already say (a pace or date they gave earlier counts), ask one short plain question about what they want to change instead of calling with nothing. Never tell them you tried, that something failed, or that you can't change it from here, and never mention tools, fields or refusals. If it still fails after one retry, say in one friendly sentence what you could not do and what they can do instead (for example, \"tap Adjust on the card\").",
    "- When a change makes this goal's current title wrong or misleading (a duration, date or pace in the title that no longer matches, or the aim itself changed, such as a different book or a different focus), rename it in the same update_goal call with title, keeping the user's wording and making the smallest change (\"Read the Gospel of Mark in 30 days\" becomes \"Read the Gospel of Mark\"). Do not rename it for any other reason, and never rename a Grow goal unless the user asks. When they ask to rename it, do it. Say so in one plain sentence (\"I've renamed it to ...\") only when you actually renamed it. If a rename answers already_a_goal, another goal already has that name, so choose a slightly different one.",
    "",
    "Goal cards, when show_block offers them:",
    "- Show at most one goal card per reply, after a sentence of your own. Never repeat a card's figures, dates or steps in your prose. The app fills them in from the user's own records.",
    "- goal_path: when you propose the approach, or when it changes. Pass this goal's id. Pass steps only for a path you are proposing, and the user confirms it from the card. To change the stored path because the user asked, call update_goal with the new steps, then show goal_path without steps.",
    "- goal_progress: when they ask how it is going, or now and then when seeing where things stand would help them. Pass this goal's id. Say the pace in a sentence of your own, never as a score. For a Grow goal, say where things stand in words only.",
    "- Don't use goal_proposal in this thread."
  );
  if (goal?.shape === "grow") {
    lines.push(
      "",
      "Because this is a Grow goal: the path must include at least one step toward a real person (a friend, a pastor, a group). Don't become the only one who knows about the struggle. If the path you propose or change has no such step, add one."
    );
  }
  if (args.opening && args.afterSetup) {
    lines.push(
      "",
      "This is the start of the thread. The goal was just made in the conversation above, and you have already said it is set. Do not say the goal back or greet them again. In a sentence of your own, say how you would go about it, show goal_path with the steps you propose, then ask one question that will help you start well (how much time they have on a normal day, or when in the day suits them), unless the conversation above already answered it. Keep it to a few sentences."
    );
  } else if (args.opening) {
    lines.push(
      "",
      "This is the start of the thread. The user has just made this goal and has not written anything yet, so do not refer to a first message. Open the thread: say the goal back in their own words in one sentence, show goal_path with the steps you propose, then ask one question that will help you start well (how much time they have on a normal day, or when in the day suits them). Keep it to a few sentences."
    );
  }
  if (args.reflecting) {
    lines.push("", buildReflectionSection(thread.reflection));
  }
  if (thread.remindersUnopened) {
    lines.push(
      "",
      "The last three reminders to reflect on this goal went unopened. Somewhere in this reply, ask once, plainly, whether those reminders help them, and offer to stop them. Don't argue for them. If they say to stop, call update_notification_settings with reflect_reminders_off."
    );
  }
  return lines.join("\n");
};

const buildPassageUnderDiscussionMessage = (args: {
  verseReference?: string;
  verseText?: string;
}): ResponsesInputMessage | null => {
  const verseReference = args.verseReference?.trim();
  if (!verseReference) return null;

  const verseText = args.verseText?.trim();
  if (verseText) {
    return {
      role: "user",
      content: `Passage under discussion:\nReference: ${verseReference}\n\n"${verseText}"`,
    };
  }

  return {
    role: "user",
    content: `Passage under discussion:\nReference: ${verseReference}`,
  };
};

const buildBibleReaderVisibleStartSystemAddendum = (): string => {
  return [
    "BIBLE READER START: OPENING ORIENTATION (Prompt A)",
    "The user has opened this chat while reading Scripture.",
    "Passage focus: Visible verses. Treat the provided passage as the sole focus of the response.",
    "",
    "Write:",
    "1) A short greeting (exactly 1 brief sentence).",
    "2) A brief orientation to the passage (2-4 short sentences).",
    "",
    "STYLE:",
    "- Simple, concrete, and unforced.",
    "- Avoid em dashes. Prefer periods or short sentences.",
    "",
    "AVOID:",
    "- Performative warmth, flattery, or overly literary phrasing.",
    "- Stock phrases (e.g., 'It is good to settle into this', 'I am glad to be here with you').",
    "- Pet names, emotional mirroring, or rhetorical flourishes.",
    "- Over-explaining or summarizing the passage.",
    "",
    "Name usage:",
    "- Only use the user's name if it reads naturally (e.g., 'Hi Matthew.'); otherwise omit it.",
    "",
    "The orientation should:",
    "- Acknowledge what the user is reading (book and chapter).",
    "- Situate the passage within its immediate biblical or literary context.",
    "- Hint at why this might stand out or feel challenging.",
    "",
    "Do not explain the passage.",
    "Do not ask questions.",
    "Do not apply the text personally.",
    "Do not quote the passage.",
  ].join("\n");
};

const buildBibleReaderSelectedStartSystemAddendum = (): string => {
  return [
    "BIBLE READER START: SELECTED VERSES (Explain start)",
    "The user has selected one or more verses. Treat the selected passage as the sole focus.",
    "",
    "Write an explanation immediately. Do not include a greeting.",
    "Keep it concise and grounded in the text.",
    "Avoid em dashes. Prefer periods or short sentences.",
    "Do not quote large blocks of the passage.",
    "Do not add personal application unless the user asks.",
  ].join("\n");
};

export function buildChatContextBundle(args: {
  context: ChatContext | undefined;
  entrypoint: ChatEntrypoint;
  mode: ChatMode;
  isNewConversation: boolean;
  message: string;
  verseReference?: string;
  verseText?: string;
  selectionState?: "selected" | "visible";
  goalThread?: GoalThread;
  goalSetup?: GoalSetup;
}): ChatContextBundle {
  const profile = args.context?.profile;
  const profileBlock = buildUserProfileBlock({
    name: profile?.name,
    preferredTranslation: profile?.preferredTranslation,
    explanationStyle: profile?.explanationStyle,
    experienceLevel: profile?.experienceLevel,
    userGuidance: userGuidanceFrom(profile?.studyIntent),
    life: {
      currentSeason: profile?.season,
      seasonNote: profile?.seasonNote,
      weeklyCarrying: profile?.weeklyCarrying,
      weeklyHoping: profile?.weeklyHoping,
      prayerTopics: profile?.prayerTopics,
    },
  });

  const notesBlock =
    args.context?.memoryEnabled === false
      ? "<memory_notes>\nDisabled.\n</memory_notes>"
      : buildMemoryNotesBlock({
          sessionNotes: args.context?.sessionNotes ?? [],
          globalNotes: args.context?.globalNotes ?? [],
        }).blockText;

  // Goals are sent whenever the app knows about them (an empty list included), with the user's date.
  const goals = args.context?.goals;
  const goalsBlock =
    goals || args.context?.today
      ? buildGoalsBlock(goals ?? [], args.context?.today ?? new Date().toISOString().slice(0, 10))
      : "";

  const injectedInstructions = [profileBlock, notesBlock, goalsBlock].filter(Boolean).join("\n\n");

  const passageMessage = buildPassageUnderDiscussionMessage({
    verseReference: args.verseReference,
    verseText: args.verseText,
  });

  const isBibleReaderStart = args.entrypoint === "bible_reader" && args.mode === "bible" && args.isNewConversation;
  const startAddendum = isBibleReaderStart
    ? args.selectionState === "selected"
      ? buildBibleReaderSelectedStartSystemAddendum()
      : args.selectionState === "visible"
        ? buildBibleReaderVisibleStartSystemAddendum()
        : ""
    : "";

  const isGoalThreadStart = Boolean(args.goalThread) && args.message === GOAL_THREAD_START_MESSAGE;
  const isGoalThreadReflect = Boolean(args.goalThread) && args.message === GOAL_THREAD_REFLECT_MESSAGE;
  const goalThreadSection = args.goalThread
    ? buildGoalThreadSection({
        goal: goals?.find((g) => g.id === args.goalThread?.goalId),
        thread: args.goalThread,
        opening: isGoalThreadStart,
        reflecting: isGoalThreadReflect,
        // A thread that opens with history behind it was a goal setup conversation.
        afterSetup: isGoalThreadStart && !args.isNewConversation,
      })
    : "";

  // A goal's thread is no longer setting up its goal.
  const goalSetup = args.goalThread ? undefined : args.goalSetup;
  const isGoalSetupStart = Boolean(goalSetup) && args.message === GOAL_SETUP_START_MESSAGE;
  const goalSetupSection = goalSetup
    ? buildGoalSetupSection({
        setup: goalSetup,
        opening: isGoalSetupStart,
        activeGoals: goals?.length ?? 0,
      })
    : "";

  const userMessage =
    isBibleReaderStart || isGoalThreadStart || isGoalThreadReflect || isGoalSetupStart ? "Begin." : args.message;

  return {
    injectedInstructions,
    // The fixed prompt goes first and on its own, so its cached prefix is shared by every request.
    instructions: [
      { role: "system", content: TOOL_ENABLED_GUIDE_SYSTEM_PROMPT },
      {
        role: "system",
        content: [injectedInstructions, startAddendum, goalThreadSection, goalSetupSection].filter(Boolean).join("\n\n"),
      },
    ],
    input: [...(passageMessage ? [passageMessage] : []), { role: "user", content: userMessage }],
  };
}
