import { parseReadingRef } from "@/lib/guide/uiBlocks";
import type { ActivityType } from "@/lib/heartbeat/activityRegistry";
import { isDiscreet } from "@/lib/heartbeat/rules";
import type { Brief, GoalFile } from "@/lib/heartbeat/schemas";
import { NEUTRAL_NOTIFICATION_TEXT, NUDGE_LANGUAGE, OBSERVATION_CLAIM, sensitiveFamilies } from "@/lib/heartbeat/terms";

/**
 * What the daily heads-up says (push-engagement-plan.md §5.1, §5.2). The lock screen is public, so
 * the text is a template filled with a passage reference and, for a reading, at most one short line
 * about the passage itself. Code picks the goal it leads with; the model only writes that line.
 */

export const MAX_HEADS_UP_CHARS = 100;

/** One activity this run posted, as the heads-up sees it. */
export type HeadsUpFact = {
  goalId: string;
  activityId: string;
  type: ActivityType;
  /** The passage, BOOK:CHAPTER and so on, when the activity has one. */
  ref?: string;
  /** The model's line about the passage, for a reading. Unchecked. */
  about?: string;
  /** The activity was planned for a time today. */
  timed: boolean;
  /** For a milestone: what was finished. */
  completion?: { kind: "path_step" | "book"; label: string };
};

export type HeadsUp = { goalId: string; activityId: string; text: string };

// MARK: - Time words

type TimeWord = "morning" | "afternoon" | "tonight";

/** The word for a local time of day: before noon, before five, then tonight. */
export const timeWordAt = (minutes: number): TimeWord => (minutes < 12 * 60 ? "morning" : minutes < 17 * 60 ? "afternoon" : "tonight");

const WHEN: Record<TimeWord, { lead: string; possessive: string; trailing: string }> = {
  morning: { lead: "This morning", possessive: "This morning's", trailing: "this morning" },
  afternoon: { lead: "This afternoon", possessive: "This afternoon's", trailing: "this afternoon" },
  tonight: { lead: "Tonight", possessive: "Tonight's", trailing: "tonight" },
};

const TIME_WORD = /\b(morning|afternoon|evening|tonight)\b/gi;

// MARK: - The checks

const numbersIn = (text: string) => text.match(/\d+/g) ?? [];

/** The words for a reference ("John 3", "1 John 2", "Numbers 14 to 16"), or null if it is not one. */
export const passageWords = (ref: string): string | null => parseReadingRef(ref)?.reference ?? null;

/** Every passage reference the brief holds. */
const briefRefs = (brief: Brief): string[] => [
  ...brief.pulse.passagesRead,
  ...brief.goals.flatMap((g) => [...(g.nextReadings ?? []), ...(g.recentWork?.highlights ?? []).map((h) => h.ref), ...(g.recentWork?.notes ?? []).map((n) => n.ref)]),
];

/**
 * Why a heads-up may not be sent as written, or null. Numbers only as part of a passage reference
 * (the brief's, or the one this heads-up names); no exclamation, nudge or claim to have seen something; no
 * discreet goal's title; and a time word only if it is the send time's.
 */
export function headsUpProblem(text: string, ctx: { brief: Brief; sendMinutes: number; refs?: string[] }): string | null {
  if (text.length > MAX_HEADS_UP_CHARS) return "too_long";
  if (text.includes("!")) return "exclamation";
  if (NUDGE_LANGUAGE.test(text)) return "nudge";
  if (OBSERVATION_CLAIM.test(text)) return "observation";
  const lower = text.toLowerCase();
  if (ctx.brief.goals.some((g) => isDiscreet(g) && lower.includes(g.title.toLowerCase()))) return "discreet_goal";
  // Each reference the brief holds is taken out whole; any number left over came from somewhere else.
  const passages = [...briefRefs(ctx.brief), ...(ctx.refs ?? [])].flatMap((ref) => passageWords(ref) ?? []).sort((a, b) => b.length - a.length);
  if (numbersIn(passages.reduce((rest, p) => rest.split(p).join(" "), text)).length) return "number";
  const expected = timeWordAt(ctx.sendMinutes);
  for (const [word] of text.matchAll(TIME_WORD)) {
    const said = word.toLowerCase() === "evening" ? "tonight" : (word.toLowerCase() as TimeWord);
    if (said !== expected) return "time_word";
  }
  return null;
}

const SECOND_PERSON = /\b(you|your|yours|yourself|you're|you've|you'll|you'd)\b/i;

const words = (text: string): string[] => text.toLowerCase().match(/[a-z']+/g) ?? [];

/** Every run of four words in a text. */
const fourGrams = (text: string): Set<string> => {
  const w = words(text);
  return new Set(w.slice(0, Math.max(0, w.length - 3)).map((_, i) => w.slice(i, i + 4).join(" ")));
};

/** What the brief knows about the person, in their words or the Guide's: none of it may reach the lock screen. */
const privateText = (brief: Brief): string => {
  const goalText = (g: GoalFile) => [
    g.title,
    g.why,
    g.progressSummary,
    g.workingNotes,
    ...g.path,
    g.thread.summary,
    ...g.thread.turns.map((t) => t.content),
    ...g.openLoops.map((l) => l.text),
    ...g.relatedMemory,
    ...g.noteExcerpts,
    ...(g.recentWork?.notes ?? []).map((n) => n.text),
    ...(g.recentWork?.journal ?? []).flatMap((j) => [j.title, j.excerpt]),
    ...(g.recentWork?.reflections ?? []).map((r) => r.text),
  ];
  const { person, pulse } = brief;
  return [
    person.seasonNote,
    person.carrying,
    person.hoping,
    ...pulse.conversations.flatMap((c) => [c.summary, ...c.concerns]),
    ...brief.wishes,
    ...brief.goals.flatMap(goalText),
  ]
    .filter(Boolean)
    .join(" . ");
};

/** Why the model's line about a passage may not be used, or null. It is about the passage, never the person. */
export function aboutProblem(about: string, brief: Brief): string | null {
  if (SECOND_PERSON.test(about)) return "about_person";
  const name = brief.person.firstName?.trim().toLowerCase();
  if (name && words(about).includes(name)) return "about_person";
  if (numbersIn(about).length) return "number";
  if (sensitiveFamilies(about).size) return "sensitive";
  const lower = about.toLowerCase();
  if (brief.goals.some((g) => lower.includes(g.title.toLowerCase()))) return "from_brief";
  const shared = fourGrams(privateText(brief));
  if ([...fourGrams(about)].some((g) => shared.has(g))) return "from_brief";
  return null;
}

// MARK: - The templates

const READY: Partial<Record<ActivityType, string>> = {
  check_in: "a quick question",
  reflection: "a question to sit with",
  prayer: "a prayer",
  review: "a short look back",
  lesson: "a short lesson",
  memorize: "a verse to carry",
  step: "a small next step",
  people: "a small next step",
  note_recall: "something you wrote",
};

/** A clause that follows "we're reading John 3, ": no ending stop. */
const clause = (about: string) => about.trim().replace(/[.\s]+$/, "");

/** The candidates for one activity, most specific first. */
function candidates(fact: HeadsUpFact, when: TimeWord): string[] {
  const w = WHEN[when];
  const passage = fact.ref ? passageWords(fact.ref) : null;
  if (fact.type === "reading" && passage) {
    return [...(fact.about ? [`${w.lead} we're reading ${passage}, ${clause(fact.about)}.`] : []), `${w.possessive} reading is ${passage}.`];
  }
  if (fact.type === "milestone" && fact.completion) {
    return [
      ...(fact.completion.kind === "book" ? [`You finished ${fact.completion.label}. I put together a look back.`] : []),
      "You finished a step. I put together a look back.",
    ];
  }
  const ready = READY[fact.type];
  if (!ready) return [];
  return [...(passage ? [`I have ${ready} from ${passage} ready for you ${w.trailing}.`] : []), `I have ${ready} ready for you ${w.trailing}.`];
}

// MARK: - The lead

/**
 * The goal the heads-up leads with, among the activities this run posted (§5.2): one planned for a
 * time today first, then the goal the person was active in most recently. A goal with its
 * notifications off is never chosen, and care mode sends no heads-up at all.
 */
export function chooseLead(brief: Brief, facts: HeadsUpFact[], careMode: boolean): HeadsUpFact | null {
  if (careMode) return null;
  const goals = new Map(brief.goals.map((g) => [g.id, g]));
  const active = (f: HeadsUpFact) => {
    const at = goals.get(f.goalId)?.lastActivityAt;
    return at ? Date.parse(at) : -Infinity;
  };
  const eligible = facts.filter((f) => goals.has(f.goalId) && goals.get(f.goalId)!.notificationsOn !== false);
  return [...eligible].sort((a, b) => Number(b.timed) - Number(a.timed) || active(b) - active(a))[0] ?? null;
}

/**
 * The heads-up for a run: its lead, and the first template that passes the check. A discreet lead,
 * or nothing that passes, gives the neutral line, which the device keeps as it arrived.
 */
export function composeHeadsUp(args: { brief: Brief; facts: HeadsUpFact[]; careMode: boolean; sendMinutes: number }): HeadsUp | null {
  const lead = chooseLead(args.brief, args.facts, args.careMode);
  if (!lead) return null;
  const goal = args.brief.goals.find((g) => g.id === lead.goalId)!;
  const head = { goalId: lead.goalId, activityId: lead.activityId };
  if (isDiscreet(goal)) return { ...head, text: NEUTRAL_NOTIFICATION_TEXT };
  const about = lead.about && !aboutProblem(lead.about, args.brief) ? lead.about : undefined;
  const ctx = { brief: args.brief, sendMinutes: args.sendMinutes, refs: lead.ref ? [lead.ref] : [] };
  const text = candidates({ ...lead, about }, timeWordAt(args.sendMinutes)).find((t) => !headsUpProblem(t, ctx));
  return { ...head, text: text ?? NEUTRAL_NOTIFICATION_TEXT };
}
