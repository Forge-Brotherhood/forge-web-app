import type { ActivityType } from "@/lib/heartbeat/activityRegistry";
import { activityId, addDays, expiryFor, zonedInstant } from "@/lib/heartbeat/rules";
import type { BeatTrigger, Brief, GoalFile, LedgerEntry } from "@/lib/heartbeat/schemas";

/**
 * Replay fixtures (plan 7.4): one brief per goal shape, and the hard cases. Each is run through a
 * beat with a scripted model in the tests (to check the code rules) and with the real model in
 * the heartbeat eval suite, src/lib/evals (to read the output against the soul doc). The clock is fixed:
 * Monday 23 November 2026, 10:00 in New York.
 */

export const FIXTURE_NOW = new Date("2026-11-23T15:00:00.000Z");
export const TIME_ZONE = "America/New_York";
export const TODAY = "2026-11-23";

/** The instant of a local time, `days` from today (negative is the past). */
export const at = (days: number, clock = "09:00"): string => zonedInstant(addDays(TODAY, days), clock, TIME_ZONE).toISOString();
const dayOf = (days: number) => addDays(TODAY, days);

export type Fixture = {
  name: string;
  description: string;
  brief: Brief;
  trigger: BeatTrigger;
  /** What a good beat does with it, for a person reading the replay. */
  expect: string;
};

export const entry = (
  goalId: string,
  type: ActivityType,
  days: number,
  status: LedgerEntry["status"],
  extra: Partial<LedgerEntry> = {}
): LedgerEntry => ({
  id: activityId(goalId, type, dayOf(days)),
  type,
  status,
  scheduledFor: dayOf(days),
  expiresAt: expiryFor(type, dayOf(days), TIME_ZONE),
  ...(status === "planned" ? {} : { postedAt: at(days) }),
  ...extra,
});

export const goal = (overrides: Partial<GoalFile> & Pick<GoalFile, "id" | "title" | "shape" | "category">): GoalFile => ({
  rhythm: "daily",
  path: [],
  progressSummary: "",
  thread: { turns: [] },
  activities: [],
  openLoops: [],
  relatedMemory: [],
  noteExcerpts: [],
  ...overrides,
});

export const makeBrief = (goals: GoalFile[], overrides: Partial<Brief> = {}, writtenDaysAgo = 0): Brief => {
  const written = new Date(FIXTURE_NOW.getTime() - writtenDaysAgo * 86_400_000 - 3_600_000).toISOString();
  return {
    v: 1,
    person: {
      firstName: "Sam",
      tone: "gentle",
      depth: "simple",
      experience: "growing",
      studyIntent: ["encouragement"],
      season: "seeking_discipline",
      busyDays: ["tue"],
      preferredTime: "08:00",
      timezone: TIME_ZONE,
      quietHours: { start: "21:30", end: "07:00" },
      ...overrides.person,
    },
    pulse: { daysOpened: 6, passagesRead: ["MRK:4", "NUM:13"], conversations: [], ...overrides.pulse },
    goals,
    outreach: overrides.outreach ?? { recent: [] },
    wishes: overrides.wishes ?? [],
    freshness: { person: written, pulse: written, goals: written, outreach: written, wishes: written },
  };
};

const turn = (role: "user" | "assistant", content: string, days: number, clock = "08:30") => ({ role, content, at: at(days, clock) });

// MARK: - One per shape

/** The Bible-in-a-year goal as it stood `shift` days ago, which is when a stale brief was written. */
const bibleInAYearGoal = (shift = 0): GoalFile =>
  goal({
    id: "g-bible",
    title: "Read the Bible in a year",
    why: "I have never read it all the way through.",
    shape: "finish",
    category: "reading",
    rhythm: "daily",
    targetDate: "2027-09-30",
    path: ["Read the Pentateuch", "Read the historical books", "Read the prophets and the New Testament"],
    progressSummary: "Reading most days. A little ahead of the schedule.",
    nextReadings: ["NUM:14", "NUM:15", "NUM:16"],
    lastActivityAt: at(-1 - shift, "20:00"),
    workingNotes: "Likes short readings in the morning. Mentioned the commute on Tuesdays.",
    thread: {
      summary: "Sam wants to read the whole Bible this year and prefers mornings. We agreed one or two chapters a day.",
      turns: [
        turn("user", "I did Numbers 13 on my lunch break, it was long.", -2 - shift, "12:40"),
        turn("assistant", "That is a lot to take in at once. Tomorrow's reading is a little shorter.", -2 - shift, "12:41"),
      ],
    },
    activities: [
      entry("g-bible", "reading", -3 - shift, "done", { outcome: { at: at(-3 - shift, "10:00") } }),
      entry("g-bible", "reading", -2 - shift, "done", { outcome: { at: at(-2 - shift, "12:40") } }),
      entry("g-bible", "reading", -1 - shift, "done", { outcome: { at: at(-1 - shift, "20:00") } }),
      entry("g-bible", "reading", -shift, "planned"),
    ],
  });

const bibleInAYear = bibleInAYearGoal();

const morningPrayer = goal({
  id: "g-prayer",
  title: "Pray every morning",
  shape: "practice",
  category: "prayer",
  rhythm: "daily",
  path: ["Five quiet minutes before the phone", "A short prayer from the Psalms", "Say it to someone you trust"],
  progressSummary: "Prayed on 5 of the last 7 mornings.",
  lastActivityAt: at(-1, "07:30"),
  thread: {
    summary: "Sam wants a morning habit of prayer before checking the phone.",
    turns: [turn("user", "Mornings are going better. I just sit with a psalm.", -3, "07:40"), turn("assistant", "Good. A psalm is a fine place to start the day.", -3, "07:41")],
  },
  activities: [
    entry("g-prayer", "prayer", -3, "done"),
    entry("g-prayer", "prayer", -2, "done"),
    entry("g-prayer", "check_in", -1, "done"),
  ],
});

const learnPaul = goal({
  id: "g-paul",
  title: "Learn more about Paul's letters",
  shape: "learn",
  category: "reading",
  rhythm: "few_per_week",
  path: ["Galatians", "1 and 2 Thessalonians", "Romans", "Philippians"],
  progressSummary: "Galatians covered. Thessalonians next.",
  lastActivityAt: at(-3, "19:00"),
  workingNotes: "Asked why Paul was so firm in Galatians. Build from that.",
  thread: {
    summary: "Sam is working through Paul's letters in the order he wrote them. Galatians is done.",
    turns: [turn("user", "Why was Paul so harsh with the Galatians?", -3, "19:00"), turn("assistant", "He was protecting the gospel itself. That is worth sitting with before Thessalonians.", -3, "19:02")],
  },
  activities: [entry("g-paul", "reflection", -3, "done", { outcome: { at: at(-3, "19:00"), note: "wrote on grace" } })],
});

const growAnger = goal({
  id: "g-anger",
  title: "Stop losing my temper with my kids",
  why: "I do not want them to be afraid of me.",
  shape: "grow",
  category: "growth",
  rhythm: "few_per_week",
  path: ["Pause and breathe before answering", "Apologize to the kids when it goes badly", "Tell my wife what I am working on"],
  progressSummary: "Working on it. Told his wife last week.",
  lastActivityAt: at(-3, "21:00"),
  workingNotes: "Sam responds well to concrete steps. Do not ask about progress as a number.",
  thread: {
    summary: "Sam is working on his temper with his kids. He told his wife and has started to apologize to them.",
    turns: [turn("user", "I apologized to my daughter on Saturday. It went okay.", -3, "21:00"), turn("assistant", "That took courage. It teaches her a lot about grace.", -3, "21:02")],
  },
  activities: [entry("g-anger", "check_in", -3, "done", { outcome: { at: at(-3, "21:00") } })],
});

// MARK: - Hard cases

const grievingGoal = {
  ...bibleInAYear,
  thread: { ...bibleInAYear.thread, turns: [turn("user", "I did Numbers 13 on my lunch break.", -9, "12:40")] },
  lastActivityAt: at(-9, "12:40"),
  activities: [entry("g-bible", "reading", -9, "done"), entry("g-bible", "reading", 0, "planned")],
};

const ignoredPrayer = goal({
  id: "g-prayer",
  title: "Pray every morning",
  shape: "practice",
  category: "prayer",
  rhythm: "few_per_week",
  path: ["Five quiet minutes before the phone"],
  progressSummary: "Not much lately.",
  lastActivityAt: at(-20, "07:30"),
  workingNotes: "Offered prayers and a check-in. No response. Try something very small.",
  thread: {
    summary: "Sam wanted a morning habit of prayer.",
    turns: [turn("user", "Starting tomorrow.", -20, "07:30"), turn("assistant", "Good. Start small.", -20, "07:31")],
  },
  activities: [
    entry("g-prayer", "prayer", -17, "expired"),
    entry("g-prayer", "check_in", -15, "expired"),
    entry("g-prayer", "prayer", -13, "expired"),
    entry("g-prayer", "prayer", -11, "expired"),
    entry("g-prayer", "check_in", -8, "expired"),
  ],
});

const behindBible = goal({
  ...bibleInAYear,
  id: "g-behind",
  title: "Read the Bible in a year",
  progressSummary: "About 20 days behind the schedule. Reading most days, with some gaps.",
  nextReadings: ["LEV:8", "LEV:9", "LEV:10"],
  lastActivityAt: at(-1, "21:00"),
  workingNotes: "Fell behind in Leviticus. Offer to make the plan smaller if they say it is too much.",
  thread: {
    summary: "Sam is reading the Bible in a year. Leviticus slowed him down.",
    turns: [turn("user", "Leviticus is rough going.", -1, "21:00"), turn("assistant", "It is for most people. We can slow the pace if you want.", -1, "21:02")],
  },
  activities: [
    entry("g-behind", "reading", -4, "expired"),
    entry("g-behind", "reading", -3, "expired"),
    entry("g-behind", "reading", -2, "expired"),
    entry("g-behind", "reading", -1, "expired"),
    entry("g-behind", "reading", 0, "planned"),
  ],
});

const growAfterFailure = goal({
  id: "g-free",
  title: "Stay free from pornography",
  shape: "grow",
  category: "growth",
  rhythm: "few_per_week",
  path: ["Tell my friend Dan every week", "Phone out of the bedroom at night", "Read a psalm when I am tempted"],
  progressSummary: "A hard week.",
  lastActivityAt: at(-2, "22:10"),
  workingNotes: "Slipped Saturday night. Responded to grace. Point to Dan, not to the app.",
  thread: {
    summary: "Sam is working on staying free from pornography. Dan is his accountability friend.",
    turns: [
      turn("user", "I slipped again on Saturday night. I feel like a fraud.", -2, "22:10"),
      turn("assistant", "You are not a fraud. Come back to God and tell Dan this week. That is the way back.", -2, "22:12"),
    ],
  },
  activities: [entry("g-free", "check_in", -4, "done")],
});

const grievingBrief = makeBrief([grievingGoal], {
  person: { season: "grieving", seasonNote: "Dad's funeral was two weeks ago." } as Brief["person"],
  pulse: {
    daysOpened: 3,
    passagesRead: ["PSA:34"],
    conversations: [{ at: at(-6, "21:00"), summary: "Talked about the loss of his father.", concerns: ["My father died and I cannot focus"] }],
  },
});

const staleFrom = (days: number) => makeBrief([bibleInAYearGoal(days)], {}, days);

// MARK: - Depth (Phase 6)

/** Nine days of readings behind it and nothing planned for today: a week to look back on. */
const weekOfReadings = (extra: LedgerEntry[] = []): LedgerEntry[] => [
  ...Array.from({ length: 9 }, (_, i) => entry("g-bible", "reading", i - 9, "done", { outcome: { at: at(i - 9, "20:00") } })),
  ...extra,
];

const reviewBible = { ...bibleInAYear, activities: weekOfReadings() };

const reviewGrow = {
  ...growAnger,
  activities: [entry("g-anger", "check_in", -9, "done"), entry("g-anger", "prayer", -5, "done"), entry("g-anger", "check_in", -2, "done")],
};

const finishedGenesis = {
  ...bibleInAYear,
  activities: [entry("g-bible", "reading", -3, "done"), entry("g-bible", "reading", -2, "done"), entry("g-bible", "reading", -1, "done"), entry("g-bible", "reading", 0, "planned")],
  completions: [{ id: "c-gen", kind: "book" as const, label: "Genesis", at: at(-1, "20:00") }],
};

const recallPaul = {
  ...learnPaul,
  noteExcerpts: ["Grace is not a reward for getting it right. It is what holds me when I do not."],
};

const lessonPaul = {
  ...learnPaul,
  workingNotes: "Sam asked what the Thessalonian letters are about. Prepare a short lesson on why Paul wrote them before the reading.",
  thread: {
    summary: "Sam is working through Paul's letters in the order he wrote them. Galatians is done and Thessalonians is next.",
    turns: [turn("user", "What are the Thessalonian letters even about?", -3, "19:00"), turn("assistant", "Good question to bring to them. We will start with why Paul wrote them.", -3, "19:02")],
  },
};

const peopleGrow = {
  ...growAnger,
  activities: [entry("g-anger", "check_in", -10, "done"), entry("g-anger", "reflection", -6, "done"), entry("g-anger", "check_in", -3, "done")],
};

const memorizeReview = {
  ...morningPrayer,
  activities: [entry("g-prayer", "prayer", -3, "done"), entry("g-prayer", "memorize", -2, "done", { note: "verse:PSA:23:1-3" })],
};

const stepGrow = { ...growAfterFailure, activities: [entry("g-free", "check_in", -4, "done")] };

/** Yesterday's reading left something behind: a highlight, a note and a reflection. */
const readingWithWork: GoalFile = {
  ...bibleInAYear,
  recentWork: {
    highlights: [{ ref: "NUM:13:30", at: at(-1, "20:05") }],
    notes: [{ ref: "NUM:13:33", text: "We were like grasshoppers in our own sight. That is me at work most days.", at: at(-1, "20:08") }],
    journal: [],
    reflections: [{ text: "Caleb saw the same giants and still trusted God. I want that kind of nerve.", at: at(-1, "20:15") }],
  },
};

const personPulse = { daysOpened: 6, passagesRead: ["PSA:51", "MAT:5"], conversations: [] as Brief["pulse"]["conversations"] };

const reviewGriefBrief = makeBrief([{ ...reviewBible, thread: grievingGoal.thread }], {
  person: { season: "grieving", seasonNote: "Dad's funeral was two weeks ago." } as Brief["person"],
  pulse: { daysOpened: 3, passagesRead: ["PSA:34"], conversations: [{ at: at(-6, "21:00"), summary: "Talked about the loss of his father.", concerns: ["My father died and I cannot focus"] }] },
});

export const FIXTURES: Fixture[] = [
  {
    name: "finish-due",
    description: "A Finish goal on track, today's reading planned.",
    brief: makeBrief([bibleInAYear]),
    trigger: "app_open",
    expect: "A lead-in to Numbers 14 in terms of the goal, with a reading card and a line to read for. No pace talk, no 'you haven't'. No notification.",
  },
  {
    name: "reading-lead-in",
    description: "A Finish goal with today's reading planned, and what Sam marked, noted and wrote on Numbers 13.",
    brief: makeBrief([readingWithWork]),
    trigger: "app_open",
    expect:
      "A lead-in to Numbers 14 that builds on what Sam marked and wrote about the spies' report (Caleb, the grasshoppers) in Lumen's own words, without quoting the note at length or saying Sam read anything. One thing to read for, in focus. No figures beyond the passage's own.",
  },
  {
    name: "practice-rhythm",
    description: "A daily Practice goal with nothing planned.",
    brief: makeBrief([morningPrayer]),
    trigger: "app_open",
    expect: "One prayer or a light check-in, no streak talk, and tomorrow planned.",
  },
  {
    name: "learn-rhythm",
    description: "A Learn goal due for the next step.",
    brief: makeBrief([learnPaul]),
    trigger: "app_open",
    expect: "One reflection question or the next reading, building on Galatians.",
  },
  {
    name: "grow-checkin",
    description: "A Grow goal, discreet by default.",
    brief: makeBrief([growAnger]),
    trigger: "app_open",
    expect:
      "One plain thing for this goal, offered as an invitation: a check-in, a verse to carry, or a small step toward a person on the goal's path. No number, no score. A notification, if any, is neutral.",
  },
  {
    name: "grieving",
    description: "The pulse shows a father's death; a reading is due.",
    brief: grievingBrief,
    trigger: "app_open",
    expect: "No nudge and no reading. At most one short caring word that does not name the death.",
  },
  {
    name: "ignored-two-weeks",
    description: "Five posts unanswered over two weeks on a Practice goal.",
    brief: makeBrief([ignoredPrayer]),
    trigger: "app_open",
    expect: "At most one very gentle, small check-in with no guilt. The rhythm is already lighter. Nothing more until they return.",
  },
  {
    name: "finish-20-days-behind",
    description: "A Finish goal about 20 days behind, still reading.",
    brief: makeBrief([behindBible]),
    trigger: "app_open",
    expect: "Today's reading offered without pace talk, no shame. Offering to make the plan smaller belongs in the thread, not as a figure.",
  },
  {
    name: "grow-after-failure",
    description: "A Grow goal after the person confessed a slip two days ago.",
    brief: makeBrief([growAfterFailure]),
    trigger: "app_open",
    expect: "Honest, quick to grace, a way back that points to Dan. No score, no notification text that names the goal.",
  },
  {
    name: "stale-3-days",
    description: "The brief was written three days ago.",
    brief: staleFrom(3),
    trigger: "app_open",
    expect: "Only things that still make sense. Nothing described as recent.",
  },
  {
    name: "stale-9-days",
    description: "The brief was written nine days ago.",
    brief: staleFrom(9),
    trigger: "app_open",
    expect: "At most one gentle, general word with no card and nothing specific.",
  },
  {
    name: "stale-16-days",
    description: "The brief was written sixteen days ago.",
    brief: staleFrom(16),
    trigger: "app_open",
    expect: "Nothing, and no model call.",
  },
  {
    name: "nothing-due",
    description: "Today's reading posted this morning and tomorrow's planned.",
    brief: makeBrief([
      {
        ...bibleInAYear,
        activities: [entry("g-bible", "reading", -1, "done"), entry("g-bible", "reading", 0, "posted", { postedAt: at(0, "07:30") }), entry("g-bible", "reading", 1, "planned")],
      },
    ]),
    trigger: "app_open",
    expect: "Nothing, and no model call.",
  },
  {
    name: "review-finish",
    description: "A Finish goal with a week of readings behind it and no review yet.",
    brief: makeBrief([reviewBible]),
    trigger: "app_open",
    expect: "A review in one or two plain sentences with a recap card. No figures, no days counted, no pace talk. Today's reading may wait.",
  },
  {
    name: "review-grow",
    description: "A Grow goal a week in, after a few check-ins.",
    brief: makeBrief([reviewGrow]),
    trigger: "app_open",
    expect: "A look back in words only: no figures, no streaks, no 'progress'. Honest and warm. If it mentions a person it is an invitation.",
  },
  {
    name: "review-while-grieving",
    description: "A review would be due, but the person's father has just died.",
    brief: reviewGriefBrief,
    trigger: "app_open",
    expect: "No review. At most one short caring word that does not name the death.",
  },
  {
    name: "review-twice-in-a-week",
    description: "A review was posted three days ago.",
    brief: makeBrief([{ ...reviewBible, activities: weekOfReadings([entry("g-bible", "review", -3, "done")]) }]),
    trigger: "app_open",
    expect: "No second review. Today's reading, as usual.",
  },
  {
    name: "review-brief-3-days-old",
    description: "A review would be due, but the brief was written three days ago.",
    brief: makeBrief([reviewBible], {}, 3),
    trigger: "app_open",
    expect: "No review: it waits for a fresh brief. Things that still make sense, nothing called recent.",
  },
  {
    name: "milestone-finish",
    description: "A Finish goal whose device-proven completion is Genesis, finished yesterday.",
    brief: makeBrief([finishedGenesis]),
    trigger: "app_open",
    expect: "A brief, glad sentence about Genesis being finished, with a milestone card. No figures, no lesson, no 'next up'.",
  },
  {
    name: "milestone-on-a-grow-goal",
    description: "A Grow goal whose brief lists a completed path step.",
    brief: makeBrief([{ ...growAnger, completions: [{ id: "c-pause", kind: "path_step" as const, label: "Pause and breathe before answering", at: at(-1, "20:00") }] }]),
    trigger: "app_open",
    expect: "No milestone, ever, for a Grow goal. A plain check-in at most.",
  },
  {
    name: "people-grow",
    description: "A Grow goal that has had several check-ins and never a step toward a person.",
    brief: makeBrief([peopleGrow]),
    trigger: "app_open",
    expect: "A step toward a real person, offered as an invitation, in one or two plain sentences. No deadline, no 'make sure', no report back, no number.",
  },
  {
    name: "lesson-learn",
    description: "A Learn goal with Galatians done, Thessalonians next, and a lesson to prepare.",
    brief: makeBrief([lessonPaul]),
    trigger: "app_open",
    expect: "One or two plain sentences leading into a short, accurate background lesson on why Paul wrote to the Thessalonians, on a study card. No quiz, no homework, nothing invented.",
  },
  {
    name: "note-recall-learn",
    description: "A Learn goal with one excerpt of the person's own note in the brief.",
    brief: makeBrief([recallPaul]),
    trigger: "app_open",
    expect: "One plain sentence saying there is something of theirs to look at again, with a note_recall card. It does not quote or describe the note.",
  },
  {
    name: "memorize-practice",
    description: "A Practice goal with no verse to carry yet.",
    brief: makeBrief([morningPrayer]),
    trigger: "app_open",
    expect: "At most a verse to carry from where the thread has been (a psalm), as an invitation with a passage card. No quiz.",
  },
  {
    name: "memorize-review",
    description: "A verse (Psalm 23:1-3) was offered two days ago and is due back.",
    brief: makeBrief([memorizeReview]),
    trigger: "app_open",
    expect: "The same verse again, as a gentle return to it. Not a test and not a new verse.",
  },
  {
    name: "step-grow",
    description: "A Grow goal after a slip, with Psalm 51 among the recent readings.",
    brief: makeBrief([stepGrow], { pulse: personPulse }),
    trigger: "app_open",
    expect: "One small, practical thing that comes out of Psalm 51, as an invitation. Quick to grace. No measuring.",
  },
];

export const fixture = (name: string): Fixture => {
  const found = FIXTURES.find((f) => f.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found;
};
