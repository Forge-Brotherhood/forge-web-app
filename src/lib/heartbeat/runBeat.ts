import { BEAT_SYSTEM_PROMPT, renderBeatInput } from "@/lib/heartbeat/prompt";
import type { BeatModel } from "@/lib/heartbeat/model";
import { composeHeadsUp } from "@/lib/heartbeat/headsUpText";
import { decide, nextBeatAt } from "@/lib/heartbeat/rules";
import type { BeatOutput, BeatTrigger, Brief } from "@/lib/heartbeat/schemas";
import { validateBeat } from "@/lib/heartbeat/validate";

/**
 * One beat: the brief in, what to do about it out. Rules first, so most beats end without a model
 * call. When something does need deciding there is one model call, and then everything it said is
 * checked in code and whatever fails is dropped. Nothing is stored or logged here.
 */

export const QUIET_NOTE = "Went quiet:";

/** What the Guide keeps in its notes once a goal has gone quiet, so it asks next time they talk. */
const quietNote = (unanswered: number, existing: string | undefined): string => {
  const line = `${QUIET_NOTE} ${unanswered} posts went unanswered. When they next talk, ask whether this still matters.`;
  return `${line} ${existing ?? ""}`.trim().slice(0, 1000);
};

export async function runBeat(
  brief: Brief,
  now: Date,
  options: {
    trigger: BeatTrigger;
    callModel: BeatModel;
    /** Whose reader settings a passage card uses for its translation. */
    userId?: string;
    /** Asked just before a model call. False skips the call (a daily limit, for one). */
    allowModel?: () => Promise<boolean>;
    /** A server run at one of the device's send times. */
    headsUp?: boolean;
  }
): Promise<BeatOutput> {
  const decision = decide(brief, now, options.trigger, { headsUp: options.headsUp });

  let raw: unknown = {};
  let modelCalled = false;
  const pre: BeatOutput["meta"]["dropped"] = [];
  if (decision.needsModel) {
    if (options.allowModel && !(await options.allowModel())) {
      pre.push({ what: "model", code: "daily_limit" });
    } else {
      modelCalled = true;
      try {
        raw = await options.callModel({ system: BEAT_SYSTEM_PROMPT, user: renderBeatInput(brief, decision, now) });
      } catch {
        pre.push({ what: "model", code: "failed" });
      }
    }
  }

  const checked = await validateBeat({ brief, now, decision, raw, userId: options.userId });

  // A goal left unanswered this long goes quiet. That needs no model: the Guide's notes say so.
  const workingNotes = [...checked.workingNotes];
  if (decision.mode === "normal") {
    for (const s of decision.goals.filter((g) => g.quiet)) {
      const own = workingNotes.find((w) => w.goalId === s.goal.id);
      const current = own?.workingNotes ?? s.goal.workingNotes;
      if (current?.startsWith(QUIET_NOTE)) continue;
      const updated = quietNote(s.unanswered, current);
      if (own) own.workingNotes = updated;
      else workingNotes.push({ goalId: s.goal.id, workingNotes: updated });
    }
  }

  const headsUp = decision.headsUp
    ? composeHeadsUp({ brief, facts: checked.headsUpFacts, careMode: decision.careMode, sendMinutes: decision.today.minutes })
    : null;

  return {
    v: 1,
    goalChanges: checked.goalChanges,
    activities: checked.activities,
    posts: checked.posts,
    workingNotes,
    ...(headsUp ? { headsUp } : {}),
    nextBeatAt: nextBeatAt({ brief, now, decision, added: checked.added }).toISOString(),
    meta: { staleness: decision.staleness, careMode: decision.careMode, modelCalled, dropped: [...pre, ...checked.dropped] },
  };
}
