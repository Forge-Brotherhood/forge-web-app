// The parts of the evals that need no model and no database: the heartbeat suite's checks with a
// scripted model, the runner, the grader's prompt and answer, the cost estimate and run comparison.
import assert from "node:assert/strict";
import { test } from "node:test";

import { compareRuns } from "./compare";
import { caseUsd, estimateUsd } from "./cost";
import { graderInput, parseGrade } from "./grader";
import { runItem } from "./runner";
import { EVAL_SUITES, evalSuite } from "./suites";
import { chatChecks, chatNotificationsSuite, describeChat, type ChatTurn } from "./suites/chatNotifications";
import { beatChecks, heartbeatSuite, runHeartbeatCase } from "./suites/heartbeat";
import type { EvalSuite } from "./types";
import { FIXTURES, fixture } from "@/lib/heartbeat/fixtures";
import type { BeatOutput } from "@/lib/heartbeat/schemas";

const reading = (message: string) => ({ goalId: "g-bible", reason: "due", type: "reading", payload: { ref: "NUM:14" }, message });

const meta = (modelCalled: boolean, dropped: BeatOutput["meta"]["dropped"]): BeatOutput =>
  ({ meta: { staleness: "fresh", careMode: false, modelCalled, dropped } }) as unknown as BeatOutput;

test("every suite has a unique id and unique case ids, and the heartbeat suite is every fixture", () => {
  assert.equal(new Set(EVAL_SUITES.map((s) => s.id)).size, EVAL_SUITES.length);
  for (const s of EVAL_SUITES) assert.equal(new Set(s.cases.map((c) => c.id)).size, s.cases.length, s.id);
  assert.deepEqual(heartbeatSuite.cases.map((c) => c.id), FIXTURES.map((f) => f.name));
  assert.equal(evalSuite("heartbeat"), heartbeatSuite);
  assert.equal(evalSuite("nope"), undefined);
});

test("a beat's drops become its checks: no answer, wording and rules apart", () => {
  assert.deepEqual(beatChecks(meta(false, [])), [], "no model call, nothing to check");
  assert.ok(beatChecks(meta(true, [])).every((c) => c.pass));

  const checks = beatChecks(
    meta(true, [
      { what: "post", code: "dash" },
      { what: "post", code: "card_nudge_language" },
      { what: "post", code: "card_failed" },
      { what: "plan", code: "day_is_full" },
    ])
  );
  const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
  assert.equal(byName["Answered in the expected shape"].pass, true);
  assert.deepEqual(byName["Wording passed the code checks"], { name: "Wording passed the code checks", pass: false, detail: "post:dash, post:card_nudge_language" });
  assert.deepEqual(byName["Kept to the rules"], { name: "Kept to the rules", pass: false, detail: "post:card_failed, plan:day_is_full" });

  const failed = beatChecks(meta(true, [{ what: "model", code: "failed" }]));
  assert.equal(failed.find((c) => c.name === "Answered in the expected shape")?.pass, false);
  assert.ok(failed.filter((c) => c.name !== "Answered in the expected shape").every((c) => c.pass));
});

test("a heartbeat case with a scripted model keeps the raw answer and fails on what the code dropped", async () => {
  const answer = { posts: [reading("Today's is Numbers 14 — a short one.")] };
  const run = await runHeartbeatCase(fixture("finish-due"), async () => answer);
  assert.equal(run.gradable, true);
  assert.deepEqual(run.raw, answer);
  assert.equal(run.checks.find((c) => c.name === "Wording passed the code checks")?.detail, "post:dash");
  assert.match(run.output, /model called yes/);
  assert.match(run.output, /Posts kept:\n {2}\(none\)/);
  assert.match(run.output, /Dropped by the code: post:dash/);
});

test("a case the rules settle asks no model, costs nothing and is not graded", async () => {
  let asked = false;
  const run = await runHeartbeatCase(fixture("nothing-due"), async () => ((asked = true), {}));
  assert.equal(asked, false);
  assert.equal(run.gradable, false);
  assert.deepEqual(run.checks, []);
  assert.equal(heartbeatSuite.promptChars("nothing-due"), 0);
  assert.equal(caseUsd(heartbeatSuite, "nothing-due"), 0);
  assert.equal(caseUsd(heartbeatSuite, "stale-16-days"), 0);
});

test("the cost estimate grows with the cases and repeats chosen", () => {
  const one = caseUsd(heartbeatSuite, "finish-due");
  assert.ok(one > 0.001 && one < 0.5, `one run of a case is cents, not dollars (${one})`);
  assert.equal(estimateUsd(heartbeatSuite, ["finish-due"], 3), one * 3);
  assert.equal(estimateUsd(heartbeatSuite, ["finish-due", "nothing-due"], 1), one);
  const all = estimateUsd(heartbeatSuite, heartbeatSuite.cases.map((c) => c.id), heartbeatSuite.repeats);
  assert.ok(all > one * 3);
});

test("the grader is given the rubric, the input, what good looks like and the output; its answer must be pass or fail with a reason", () => {
  const input = graderInput({
    rubric: "No dashes.",
    evalCase: { id: "x", title: "x", input: "A brief.", expect: "Say little." },
    context: "The brief: {}",
    output: "Hello.",
  });
  for (const part of ["RUBRIC:\nNo dashes.", "THE INPUT: A brief.", "The brief: {}", "A GOOD OUTPUT: Say little.", "THE OUTPUT:\nHello.", "JSON"]) {
    assert.ok(input.includes(part), part);
  }
  assert.ok(!graderInput({ rubric: "r", evalCase: { id: "x", title: "x", input: "i", expect: "e" }, context: "", output: "o" }).includes("DETAILS"));

  assert.deepEqual(parseGrade({ pass: false, reason: " Uses a dash. " }), { pass: false, reason: "Uses a dash." });
  assert.equal(parseGrade({ pass: "yes", reason: "ok" }), null);
  assert.equal(parseGrade({ pass: true, reason: "" }), null);
  assert.equal(parseGrade(null), null);
});

const fakeSuite = (run: EvalSuite["run"]): EvalSuite => ({
  id: "fake",
  title: "Fake",
  description: "",
  repeats: 1,
  version: "v",
  rubric: "Be kind.",
  cases: [{ id: "a", title: "a", input: "in", expect: "kind" }],
  promptChars: () => 100,
  graderContext: () => "",
  run,
});

test("an item passes only when every check and the grader pass, and a failure is kept as its error", async () => {
  const pass = async () => ({ pass: true, reason: "Kind." });
  const fail = async () => ({ pass: false, reason: "Unkind." });
  const good = fakeSuite(async () => ({ output: "Hi.", checks: [{ name: "c", pass: true }], gradable: true }));

  assert.equal((await runItem(good, "a", 1, pass)).passed, true);
  const graded = await runItem(good, "a", 2, fail);
  assert.deepEqual([graded.passed, graded.grade, graded.repeat], [false, { pass: false, reason: "Unkind." }, 2]);

  const badCheck = fakeSuite(async () => ({ output: "Hi.", checks: [{ name: "c", pass: false }], gradable: true }));
  assert.equal((await runItem(badCheck, "a", 1, pass)).passed, false);

  let graderAsked = false;
  const ungraded = fakeSuite(async () => ({ output: "", checks: [], gradable: false }));
  const r = await runItem(ungraded, "a", 1, async () => ((graderAsked = true), { pass: false, reason: "x" }));
  assert.deepEqual([r.passed, r.grade, graderAsked], [true, null, false]);

  const broken = await runItem(good, "a", 1, async () => {
    throw new Error("OpenAI API error: 500");
  });
  assert.deepEqual([broken.passed, broken.error, broken.output], [false, "OpenAI API error: 500", "Hi."]);

  await assert.rejects(runItem(good, "nope", 1, pass), /No case nope/);
});

test("comparing two runs puts what got worse first, then what got better", () => {
  const r = (caseId: string, passed: boolean) => ({ caseId, passed });
  const cases = compareRuns(
    [r("a", true), r("a", true), r("b", false), r("c", true), r("d", true)],
    [r("a", true), r("a", false), r("b", true), r("c", true), r("e", false)]
  );
  assert.deepEqual(
    cases.map((c) => [c.caseId, c.change]),
    [
      ["a", "worse"],
      ["b", "better"],
      ["d", "only_before"],
      ["e", "only_after"],
      ["c", "same"],
    ]
  );
  assert.deepEqual(cases[0], { caseId: "a", before: { passed: 2, total: 2 }, after: { passed: 1, total: 2 }, change: "worse" });
});

test("a chat case fails on any change not asked for, and on an empty reply", () => {
  const turn = (t: Partial<ChatTurn>): ChatTurn => ({ said: "x", looked: false, changes: [], reply: "Done, it comes at 8 now.", ...t });
  const failed = (checks: ReturnType<typeof chatChecks>) => checks.filter((c) => !c.pass).map((c) => c.name);

  assert.deepEqual(failed(chatChecks("at-eight", [turn({ changes: [{ time: { mode: "chosen", at: "08:00", days: "all" } }] })])), []);
  assert.deepEqual(
    failed(chatChecks("at-eight", [turn({ changes: [{ time: { mode: "chosen", at: "08:00", days: "all" } }, { reflectReminders: false }] })])),
    ["Changed only what was asked"]
  );
  assert.deepEqual(failed(chatChecks("too-early", [turn({ reply: "" })])), ["Replied in words", "Asked"]);
  assert.deepEqual(failed(chatChecks("next-one", [turn({ looked: true, reply: "Thursday at 6:40." })])), []);

  // Turning everything off: nothing on the first turn, both off on the yes, and where to turn them back on.
  const allOff = [turn({ reply: "Turn off the heads-up and reminders?" }), turn({ changes: [{ headsUp: false, reflectReminders: false }], reply: "Both are off. You can turn them on in You, then Lumen, then Notifications." })];
  assert.deepEqual(failed(chatChecks("all-off-confirmed", allOff)), []);
  assert.deepEqual(failed(chatChecks("all-off-confirmed", [allOff[1], allOff[0]])), ["Changed only what was asked", "Asked", "Said where to turn them back on"]);

  // A hard moment: one pause of about a week, nothing else.
  assert.deepEqual(failed(chatChecks("stop-hard-moment", [turn({ changes: [{ pausedUntil: "2026-12-02" }] })])), []);
  assert.deepEqual(failed(chatChecks("stop-hard-moment", [turn({ changes: [{ pausedUntil: "2026-12-20" }] })])), ["Paused about a week, and nothing else"]);
  assert.deepEqual(failed(chatChecks("stop-hard-moment", [turn({ changes: [{ pausedUntil: "2026-12-02" }, { headsUp: false }] })])), ["Paused about a week, and nothing else"]);
});

test("the chat suite shows what was looked at and changed, and costs something for every case", () => {
  const text = describeChat([{ said: "Nothing this week.", looked: true, changes: [{ pausedUntil: "2026-11-30" }], reply: "Paused until Monday." }]);
  assert.equal(
    text,
    'Daniel: Nothing this week.\n  (Lumen looked at the notification settings; the phone answered)\n  (Lumen changed: {"pausedUntil":"2026-11-30"})\nLumen: Paused until Monday.'
  );
  for (const c of chatNotificationsSuite.cases) assert.ok(chatNotificationsSuite.promptChars(c.id) > 0, c.id);
  assert.equal(chatNotificationsSuite.cases.length, 11);
  assert.match(chatNotificationsSuite.version, /^gpt-5\.5, input [0-9a-f]{8}, rubric [0-9a-f]{8}$/);
});
