import assert from "node:assert/strict";
import { test } from "node:test";

import { applyBeat, outboxItemFor } from "./apply";
import { FIXTURE_NOW, at, entry, fixture, goal, makeBrief } from "./fixtures";
import { BRIEF_MAX_CHARS, briefSchema, type BeatOutput } from "./schemas";

const output = (over: Partial<BeatOutput> = {}): BeatOutput => ({
  v: 1,
  goalChanges: [],
  activities: [],
  posts: [],
  workingNotes: [],
  nextBeatAt: "2026-11-24T12:00:00.000Z",
  meta: { staleness: "fresh", careMode: false, modelCalled: false, dropped: [] },
  ...over,
});

const created = (id: string, status: "planned" | "posted" | "done", over: object = {}) => ({
  action: "create" as const,
  activity: { id, goalId: "g-bible", type: "reading" as const, status, scheduledFor: id.slice(-10), expiresAt: "2026-11-30T04:59:59.000Z", ...over },
});

test("a post becomes an assistant turn, an activity enters the ledger, notes and rhythm are replaced, the input is untouched", () => {
  const input = fixture("finish-due").brief;
  const before = JSON.stringify(input);
  const next = applyBeat(
    input,
    output({
      goalChanges: [{ goalId: "g-bible", rhythm: "few_per_week" }],
      activities: [created("g-bible:reading:2026-11-23", "posted", { message: "Today's is Numbers 14.", postedAt: FIXTURE_NOW.toISOString() }), created("g-bible:reading:2026-11-24", "planned")],
      posts: [{ id: "g-bible:reading:2026-11-23", goalId: "g-bible", activityId: "g-bible:reading:2026-11-23", message: "Today's is Numbers 14.", reason: "due" }],
      workingNotes: [{ goalId: "g-bible", workingNotes: "New notes." }],
    }),
    FIXTURE_NOW
  )!;
  assert.equal(JSON.stringify(input), before);
  const g = next.goals[0];
  assert.equal(g.rhythm, "few_per_week");
  assert.equal(g.workingNotes, "New notes.");
  assert.equal(g.activities.find((a) => a.id === "g-bible:reading:2026-11-23")?.status, "posted", "the planned slot is posted in place");
  assert.equal(g.activities.find((a) => a.id === "g-bible:reading:2026-11-23")?.postedAt, FIXTURE_NOW.toISOString());
  assert.equal(g.activities.filter((a) => a.id === "g-bible:reading:2026-11-23").length, 1);
  assert.ok(g.activities.some((a) => a.id === "g-bible:reading:2026-11-24" && a.status === "planned"));
  assert.deepEqual(g.thread.turns.at(-1), { role: "assistant", content: "Today's is Numbers 14.", at: FIXTURE_NOW.toISOString() });
  assert.deepEqual(next.freshness, input.freshness);
  assert.ok(briefSchema.safeParse(next).success);
});

test("an activity already further along is kept; reschedule and cancel touch only planned ones", () => {
  const g = goal({
    id: "g-bible", title: "Bible", shape: "finish", category: "reading",
    activities: [
      entry("g-bible", "reading", -1, "done", { outcome: { at: at(-1) } }),
      entry("g-bible", "reading", 0, "planned"),
      entry("g-bible", "reading", 1, "planned"),
    ],
  });
  const brief = makeBrief([g]);
  const next = applyBeat(
    brief,
    output({
      activities: [
        created("g-bible:reading:2026-11-22", "posted"),
        { action: "reschedule", activityId: "g-bible:reading:2026-11-23", scheduledFor: "2026-11-25", scheduledTime: "08:00" },
        { action: "cancel", activityId: "g-bible:reading:2026-11-24" },
        { action: "cancel", activityId: "g-bible:reading:2026-11-22" },
      ],
    }),
    FIXTURE_NOW
  )!;
  const by = (id: string) => next.goals[0].activities.find((a) => a.id === id)!;
  assert.equal(by("g-bible:reading:2026-11-22").status, "done");
  assert.deepEqual([by("g-bible:reading:2026-11-23").scheduledFor, by("g-bible:reading:2026-11-23").scheduledTime], ["2026-11-25", "08:00"]);
  assert.equal(by("g-bible:reading:2026-11-24").status, "expired");
});

test("the ledger keeps the last 20, the thread the last 12 turns, and the brief stays within its size", () => {
  const many = Array.from({ length: 22 }, (_, i) => entry("g1", "reading", i - 21, "done"));
  const turns = Array.from({ length: 12 }, (_, i) => ({ role: "user" as const, content: "x".repeat(600), at: at(-1, "08:30") }));
  const g = goal({ id: "g1", title: "G", shape: "finish", category: "reading", activities: many.slice(0, 20), thread: { turns } });
  const next = applyBeat(
    makeBrief([g]),
    output({
      activities: [created("g1:reading:2026-11-23", "planned", { goalId: "g1" }), created("g1:reading:2026-11-24", "planned", { goalId: "g1" })],
      posts: [{ id: "p", goalId: "g1", message: "A short word.", reason: "rhythm" }],
    }),
    FIXTURE_NOW
  )!;
  assert.equal(next.goals[0].activities.length, 20);
  assert.equal(next.goals[0].activities.at(-1)?.scheduledFor, "2026-11-24");
  assert.ok(next.goals[0].thread.turns.length <= 12);
  assert.ok(JSON.stringify(next).length <= BRIEF_MAX_CHARS);
});

test("the ledger trim keeps the newest entry of each type, even an old one, then fills by date, within the cap and in order", () => {
  const filler = Array.from({ length: 20 }, (_, i) => entry("g1", "reading", i - 19, "done"));
  const oldMemorize = entry("g1", "memorize", -40, "done", { note: "verse:PSA:23:1-3" });
  const olderMemorize = entry("g1", "memorize", -50, "done", { note: "verse:PSA:46:1" });
  const oldRecall = entry("g1", "note_recall", -35, "done", { note: "excerpt" });
  const g = goal({ id: "g1", title: "G", shape: "practice", category: "prayer", activities: [oldMemorize, olderMemorize, oldRecall, ...filler.slice(0, 17)] });
  const next = applyBeat(
    makeBrief([g]),
    output({ activities: [created("g1:reading:2026-11-23", "planned", { goalId: "g1" }), created("g1:reading:2026-11-24", "planned", { goalId: "g1" })] }),
    FIXTURE_NOW
  )!;
  const ledger = next.goals[0].activities;
  assert.equal(ledger.length, 20, "the cap holds");
  assert.ok(ledger.some((a) => a.id === oldMemorize.id), "the newest memorize survives although it is the oldest by date");
  assert.ok(ledger.some((a) => a.id === oldRecall.id), "the newest note_recall survives");
  assert.ok(!ledger.some((a) => a.id === olderMemorize.id), "an older entry of a type that has a newer one is trimmed");
  assert.equal(ledger.at(-1)?.scheduledFor, "2026-11-24", "the rest is filled by date, newest first");
  assert.deepEqual(ledger.map((a) => a.scheduledFor), [...ledger.map((a) => a.scheduledFor)].sort(), "the order is by date");
  assert.ok(briefSchema.safeParse(next).success);
});

test("the ledger trim is stable: entries with the same date keep their order, and a ledger within the cap is untouched", () => {
  const same = ["a", "b", "c"].map((n) => entry("g1", "reading", -1, "done", { id: `g1:reading:2026-11-22:${n}` }));
  const g = goal({ id: "g1", title: "G", shape: "finish", category: "reading", activities: same });
  const next = applyBeat(makeBrief([g]), output(), FIXTURE_NOW)!;
  assert.deepEqual(next.goals[0].activities.map((a) => a.id), same.map((a) => a.id));
});

test("an item for the outbox is only made when something changed, and carries no meta", () => {
  assert.equal(outboxItemFor(output(), FIXTURE_NOW), null);
  const item = outboxItemFor(output({ workingNotes: [{ goalId: "g", workingNotes: "n" }] }), FIXTURE_NOW)!;
  assert.deepEqual(Object.keys(item).sort(), ["activities", "createdAt", "goalChanges", "nextBeatAt", "posts", "v", "workingNotes"]);
});
