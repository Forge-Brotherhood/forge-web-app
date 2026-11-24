import type { GoalRhythm } from "@/lib/goals/goalTypes";
import { ACTIVITY_REGISTRY, NOTE_PREFIX, excerptKey, type ActivityType } from "@/lib/heartbeat/activityRegistry";
import type { Brief, BeatTrigger, GoalFile, LedgerEntry, Staleness } from "@/lib/heartbeat/schemas";
import { CARE_FAMILIES, blockedWeekdays, sensitiveFamilies } from "@/lib/heartbeat/terms";

/**
 * The rules a beat runs on before and after the model. Everything here is plain arithmetic on the
 * brief and the clock: whether anything is due, whether the next few days are planned, what
 * budget is left, how stale the brief is. The model is only asked when this says something needs
 * deciding, and nothing it says is believed until these rules have checked it.
 */

export const MAX_NOTIFICATIONS_PER_DAY = 1;
export const MAX_ACTIVITIES_PER_DAY = 3;
/** Today and the next two days should have something planned if the rhythm calls for it. */
export const PLAN_AHEAD_DAYS = 2;
/** The furthest ahead a beat may plan. */
export const PLAN_MAX_DAYS = 7;
/** After this many unanswered posts the rhythm drops a level. After QUIET_AFTER the Guide goes quiet. */
export const BACK_OFF_AFTER = 3;
export const QUIET_AFTER = 6;
/** No Guide-started message within this long of the last turn in the thread. */
export const RECENT_CONTACT_HOURS = 4;
/** A caring word is not repeated within this long. */
export const CARING_WORD_SPACING_DAYS = 3;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// MARK: - Time

export const addDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const clockMinutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

export type LocalParts = { date: string; minutes: number; weekday: number };

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The date, minutes since midnight and weekday of an instant in a timezone. */
export const localParts = (at: Date, timeZone: string): LocalParts => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday],
  };
};

/** The instant a local date and time falls on. */
export const zonedInstant = (day: string, clock: string, timeZone: string): Date => {
  const target = Date.parse(`${day}T${clock}:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), timeZone);
    guess -= Date.parse(`${p.date}T00:00:00Z`) + p.minutes * 60_000 - target;
  }
  return new Date(guess);
};

/** The last second of a local day. */
export const endOfLocalDay = (day: string, timeZone: string): Date =>
  new Date(zonedInstant(addDays(day, 1), "00:00", timeZone).getTime() - 1000);

export const isQuietMinute = (minutes: number, quiet: { start: string; end: string }): boolean => {
  const start = clockMinutes(quiet.start);
  const end = clockMinutes(quiet.end);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
};

export const isQuietAt = (at: Date, person: Brief["person"]): boolean =>
  isQuietMinute(localParts(at, person.timezone).minutes, person.quietHours);

// MARK: - Activities

/** One activity per goal, type and day. */
export const activityId = (goalId: string, type: string, day: string): string => `${goalId}:${type}:${day}`;

export const expiryFor = (type: ActivityType, day: string, timeZone: string): string =>
  endOfLocalDay(addDays(day, ACTIVITY_REGISTRY[type].expiresAfterDays), timeZone).toISOString();

type EntryStatus = LedgerEntry["status"];

/** A planned or posted activity past its expiry is expired, whether or not the app has said so. */
export const effectiveStatus = (entry: LedgerEntry, now: Date): EntryStatus =>
  (entry.status === "planned" || entry.status === "posted") && Date.parse(entry.expiresAt) <= now.getTime() ? "expired" : entry.status;

// MARK: - Staleness

export const STALE_DAYS = { fresh: 2, aging: 7, gentle: 14 } as const;

/** The oldest section of the brief decides how far it can be trusted. */
export const briefWrittenAt = (brief: Brief): number => Math.min(...Object.values(brief.freshness).map((v) => Date.parse(v)));

export const stalenessOf = (brief: Brief, now: Date): { tier: Staleness; ageDays: number } => {
  const ageDays = Math.max(0, (now.getTime() - briefWrittenAt(brief)) / DAY_MS);
  const tier: Staleness =
    ageDays < STALE_DAYS.fresh ? "fresh" : ageDays < STALE_DAYS.aging ? "aging" : ageDays < STALE_DAYS.gentle ? "gentle" : "lapsed";
  return { tier, ageDays };
};

// MARK: - The person before the plan

/** Grief, crisis or a heavy season in what the brief says of the last weeks. */
export const isCareMode = (brief: Brief): boolean => {
  const { person, pulse } = brief;
  if (person.season === "grieving") return true;
  // Conversation summaries are often about Scripture, so only the user's own concerns are read.
  const text = [person.seasonNote, person.carrying, ...pulse.conversations.flatMap((c) => c.concerns)].filter(Boolean).join(" . ");
  const families = sensitiveFamilies(text);
  return CARE_FAMILIES.some((f) => families.has(f));
};

// MARK: - Rhythm and back-off

const RHYTHM_GAP_DAYS: Record<GoalRhythm, number> = { daily: 1, few_per_week: 2, weekly: 7 };
const RHYTHM_ORDER: GoalRhythm[] = ["daily", "few_per_week", "weekly"];

export const lowerRhythm = (rhythm: GoalRhythm): GoalRhythm => RHYTHM_ORDER[Math.min(RHYTHM_ORDER.indexOf(rhythm) + 1, 2)];
export const isLighterRhythm = (from: GoalRhythm, to: GoalRhythm): boolean => RHYTHM_ORDER.indexOf(to) > RHYTHM_ORDER.indexOf(from);

/** Posts that went by without the user doing anything with them, newest first, until one was answered. */
export const unansweredCount = (goal: GoalFile, now: Date): number => {
  // A milestone asks nothing of the person, so it cannot go unanswered.
  const posted = goal.activities
    .filter((a) => a.postedAt && a.type !== "milestone")
    .sort((a, b) => Date.parse(b.postedAt!) - Date.parse(a.postedAt!));
  const lastActive = goal.lastActivityAt ? Date.parse(goal.lastActivityAt) : -Infinity;
  const userTurns = goal.thread.turns.filter((t) => t.role === "user").map((t) => Date.parse(t.at));
  let count = 0;
  for (const entry of posted) {
    const at = Date.parse(entry.postedAt!);
    if (effectiveStatus(entry, now) !== "expired" || at <= lastActive || userTurns.some((t) => t > at)) break;
    count += 1;
  }
  return count;
};

// MARK: - Depth: the cadence of the Phase 6 types

/** A review is offered at most once in this many days, and only when there is a week to look back on. */
export const REVIEW_GAP_DAYS = 7;
/** A verse in review comes back after these many days, one gap after each showing. After the last it is carried. */
export const MEMORIZE_REVIEW_GAPS = [2, 4, 7, 14] as const;
/** The least time between two memorize posts, and how long past due a verse in review is kept before it is let go. */
export const MEMORIZE_MIN_GAP_DAYS = 2;
export const MEMORIZE_LET_GO_DAYS = 14;
/** The same excerpt of the person's notes is not brought back within this many days. */
export const NOTE_RECALL_REPEAT_DAYS = 30;
/** A step toward a person is offered about once in a review cycle, and not more often. */
export const PEOPLE_GAP_DAYS = 7;
/** A completion older than this is no longer worth marking. */
export const MILESTONE_MAX_AGE_DAYS = 14;

const localDay = (iso: string, timeZone: string): string => localParts(new Date(iso), timeZone).date;

/** What was posted of one type, oldest first. */
const postedOf = (goal: GoalFile, type: ActivityType, timeZone: string) =>
  goal.activities
    .filter((a) => a.type === type && a.postedAt)
    .sort((a, b) => Date.parse(a.postedAt!) - Date.parse(b.postedAt!))
    .map((entry) => ({ entry, day: localDay(entry.postedAt!, timeZone) }));

export type ReviewStatus = "due" | "too_soon" | "not_due";

/** Weekly, per goal: not twice in a week, and only when there was a week to look back on. */
export const reviewStatus = (goal: GoalFile, timeZone: string, today: string): ReviewStatus => {
  const reviews = postedOf(goal, "review", timeZone);
  const last = reviews[reviews.length - 1]?.day;
  if (last && daysBetween(last, today) < REVIEW_GAP_DAYS) return "too_soon";
  const first = goal.activities.map((a) => a.scheduledFor).sort()[0];
  if (!last && (!first || daysBetween(first, today) < REVIEW_GAP_DAYS)) return "not_due";
  const lookedBack =
    goal.activities.some((a) => a.postedAt && daysBetween(localDay(a.postedAt, timeZone), today) < REVIEW_GAP_DAYS) ||
    (goal.lastActivityAt !== undefined && daysBetween(localDay(goal.lastActivityAt, timeZone), today) < REVIEW_GAP_DAYS);
  return lookedBack ? "due" : "not_due";
};

export type MemorizeStatus = { mode: "new" | "review" | "wait"; /** The verse a review must bring back. */ ref?: string; /** Verses already offered. */ offered: string[] };

/** Spaced review: a new verse, the one in review when its time has come, or wait. */
export const memorizeStatus = (goal: GoalFile, timeZone: string, day: string): MemorizeStatus => {
  const posts = postedOf(goal, "memorize", timeZone).filter((p) => p.entry.note?.startsWith(NOTE_PREFIX.memorize));
  const offered = [...new Set(posts.map((p) => p.entry.note!.slice(NOTE_PREFIX.memorize.length)))];
  const last = posts[posts.length - 1];
  if (!last) return { mode: "new", offered };
  const since = daysBetween(last.day, day);
  const count = posts.filter((p) => p.entry.note === last.entry.note).length;
  // Shown the last time it is reviewed: carried. A new verse may follow after the minimum gap.
  if (count > MEMORIZE_REVIEW_GAPS.length) return { mode: since >= MEMORIZE_MIN_GAP_DAYS ? "new" : "wait", offered };
  const gap = MEMORIZE_REVIEW_GAPS[count - 1];
  if (since < gap) return { mode: "wait", offered };
  if (since > gap + MEMORIZE_LET_GO_DAYS) return { mode: "new", offered };
  return { mode: "review", ref: last.entry.note!.slice(NOTE_PREFIX.memorize.length), offered };
};

export type PeopleStatus = "due" | "too_soon" | "only_offer";

/** About once a review cycle, and never the only thing offered on the goal. */
export const peopleStatus = (goal: GoalFile, timeZone: string, today: string): PeopleStatus => {
  const people = postedOf(goal, "people", timeZone);
  const last = people[people.length - 1]?.day;
  if (last && daysBetween(last, today) < PEOPLE_GAP_DAYS) return "too_soon";
  const others = goal.activities.some((a) => a.type !== "people" && a.postedAt && daysBetween(localDay(a.postedAt, timeZone), today) <= 2 * PEOPLE_GAP_DAYS);
  return others ? "due" : "only_offer";
};

/** The positions in noteExcerpts that may be brought back: not the same words within 30 days. */
export const recallableExcerpts = (goal: GoalFile, timeZone: string, today: string): number[] => {
  const recent = new Set(
    postedOf(goal, "note_recall", timeZone)
      .filter((p) => daysBetween(p.day, today) < NOTE_RECALL_REPEAT_DAYS)
      .map((p) => p.entry.note)
  );
  return goal.noteExcerpts.flatMap((e, i) => (e.trim() && !recent.has(`${NOTE_PREFIX.note_recall}${excerptKey(e)}`) ? [i] : []));
};

/** The ids of completions that really happened lately and have not been marked. Never for a Grow goal. */
export const openMilestones = (goal: GoalFile, timeZone: string, today: string, now: Date): string[] => {
  if (goal.shape === "grow") return [];
  const marked = new Set(postedOf(goal, "milestone", timeZone).map((p) => p.entry.note));
  return (goal.completions ?? [])
    .filter(
      (c) =>
        Date.parse(c.at) <= now.getTime() &&
        daysBetween(localDay(c.at, timeZone), today) <= MILESTONE_MAX_AGE_DAYS &&
        !marked.has(`${NOTE_PREFIX.milestone}${c.id}`) &&
        (c.kind !== "path_step" || goal.path.includes(c.label))
    )
    .map((c) => c.id);
};

// MARK: - Per goal

export type GoalState = {
  goal: GoalFile;
  discreet: boolean;
  unanswered: number;
  backedOff: boolean;
  /** Unanswered too long: the Guide says nothing here until the person returns. */
  quiet: boolean;
  gapDays: number;
  lastPostedDay?: string;
  postedToday: boolean;
  recentContact: boolean;
  weekdayBlocked: boolean;
  /** Planned and not yet expired. */
  planned: LedgerEntry[];
  /** Types of planned activities that are due now. */
  dueTypes: ActivityType[];
  /** Nothing planned is due, and the rhythm says it is time. */
  rhythmDue: boolean;
  /** The next few days have nothing planned and the rhythm says something belongs in them. */
  needsPlan: boolean;
  /** The weekly review: due, offered too recently, or not due. */
  review: ReviewStatus;
  /** Completions the device has proven and no milestone has marked. Never any for a Grow goal. */
  milestones: string[];
  /** Spaced review of a verse to carry. */
  memorize: MemorizeStatus;
  /** A step toward a person, for the goals it serves. */
  people: PeopleStatus;
  /** Positions in the goal's noteExcerpts that may be brought back. */
  recallable: number[];
  /** When the thread last had a turn from either side. */
  lastTurnAt?: number;
  /** The thread has had an assistant turn since this time. */
  assistantSince: (at: number) => boolean;
};

/** A discreet goal is never named in a notification. When unset, Grow goals are discreet. */
export const isDiscreet = (goal: GoalFile): boolean => goal.discreet ?? goal.shape === "grow";

export const assessGoal = (brief: Brief, goal: GoalFile, now: Date, today: { date: string; minutes: number; weekday: number }): GoalState => {
  const tz = brief.person.timezone;
  const unanswered = unansweredCount(goal, now);
  const quiet = unanswered >= QUIET_AFTER;
  const backedOff = unanswered >= BACK_OFF_AFTER;
  const gapDays = RHYTHM_GAP_DAYS[backedOff ? lowerRhythm(goal.rhythm) : goal.rhythm];

  const postedDays = goal.activities.filter((a) => a.postedAt).map((a) => localParts(new Date(a.postedAt!), tz).date).sort();
  const lastPostedDay = postedDays[postedDays.length - 1];
  const postedToday = postedDays.includes(today.date);

  const turnTimes = goal.thread.turns.map((t) => Date.parse(t.at));
  const lastTurnAt = turnTimes.length ? Math.max(...turnTimes) : undefined;
  const recentContact = lastTurnAt !== undefined && now.getTime() - lastTurnAt < RECENT_CONTACT_HOURS * HOUR_MS;

  const planned = goal.activities.filter((a) => effectiveStatus(a, now) === "planned");
  const isDue = (a: LedgerEntry) =>
    a.scheduledFor < today.date || (a.scheduledFor === today.date && (!a.scheduledTime || clockMinutes(a.scheduledTime) <= today.minutes));
  const dueTypes = planned.filter(isDue).map((a) => a.type);

  const nextDue = lastPostedDay ? addDays(lastPostedDay, gapDays) : today.date;
  const rhythmDue = !quiet && !postedToday && dueTypes.length === 0 && nextDue <= today.date;
  const hasPlanAhead = planned.some((a) => a.scheduledFor >= today.date);
  const needsPlan = !quiet && !hasPlanAhead && nextDue <= addDays(today.date, PLAN_AHEAD_DAYS);

  return {
    goal,
    discreet: isDiscreet(goal),
    unanswered,
    backedOff,
    quiet,
    gapDays,
    lastPostedDay,
    postedToday,
    recentContact,
    weekdayBlocked: blockedWeekdays(brief.wishes).has(today.weekday),
    planned,
    dueTypes,
    rhythmDue,
    needsPlan,
    review: !quiet && !backedOff ? reviewStatus(goal, tz, today.date) : "not_due",
    milestones: openMilestones(goal, tz, today.date, now),
    memorize: memorizeStatus(goal, tz, today.date),
    people: peopleStatus(goal, tz, today.date),
    recallable: recallableExcerpts(goal, tz, today.date),
    lastTurnAt,
    assistantSince: (at) => goal.thread.turns.some((t) => t.role === "assistant" && Date.parse(t.at) > at),
  };
};

// MARK: - The decision

export type BeatMode =
  /** Act on what is due and plan ahead. */
  | "normal"
  /** The person is in a hard season. At most a caring word. */
  | "care"
  /** The brief is a week old or more. At most one gentle, general word. */
  | "gentle"
  /** Nothing to decide. */
  | "none";

export type Decision = {
  staleness: Staleness;
  careMode: boolean;
  mode: BeatMode;
  today: LocalParts;
  trigger: BeatTrigger;
  /** Only a beat run because the app was opened, or by the server's own clock, may post. */
  canPost: boolean;
  goals: GoalState[];
  /** Goals a caring or gentle word may go to. */
  wordGoalIds: string[];
  budget: { notificationsLeft: number; activitiesLeft: number };
  needsModel: boolean;
};

/** Activities already on a given day, across goals. A cancelled or ignored-and-expired plan does not count. */
export const activitiesOn = (brief: Brief, date: string): number =>
  brief.goals.reduce((n, g) => n + g.activities.filter((a) => a.scheduledFor === date && (a.status !== "expired" || a.postedAt)).length, 0);

export const notificationsOn = (brief: Brief, date: string): number =>
  brief.outreach.recent.filter((o) => localParts(new Date(o.at), brief.person.timezone).date === date).length;

/** Rules first: is anything due, is the next few days planned, is there budget. No model, no key. */
export const decide = (brief: Brief, now: Date, trigger: BeatTrigger): Decision => {
  const { tier } = stalenessOf(brief, now);
  const careMode = isCareMode(brief);
  const today = localParts(now, brief.person.timezone);
  const goals = brief.goals.map((g) => assessGoal(brief, g, now, today));
  const postedToday = brief.goals.reduce(
    (n, g) => n + g.activities.filter((a) => a.postedAt && localParts(new Date(a.postedAt), brief.person.timezone).date === today.date).length,
    0
  );
  const budget = {
    notificationsLeft: Math.max(0, MAX_NOTIFICATIONS_PER_DAY - notificationsOn(brief, today.date)),
    activitiesLeft: Math.max(0, MAX_ACTIVITIES_PER_DAY - postedToday),
  };
  const canPost = trigger === "app_open" || trigger === "heartbeat";
  const written = briefWrittenAt(brief);

  let mode: BeatMode = "none";
  let wordGoalIds: string[] = [];
  if (tier === "gentle") {
    // One word in all, and none once any thread has had a turn from the Guide since the brief was written.
    if (canPost && !careMode && !goals.some((s) => s.assistantSince(written))) {
      mode = "gentle";
      wordGoalIds = goals.filter((s) => !s.recentContact).map((s) => s.goal.id);
    }
  } else if (tier === "fresh" && careMode) {
    const spacing = CARING_WORD_SPACING_DAYS * DAY_MS;
    wordGoalIds = canPost
      ? goals.filter((s) => !s.recentContact && (s.lastTurnAt === undefined || now.getTime() - s.lastTurnAt > spacing)).map((s) => s.goal.id)
      : [];
    mode = wordGoalIds.length ? "care" : "none";
  } else if ((tier === "fresh" || tier === "aging") && !careMode) {
    mode = "normal";
  }

  const postsAllowed = canPost && budget.activitiesLeft > 0;
  // What the cadence rules say is due, apart from the rhythm. A review is for a fresh brief only.
  const depthDue = (s: GoalState) =>
    (tier === "fresh" && s.review === "due") ||
    s.milestones.length > 0 ||
    s.memorize.mode === "review" ||
    (s.goal.shape === "grow" && s.people === "due");
  const needsModel =
    mode === "gentle" || mode === "care"
      ? wordGoalIds.length > 0
      : mode === "normal" &&
        goals.some(
          (s) =>
            (postsAllowed && !s.quiet && !s.postedToday && !s.recentContact && !s.weekdayBlocked && (s.dueTypes.length > 0 || s.rhythmDue || depthDue(s))) ||
            s.needsPlan
        );

  return { staleness: tier, careMode, mode, today, trigger, canPost, goals, wordGoalIds, budget, needsModel };
};

// MARK: - When to look again

/** The earliest time a beat could have something to do, never sooner than an hour or later than three days. */
export const nextBeatAt = (args: {
  brief: Brief;
  now: Date;
  decision: Decision;
  /** Activities planned or posted by this beat, as [goalId, day, time?]. */
  added: Array<{ goalId: string; day: string; time?: string; posted: boolean }>;
}): Date => {
  const { brief, now, decision } = args;
  const tz = brief.person.timezone;
  const morning = brief.person.quietHours.end;
  const at = (day: string, time?: string) => {
    const instant = zonedInstant(day, time ?? morning, tz);
    return instant.getTime() > now.getTime() ? instant : zonedInstant(addDays(decision.today.date, 1), morning, tz);
  };

  const candidates: number[] = [];
  if (decision.mode === "normal") {
    for (const s of decision.goals) {
      if (s.quiet) continue;
      const entries = [
        ...s.planned.map((a) => ({ day: a.scheduledFor, time: a.scheduledTime })),
        ...args.added.filter((a) => a.goalId === s.goal.id && !a.posted).map((a) => ({ day: a.day, time: a.time })),
      ];
      for (const e of entries) candidates.push(at(e.day, e.time).getTime());
      const lastPosted = args.added.some((a) => a.goalId === s.goal.id && a.posted) ? decision.today.date : s.lastPostedDay;
      candidates.push(at(lastPosted ? addDays(lastPosted, s.gapDays) : decision.today.date).getTime());
    }
  }
  const soonest = candidates.length ? Math.min(...candidates) : now.getTime() + DAY_MS;
  return new Date(Math.min(Math.max(soonest, now.getTime() + HOUR_MS), now.getTime() + 3 * DAY_MS));
};
