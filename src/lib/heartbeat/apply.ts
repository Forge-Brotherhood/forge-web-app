import { BRIEF_MAX_CHARS, briefSchema, type BeatOutput, type Brief, type GoalFile, type LedgerEntry } from "@/lib/heartbeat/schemas";

/**
 * What the app does with a beat's result (plan 13.4), done on the server's copy of the brief so the
 * next server beat sees what this one did: a post that was made, an activity that was planned, notes
 * that were rewritten. It is a new copy; the input is untouched.
 *
 * `freshness` is left alone on purpose. It records when a device last wrote each section, and the
 * staleness rules (and so the grant's lapse) depend on it. Only a device may move it.
 */

const MAX_LEDGER = 20;
const MAX_TURNS = 12;
const BEYOND_CREATED = new Set<LedgerEntry["status"]>(["started", "done", "skipped"]);

const toLedger = (a: Extract<BeatOutput["activities"][number], { action: "create" }>["activity"]): LedgerEntry => ({
  id: a.id,
  type: a.type,
  status: a.status,
  scheduledFor: a.scheduledFor,
  ...(a.scheduledTime ? { scheduledTime: a.scheduledTime } : {}),
  expiresAt: a.expiresAt,
  ...(a.postedAt ? { postedAt: a.postedAt } : {}),
  ...(a.note ? { note: a.note } : {}),
});

/**
 * The ledger sorted by date, cut to `MAX_LEDGER`. The newest entry of each activity type always stays, since
 * the cadence rules read it (a memorize showing, a recall, the last review); the rest of the room goes to the newest by date.
 */
function trimLedger(entries: LedgerEntry[]): LedgerEntry[] {
  const sorted = [...entries].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  if (sorted.length <= MAX_LEDGER) return sorted;
  const keep = new Set<number>();
  const seen = new Set<LedgerEntry["type"]>();
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (!seen.has(sorted[i].type)) {
      seen.add(sorted[i].type);
      keep.add(i);
    }
  }
  for (let i = sorted.length - 1; i >= 0 && keep.size < MAX_LEDGER; i--) keep.add(i);
  return sorted.filter((_, i) => keep.has(i));
}

/** The brief as it stands after the result is applied, or null if it cannot be made to fit the brief's own limits. */
export function applyBeat(brief: Brief, output: BeatOutput, now: Date): Brief | null {
  const goals = new Map<string, GoalFile>(brief.goals.map((g) => [g.id, { ...g, activities: [...g.activities], thread: { ...g.thread, turns: [...g.thread.turns] } }]));

  for (const change of output.goalChanges) {
    const goal = goals.get(change.goalId);
    if (goal) goal.rhythm = change.rhythm;
  }

  for (const op of output.activities) {
    if (op.action === "create") {
      const goal = goals.get(op.activity.goalId);
      if (!goal) continue;
      const at = goal.activities.findIndex((a) => a.id === op.activity.id);
      // Further along than posted, the stored one stands.
      if (at >= 0 && BEYOND_CREATED.has(goal.activities[at].status)) continue;
      if (at >= 0) goal.activities[at] = { ...goal.activities[at], ...toLedger(op.activity) };
      else goal.activities.push(toLedger(op.activity));
      continue;
    }
    for (const goal of goals.values()) {
      const at = goal.activities.findIndex((a) => a.id === op.activityId);
      if (at < 0 || goal.activities[at].status !== "planned") continue;
      if (op.action === "reschedule") {
        const { scheduledTime: _dropped, ...rest } = goal.activities[at];
        goal.activities[at] = { ...rest, scheduledFor: op.scheduledFor, ...(op.scheduledTime ? { scheduledTime: op.scheduledTime } : {}) };
      } else {
        goal.activities[at] = { ...goal.activities[at], status: "expired" };
      }
    }
  }

  for (const post of output.posts) {
    goals.get(post.goalId)?.thread.turns.push({ role: "assistant", content: post.message.slice(0, 600), at: now.toISOString() });
  }

  for (const notes of output.workingNotes) {
    const goal = goals.get(notes.goalId);
    if (goal) goal.workingNotes = notes.workingNotes;
  }

  for (const goal of goals.values()) {
    goal.activities = trimLedger(goal.activities);
    goal.thread.turns = goal.thread.turns.slice(-MAX_TURNS);
  }

  const next: Brief = { ...brief, goals: brief.goals.map((g) => goals.get(g.id)!) };

  // Over the brief's size limit: let the oldest turns go first.
  while (JSON.stringify(next).length > BRIEF_MAX_CHARS) {
    const goal = next.goals.find((g) => g.thread.turns.length > 0);
    if (!goal) return null;
    goal.thread.turns.shift();
  }
  return briefSchema.safeParse(next).success ? next : null;
}

/**
 * What goes in an outbox item: the beat's result as the app applies it (plan 13.4), without `meta`.
 * Null when the beat changed nothing, so a quiet run leaves nothing for the app to take.
 */
export type OutboxItem = Pick<BeatOutput, "v" | "goalChanges" | "activities" | "posts" | "workingNotes" | "nextBeatAt"> & { createdAt: string };

export function outboxItemFor(output: BeatOutput, now: Date): OutboxItem | null {
  const { goalChanges, activities, posts, workingNotes } = output;
  if (!goalChanges.length && !activities.length && !posts.length && !workingNotes.length) return null;
  return { v: 1, createdAt: now.toISOString(), goalChanges, activities, posts, workingNotes, nextBeatAt: output.nextBeatAt };
}
