import type { HeadsUpFact } from "@/lib/heartbeat/headsUpText";
import { looksInstructional, looksSensitive } from "@/lib/chat/tools/contextTools";
import { activityDefinition, type ActivityType } from "@/lib/heartbeat/activityRegistry";
import {
  PLAN_MAX_DAYS,
  MAX_ACTIVITIES_PER_DAY,
  MAX_NOTIFICATIONS_PER_DAY,
  activitiesOn,
  activityId,
  addDays,
  daysBetween,
  effectiveStatus,
  expiryFor,
  isLighterRhythm,
  isQuietAt,
  isQuietMinute,
  localParts,
  memorizeStatus,
  notificationsOn,
  peopleStatus,
  reviewStatus,
  zonedInstant,
  clockMinutes,
  type Decision,
  type GoalState,
} from "@/lib/heartbeat/rules";
import {
  modelGoalChangeSchema,
  modelOutputSchema,
  modelPlanSchema,
  modelPostSchema,
  modelWorkingNotesSchema,
  type Activity,
  type BeatOutput,
  type Brief,
  type Staleness,
} from "@/lib/heartbeat/schemas";
import {
  ASSIGNMENT_LANGUAGE,
  DASHES,
  MILESTONE_WORD,
  NEUTRAL_NOTIFICATION_TEXT,
  NUDGE_LANGUAGE,
  OBSERVATION_CLAIM,
  FALSE_PROMISE,
  READING_STATE_CLAIM,
  RECENCY_WORDS,
  SCORING_LANGUAGE,
  goalCorpus,
  sensitiveFamilies,
} from "@/lib/heartbeat/terms";
import { parseReadingRef, resolveShowBlockCall, type GuideBlock } from "@/lib/guide/uiBlocks";

/**
 * Checks what the model said against the brief and the rules, and drops whatever fails. The model
 * is asked to behave; this is what makes it so. Silence is the default: a post needs a reason that
 * the brief bears out, and anything that does not pass is simply not sent.
 */

const MAX_MESSAGE_CHARS = 320;
const MAX_WORD_CHARS = 220;
const MAX_SENTENCES = 3;
/** A reading's message is a lead-in to the passage, so it may run longer than other posts. */
const MAX_LEAD_IN_CHARS = 600;
const MAX_LEAD_IN_SENTENCES = 6;
const MAX_NOTIFY_CHARS = 100;

export type Validated = Pick<BeatOutput, "goalChanges" | "activities" | "posts" | "workingNotes"> & {
  dropped: BeatOutput["meta"]["dropped"];
  /** On a heads-up run, each activity posted, for the heads-up to choose from. */
  headsUpFacts: HeadsUpFact[];
  /** Everything this beat planned or posted, for working out when to look again. */
  added: Array<{ goalId: string; day: string; time?: string; posted: boolean }>;
};

const sentenceCount = (text: string) => (text.match(/[.!?](?=\s|$)/g) ?? []).length;
const numbersIn = (text: string) => text.match(/\d+/g) ?? [];

/** What a thread is already about, for the rule that the Guide continues and never opens a subject. */
const threadCorpus = (state: GoalState): string => goalCorpus(state.goal);

/** Scoring, ranking and counting: never on a Grow goal, and never in a milestone, which marks and does not compare. */
const scores = (text: string, state: GoalState, type: ActivityType | undefined): boolean =>
  state.goal.shape === "grow"
    ? SCORING_LANGUAGE.test(text) || MILESTONE_WORD.test(text)
    : type === "milestone" && SCORING_LANGUAGE.test(text);

/** The cards that name the activity they belong to, so the app can mark the right one. */
const ACTIVITY_CARD_KINDS: ReadonlySet<string> = new Set(["reading_card", "prompt_card", "recap_card", "milestone_card", "note_recall"]);

/**
 * The cadence rules of the Phase 6 types, read from what the rules worked out about the goal.
 * Null means the type may be posted now. These are code, not guidance: the model is told the same
 * things in its prompt, and this is what holds when it does not listen.
 */
const cadenceDrop = (type: ActivityType, payload: Record<string, unknown>, state: GoalState, staleness: Staleness): string | null => {
  switch (type) {
    case "review":
      if (staleness !== "fresh") return "review_not_fresh";
      return state.review === "due" ? null : state.review === "too_soon" ? "review_too_soon" : "review_not_due";
    case "milestone":
      return state.milestones.includes(String(payload.completionId)) ? null : "milestone_not_proven";
    case "memorize": {
      const ref = parseReadingRef(String(payload.ref))?.refKey;
      if (state.memorize.mode === "wait") return "memorize_too_soon";
      if (state.memorize.mode === "review") return ref === state.memorize.ref ? null : "memorize_review_due";
      return ref && state.memorize.offered.includes(ref) ? "memorize_already_offered" : null;
    }
    case "people":
      return state.people === "due" ? null : state.people === "too_soon" ? "people_too_soon" : "people_only_offer";
    case "note_recall":
      return state.recallable.includes(Number(payload.excerptIndex)) ? null : "note_recall_repeated";
    default:
      return null;
  }
};

/** Types whose own cadence can make them due, when the goal's rhythm says nothing is: a verse back in review, a step toward a person. */
const cadenceDue = (type: ActivityType, state: GoalState): boolean =>
  (type === "memorize" && state.memorize.mode === "review") || (type === "people" && state.people === "due");

/** The same cadence at planning time, for the types spaced by time. Only what is already too soon is refused. */
const planCadenceDrop = (type: ActivityType, goal: GoalState["goal"], date: string, timeZone: string): string | null => {
  if (type === "review" && reviewStatus(goal, timeZone, date) === "too_soon") return "review_too_soon";
  if (type === "people" && peopleStatus(goal, timeZone, date) === "too_soon") return "people_too_soon";
  if (type === "memorize" && memorizeStatus(goal, timeZone, date).mode === "wait") return "memorize_too_soon";
  return null;
};

/** The words a card shows: the Guide's own held to the same plain wording as a message, apart from its length. */
const cardTextDrop = (type: ActivityType, payload: Record<string, unknown>, state: GoalState): string | null => {
  const known = sensitiveFamilies(threadCorpus(state));
  // Their own words come back unchanged, so only the subject is checked: a heavy one is not opened by a recall.
  if (type === "note_recall") {
    const excerpt = state.goal.noteExcerpts[Number(payload.excerptIndex)] ?? "";
    return [...sensitiveFamilies(excerpt)].some((f) => !known.has(f)) ? "card_opens_sensitive_subject" : null;
  }
  const texts = (type === "review" ? [payload.note] : type === "lesson" ? [payload.title, payload.body] : type === "reading" ? [payload.focus] : []).filter(
    (t): t is string => typeof t === "string"
  );
  for (const text of texts) {
    const code = DASHES.test(text)
      ? "dash"
      : NUDGE_LANGUAGE.test(text)
        ? "nudge_language"
        : OBSERVATION_CLAIM.test(text)
          ? "unseen_observation"
          : FALSE_PROMISE.test(text)
            ? "false_promise"
            : type === "review" && numbersIn(text).length
              ? "figures_in_message"
              : scores(text, state, type)
                ? "grow_scoring"
                : [...sensitiveFamilies(text)].some((f) => !known.has(f))
                  ? "opens_sensitive_subject"
                  : null;
    if (code) return `card_${code}`;
  }
  return null;
};

const blockedNote = (text: string) => looksSensitive(text) || looksInstructional(text);

export async function validateBeat(args: {
  brief: Brief;
  now: Date;
  decision: Decision;
  raw: unknown;
  /** Whose reader settings a passage card uses for its translation. */
  userId?: string;
}): Promise<Validated> {
  const { brief, now, decision } = args;
  const tz = brief.person.timezone;
  const today = decision.today.date;
  const states = new Map(decision.goals.map((s) => [s.goal.id, s]));
  const goalIds = [...states.keys()];
  const goalShapes = Object.fromEntries(decision.goals.map((s) => [s.goal.id, s.goal.shape]));

  const out: Validated = { goalChanges: [], activities: [], posts: [], workingNotes: [], dropped: [], added: [], headsUpFacts: [] };
  const drop = (what: string, code: string) => out.dropped.push({ what, code });

  const parsed = modelOutputSchema.safeParse(args.raw);
  if (!parsed.success) {
    drop("output", "invalid");
    return out;
  }
  const raw = parsed.data;

  const planningOpen = decision.mode === "normal";
  // On a heads-up run the send time decides, not quiet hours: the device chose it as a time the person is up.
  const inQuiet = !decision.headsUp && isQuietAt(now, brief.person);
  let activitiesPosted = 0;
  const notifiesByDay = new Map<string, number>();
  const newOnDay = new Map<string, number>([[today, 0]]);
  const usedIds = new Set<string>();
  const postedGoals = new Set<string>();

  const notifyFor = (state: GoalState, text: string, at: Date, what: string): { at: string; text: string } | null => {
    const date = localParts(at, tz).date;
    const used = notificationsOn(brief, date) + (notifiesByDay.get(date) ?? 0);
    if (used >= MAX_NOTIFICATIONS_PER_DAY) return drop(what, "notify_budget"), null;
    if (!(decision.headsUp && at === now) && isQuietAt(at, brief.person)) return drop(what, "notify_quiet_hours"), null;
    const plain =
      !state.discreet &&
      text.length <= MAX_NOTIFY_CHARS &&
      !DASHES.test(text) &&
      !NUDGE_LANGUAGE.test(text) &&
      sensitiveFamilies(text).size === 0 &&
      !numbersIn(text).length;
    notifiesByDay.set(date, (notifiesByDay.get(date) ?? 0) + 1);
    return { at: at.toISOString(), text: plain ? text : NEUTRAL_NOTIFICATION_TEXT };
  };

  // MARK: Posts

  for (const item of raw.posts ?? []) {
    const post = modelPostSchema.safeParse(item);
    if (!post.success) {
      drop("post", "invalid");
      continue;
    }
    const p = post.data;
    const state = states.get(p.goalId);
    if (!state) {
      drop("post", "unknown_goal");
      continue;
    }
    const reject = (code: string) => drop("post", code);

    if (!decision.canPost) {
      reject("trigger_no_posts");
      continue;
    }
    if (decision.mode === "none") {
      reject("silence");
      continue;
    }
    const isWord = p.reason === "caring_word" || p.reason === "gentle_word";
    if (decision.mode === "care" ? p.reason !== "caring_word" : decision.mode === "gentle" ? p.reason !== "gentle_word" : isWord) {
      reject("reason_not_allowed");
      continue;
    }
    if (isWord && !decision.wordGoalIds.includes(p.goalId)) {
      reject("word_not_for_goal");
      continue;
    }
    if (state.quiet) {
      reject("goal_quiet");
      continue;
    }
    if (state.postedToday || postedGoals.has(p.goalId)) {
      reject("already_posted_today");
      continue;
    }
    if (state.recentContact) {
      reject("recent_contact");
      continue;
    }
    if (state.weekdayBlocked) {
      reject("asked_not_today");
      continue;
    }

    const type = p.type ?? undefined;
    if (isWord && (type || p.payload)) {
      reject("word_has_activity");
      continue;
    }
    const def = type ? activityDefinition(type) : undefined;
    if (type && !def?.serves.includes(state.goal.shape)) {
      reject("type_not_for_shape");
      continue;
    }
    // The two reasons that come from the cadence rules belong to their own type, and the other way round.
    if ((p.reason === "review" && type !== "review") || (p.reason === "milestone" && type !== "milestone") || (type === "milestone" && p.reason !== "milestone")) {
      reject("reason_type_mismatch");
      continue;
    }
    if (p.reason === "due" && (!type || !state.dueTypes.includes(type))) {
      reject("nothing_due");
      continue;
    }
    if (p.reason === "rhythm" && (!type || !(state.rhythmDue || cadenceDue(type, state)))) {
      reject("not_due_by_rhythm");
      continue;
    }
    if (p.reason === "follow_up" && (!state.goal.openLoops.length || (type && type !== "check_in"))) {
      reject("no_open_loop");
      continue;
    }

    // Wording.
    const message = p.message.replace(/\s+/g, " ").trim();
    const limit = isWord || !type ? MAX_WORD_CHARS : type === "reading" ? MAX_LEAD_IN_CHARS : MAX_MESSAGE_CHARS;
    const maxSentences = type === "reading" ? MAX_LEAD_IN_SENTENCES : MAX_SENTENCES;
    let payload: Record<string, unknown> | undefined;
    if (type && def) {
      const checked = def.payload.safeParse(p.payload ?? {});
      if (!checked.success) {
        reject("invalid_payload");
        continue;
      }
      payload = checked.data;
      const why = def.check?.(payload, { goal: state.goal, brief }) ?? cadenceDrop(type, payload, state, decision.staleness) ?? cardTextDrop(type, payload, state);
      if (why) {
        reject(why);
        continue;
      }
      if (activitiesPosted >= decision.budget.activitiesLeft) {
        reject("activity_budget");
        continue;
      }
    }

    // The only digits a message may carry are those of the passage it is about.
    // A reading's lead-in may also name the passages it builds on, those the brief already holds.
    const leadInRefs =
      type === "reading"
        ? [
            ...(state.goal.recentWork?.highlights ?? []).map((h) => h.ref),
            ...(state.goal.recentWork?.notes ?? []).map((n) => n.ref),
            ...(state.goal.nextReadings ?? []),
            ...brief.pulse.passagesRead,
          ]
        : [];
    const allowedNumbers = new Set(
      [...(typeof payload?.ref === "string" ? [payload.ref] : []), ...leadInRefs].flatMap((ref) => numbersIn(ref.split(":").slice(1).join(":")))
    );
    const families = sensitiveFamilies(message);
    const known = sensitiveFamilies(threadCorpus(state));
    const wording =
      message.length > limit || sentenceCount(message) > maxSentences
        ? "too_long"
        : DASHES.test(message)
          ? "dash"
          : NUDGE_LANGUAGE.test(message)
            ? "nudge_language"
            : OBSERVATION_CLAIM.test(message)
              ? "unseen_observation"
              : FALSE_PROMISE.test(message)
                ? "false_promise"
                : numbersIn(message).some((n) => !allowedNumbers.has(n))
                  ? "figures_in_message"
                  : scores(message, state, type)
                    ? "grow_scoring"
                    : type === "people" && ASSIGNMENT_LANGUAGE.test(message)
                      ? "people_assignment"
                      : [...families].some((f) => !known.has(f))
                        ? "opens_sensitive_subject"
                        : type === "reading" && READING_STATE_CLAIM.test(message)
                          ? "reading_state_claim"
                          : decision.staleness !== "fresh" && RECENCY_WORDS.test(message)
                            ? "recency_when_stale"
                            : null;
    if (wording) {
      reject(wording);
      continue;
    }

    // The activity and its card.
    let activity: Activity | undefined;
    let card: GuideBlock | undefined;
    const id = type ? activityId(p.goalId, type, today) : `${p.goalId}:word:${today}`;
    if (usedIds.has(id)) {
      reject("duplicate");
      continue;
    }
    if (type && def && payload) {
      const existing = state.goal.activities.find((a) => a.id === id);
      const status = existing ? effectiveStatus(existing, now) : undefined;
      if (existing && status !== "planned" && !(status === "expired" && !existing.postedAt)) {
        reject("duplicate");
        continue;
      }
      if (def.card) {
        const { kind, ...cardArgs } = def.card({ goalId: p.goalId, payload, goal: state.goal });
        const built = await resolveShowBlockCall({
          argumentsJson: JSON.stringify({ kind, ...cardArgs }),
          allowedKinds: [kind],
          userId: args.userId ?? "heartbeat",
          blockId: `block-${id}`,
          goalIds,
          goalShapes,
          noteExcerpts: state.goal.noteExcerpts.map((e) => e.trim()),
        }).catch(() => null);
        if (!built?.ok) {
          reject("card_failed");
          continue;
        }
        // The goal cards the app fills in say which activity they belong to.
        card = ACTIVITY_CARD_KINDS.has(built.block.kind) ? ({ ...built.block, activityId: id } as GuideBlock) : built.block;
      }
      // What it was about, so a later beat can tell (a verse, an excerpt, a completion). Otherwise what a plan said it was for.
      const about = def.noteFor?.(payload, state.goal) ?? existing?.note;
      activity = {
        id,
        goalId: p.goalId,
        type,
        status: "posted",
        scheduledFor: existing?.scheduledFor ?? today,
        ...(existing?.scheduledTime ? { scheduledTime: existing.scheduledTime } : {}),
        expiresAt: existing?.expiresAt ?? expiryFor(type, today, tz),
        message,
        ...(card ? { card } : {}),
        postedAt: now.toISOString(),
        ...(about ? { note: about } : {}),
      };
    }

    // A word never notifies. An activity may, once, and never at night. On a heads-up run the app writes the notification.
    let notify: { at: string; text: string } | undefined;
    if (p.notify && decision.headsUp) drop("notify", "heads_up_run");
    else if (p.notify && (isWord || inQuiet)) drop("notify", isWord ? "word_does_not_notify" : "notify_quiet_hours");
    else if (p.notify) notify = notifyFor(state, p.notify.text, now, "notify") ?? undefined;
    if (activity && notify) activity.notify = notify;

    usedIds.add(id);
    postedGoals.add(p.goalId);
    if (type) {
      activitiesPosted += 1;
      newOnDay.set(today, (newOnDay.get(today) ?? 0) + 1);
    }
    if (activity) {
      out.activities.push({ action: "create", activity });
      out.added.push({ goalId: p.goalId, day: today, posted: true });
      if (decision.headsUp && type) {
        const completion = type === "milestone" ? state.goal.completions?.find((c) => c.id === payload?.completionId) : undefined;
        out.headsUpFacts.push({
          goalId: p.goalId,
          activityId: id,
          type,
          ...(typeof payload?.ref === "string" ? { ref: payload.ref } : {}),
          ...(type === "reading" && p.about ? { about: p.about } : {}),
          timed: activity.scheduledFor === today && activity.scheduledTime !== undefined,
          ...(completion ? { completion: { kind: completion.kind, label: completion.label } } : {}),
        });
      }
    }
    out.posts.push({
      id,
      goalId: p.goalId,
      ...(activity ? { activityId: id } : {}),
      message,
      ...(card ? { card } : {}),
      ...(notify ? { notify } : {}),
      reason: p.reason,
    });
  }

  // MARK: Plan

  const ledger = new Map(brief.goals.flatMap((g) => g.activities.map((a) => [a.id, { goal: g, entry: a }] as const)));
  for (const item of raw.plan ?? []) {
    const plan = modelPlanSchema.safeParse(item);
    if (!plan.success) {
      drop("plan", "invalid");
      continue;
    }
    const p = plan.data;
    if (!planningOpen) {
      drop("plan", "planning_paused");
      continue;
    }
    const inRange = (date: string) => date >= today && daysBetween(today, date) <= PLAN_MAX_DAYS;
    const clearQuietTime = (time: string | null | undefined, what: string): string | undefined => {
      if (!time) return undefined;
      if (isQuietMinute(clockMinutes(time), brief.person.quietHours)) return drop(what, "time_in_quiet_hours"), undefined;
      return time;
    };

    if (p.action === "create") {
      const state = states.get(p.goalId);
      if (!state) {
        drop("plan", "unknown_goal");
        continue;
      }
      const def = activityDefinition(p.type);
      if (!def?.serves.includes(state.goal.shape)) {
        drop("plan", "type_not_for_shape");
        continue;
      }
      if (state.quiet) {
        drop("plan", "goal_quiet");
        continue;
      }
      if (!def.plannable) {
        drop("plan", "not_plannable");
        continue;
      }
      const tooSoon = planCadenceDrop(p.type, state.goal, p.date, tz);
      if (tooSoon) {
        drop("plan", tooSoon);
        continue;
      }
      if (!inRange(p.date)) {
        drop("plan", "date_out_of_range");
        continue;
      }
      const id = activityId(p.goalId, p.type, p.date);
      const existing = ledger.get(id)?.entry;
      const existingStatus = existing ? effectiveStatus(existing, now) : undefined;
      if (usedIds.has(id) || (existing && !(existingStatus === "expired" && !existing.postedAt))) {
        drop("plan", "duplicate");
        continue;
      }
      if (activitiesOn(brief, p.date) + (newOnDay.get(p.date) ?? 0) >= MAX_ACTIVITIES_PER_DAY) {
        drop("plan", "day_is_full");
        continue;
      }
      if (p.note && blockedNote(p.note)) {
        drop("plan", "note_blocked");
        continue;
      }
      const time = clearQuietTime(p.time, "plan");
      let notify: { at: string; text: string } | undefined;
      if (p.notify) {
        const clock = time ?? brief.person.preferredTime;
        const at = clock ? zonedInstant(p.date, clock, tz) : undefined;
        if (!at || at.getTime() < now.getTime()) drop("plan.notify", "no_time_to_notify");
        else notify = notifyFor(state, p.notify.text, at, "plan.notify") ?? undefined;
      }
      usedIds.add(id);
      newOnDay.set(p.date, (newOnDay.get(p.date) ?? 0) + 1);
      out.activities.push({
        action: "create",
        activity: {
          id,
          goalId: p.goalId,
          type: p.type,
          status: "planned",
          scheduledFor: p.date,
          ...(time ? { scheduledTime: time } : {}),
          expiresAt: expiryFor(p.type, p.date, tz),
          ...(p.note ? { note: p.note } : {}),
          ...(notify ? { notify } : {}),
        },
      });
      out.added.push({ goalId: p.goalId, day: p.date, ...(time ? { time } : {}), posted: false });
      continue;
    }

    const found = ledger.get(p.activityId);
    if (!found || effectiveStatus(found.entry, now) !== "planned") {
      drop("plan", found ? "not_planned" : "unknown_activity");
      continue;
    }
    if (p.action === "cancel") {
      out.activities.push({ action: "cancel", activityId: p.activityId });
      continue;
    }
    if (!inRange(p.date)) {
      drop("plan", "date_out_of_range");
      continue;
    }
    const time = clearQuietTime(p.time, "plan");
    out.activities.push({ action: "reschedule", activityId: p.activityId, scheduledFor: p.date, ...(time ? { scheduledTime: time } : {}) });
    out.added.push({ goalId: found.goal.id, day: p.date, ...(time ? { time } : {}), posted: false });
  }

  // MARK: Notes and rhythm

  for (const item of raw.workingNotes ?? []) {
    const n = modelWorkingNotesSchema.safeParse(item);
    const state = n.success ? states.get(n.data.goalId) : undefined;
    if (!n.success || !state) {
      drop("workingNotes", n.success ? "unknown_goal" : "invalid");
    } else if (blockedNote(n.data.notes)) {
      drop("workingNotes", "blocked");
    } else if (n.data.notes !== state.goal.workingNotes && !out.workingNotes.some((w) => w.goalId === n.data.goalId)) {
      out.workingNotes.push({ goalId: n.data.goalId, workingNotes: n.data.notes });
    }
  }

  for (const item of raw.goalChanges ?? []) {
    const c = modelGoalChangeSchema.safeParse(item);
    const state = c.success ? states.get(c.data.goalId) : undefined;
    if (!c.success || !state) drop("goalChange", c.success ? "unknown_goal" : "invalid");
    else if (!isLighterRhythm(state.goal.rhythm, c.data.rhythm)) drop("goalChange", "not_lighter");
    else if (!out.goalChanges.some((g) => g.goalId === c.data.goalId)) out.goalChanges.push(c.data);
  }

  return out;
}
