import { createHash } from "node:crypto";
import type { CaseRun, EvalCheck, EvalSuite } from "@/lib/evals/types";
import { FIXTURES, FIXTURE_NOW, type Fixture } from "@/lib/heartbeat/fixtures";
import { BEAT_MODEL, callBeatModel, type BeatModel } from "@/lib/heartbeat/model";
import { BEAT_SYSTEM_PROMPT, renderBeatInput } from "@/lib/heartbeat/prompt";
import { decide } from "@/lib/heartbeat/rules";
import { runBeat } from "@/lib/heartbeat/runBeat";
import type { BeatOutput } from "@/lib/heartbeat/schemas";

/**
 * The heartbeat replay: every fixture in src/lib/heartbeat/fixtures through a beat with the real
 * model, at the fixtures' fixed clock (Monday 10:00 in New York). The code checks are the beat's
 * own (validate.ts): anything it dropped is a check that failed. The grader then reads what was
 * kept against guide-soul.md §2.3 and §2.4 and the fixture's own expectation.
 */

/** Drop codes from validate.ts that are about how a message is worded, not about what the rules allow. */
const WORDING_CODES = new Set([
  "too_long",
  "dash",
  "nudge_language",
  "unseen_observation",
  "false_promise",
  "figures_in_message",
  "grow_scoring",
  "people_assignment",
  "opens_sensitive_subject",
  "reading_state_claim",
  "recency_when_stale",
]);
const isWording = (code: string) => WORDING_CODES.has(code) || (code.startsWith("card_") && code !== "card_failed");
const isNoAnswer = (d: { what: string; code: string }) => (d.what === "model" && d.code === "failed") || (d.what === "output" && d.code === "invalid");

const listDrops = (drops: BeatOutput["meta"]["dropped"]) => drops.map((d) => `${d.what}:${d.code}`).join(", ");

/** The code checks of one beat, read from what it dropped. A beat that asked no model has nothing to check. */
export const beatChecks = (output: BeatOutput): EvalCheck[] => {
  if (!output.meta.modelCalled) return [];
  const drops = output.meta.dropped;
  const noAnswer = drops.filter(isNoAnswer);
  const wording = drops.filter((d) => !isNoAnswer(d) && isWording(d.code));
  const rules = drops.filter((d) => !isNoAnswer(d) && !isWording(d.code));
  return [
    { name: "Answered in the expected shape", pass: !noAnswer.length, ...(noAnswer.length ? { detail: listDrops(noAnswer) } : {}) },
    { name: "Wording passed the code checks", pass: !wording.length, ...(wording.length ? { detail: listDrops(wording) } : {}) },
    { name: "Kept to the rules", pass: !rules.length, ...(rules.length ? { detail: listDrops(rules) } : {}) },
  ];
};

/** What a beat did, as a person reads it (and as the grader sees it). */
export const describeBeat = (output: BeatOutput): string => {
  const lines = [`Brief ${output.meta.staleness}, care mode ${output.meta.careMode}, model called ${output.meta.modelCalled ? "yes" : "no"}.`, "", "Posts kept:"];
  if (!output.posts.length) lines.push("  (none)");
  for (const p of output.posts) {
    lines.push(`  [${p.reason}] ${p.message}`);
    if (p.card) lines.push(`    card: ${p.card.kind} ${(p.card as { fallback_text?: string }).fallback_text ?? ""}`.trimEnd());
    if (p.notify) lines.push(`    notification: ${p.notify.text}`);
  }
  const plans = output.activities.filter((a) => a.action !== "create" || a.activity.status === "planned");
  lines.push("Planned:");
  if (!plans.length) lines.push("  (none)");
  for (const a of plans) {
    lines.push(
      a.action === "create"
        ? `  ${a.activity.type} on ${a.activity.scheduledFor}${a.activity.scheduledTime ? ` ${a.activity.scheduledTime}` : ""}${a.activity.note ? ` (${a.activity.note})` : ""}${a.activity.notify ? `, notification: ${a.activity.notify.text}` : ""}`
        : `  ${a.action} ${a.activityId}`
    );
  }
  for (const w of output.workingNotes) lines.push(`Working notes (${w.goalId}): ${w.workingNotes}`);
  for (const g of output.goalChanges) lines.push(`Rhythm of ${g.goalId} lightened to ${g.rhythm}`);
  if (output.meta.dropped.length) lines.push(`Dropped by the code: ${listDrops(output.meta.dropped)}`);
  return lines.join("\n");
};

/** One beat of a fixture, with the model's own answer kept for reading. */
export async function runHeartbeatCase(f: Fixture, callModel: BeatModel): Promise<CaseRun> {
  let raw: unknown = undefined;
  const output = await runBeat(f.brief, FIXTURE_NOW, {
    trigger: f.trigger,
    callModel: async (input) => (raw = await callModel(input)),
  });
  return { output: describeBeat(output), raw, checks: beatChecks(output), gradable: output.meta.modelCalled };
}

const RUBRIC = `This is one heartbeat beat of the Guide (shown to people as Lumen), a Bible app's AI guide who should sound like a pastor who knows them well. Between conversations the beat looks over a person's goals and may leave a message (a post) in a goal's thread, send a lock-screen notification, plan coming days and keep working notes. Grade what the person would see: each kept post's message and every notification text. Plans and working notes are context.

Every message and notification must hold to all of these:
1. Close-pastor voice: full, ordinary sentences, warm and plain, the way a pastor who knows them would talk across a table. Starts with the person, says "we" rather than standing above them, gives its view with conviction.
2. No chatbot tells: no "Great question", "It sounds like", "I hope this helps"; no lists or headers; no hedging; no therapy or corporate words ("valid", "hold space", "navigate", "resources", "journey"); no talk about being an AI, the app, memory or tools.
3. No quips or punchlines: no "not X, it's Y" reversal or other sentence built on a contrast, no clever wordplay, no dramatic fragments, no neat closing line written to be quoted.
4. No guilt or pressure: no streaks, no counts of days or missed days, no "you haven't", no "you should", no pace talk.
5. No em dashes. No pet names, flattery or emotional mirroring.
6. No invented life and no promises the app cannot keep ("I'll be praying for you", "I'll check in").
7. True to the brief: says only what the brief shows, claims to have seen nothing it cannot see, and never raises a heavy subject the goal's thread is not already on.
8. A notification carries nothing private: no concerns or struggles, no people's names, no discreet goal's title.
9. It does what "a good output" describes. When that is silence, posting nothing is the pass.`;

const byName = new Map(FIXTURES.map((f) => [f.name, f]));
const fixtureFor = (caseId: string): Fixture => {
  const f = byName.get(caseId);
  if (!f) throw new Error(`No heartbeat fixture ${caseId}`);
  return f;
};

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 8);

export const heartbeatSuite: EvalSuite = {
  id: "heartbeat",
  title: "Heartbeat beats",
  description:
    "Every heartbeat fixture through a beat with the real model, at a fixed clock. Checks are the beat's own code checks; the grader reads the kept posts and notifications against guide-soul.md §2.3 and §2.4.",
  repeats: 3,
  version: `${BEAT_MODEL}, prompt ${hash(BEAT_SYSTEM_PROMPT)}, rubric ${hash(RUBRIC)}`,
  rubric: RUBRIC,
  cases: FIXTURES.map((f) => ({ id: f.name, title: f.name, input: f.description, expect: f.expect })),
  promptChars: (caseId) => {
    const f = fixtureFor(caseId);
    const decision = decide(f.brief, FIXTURE_NOW, f.trigger);
    return decision.needsModel ? BEAT_SYSTEM_PROMPT.length + renderBeatInput(f.brief, decision, FIXTURE_NOW).length : 0;
  },
  graderContext: (caseId) => `The brief the beat was given (synthetic): ${JSON.stringify(fixtureFor(caseId).brief)}`,
  run: (caseId) => runHeartbeatCase(fixtureFor(caseId), callBeatModel),
};
