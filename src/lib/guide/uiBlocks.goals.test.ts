// Runs without a database or network: goal cards are built from the model's arguments alone.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GUIDE_BLOCK_KINDS,
  buildShowBlockTool,
  buildUiBlocksSystemPrompt,
  parseClientBlockKinds,
  pendingBlockLabel,
  resolveShowBlockCall,
  type GuideBlockKind,
} from "./uiBlocks";

const kinds: GuideBlockKind[] = ["goal_proposal", "goal_path", "goal_progress"];

const resolve = (args: object, extra: { allowedKinds?: GuideBlockKind[]; goalIds?: string[] } = {}) =>
  resolveShowBlockCall({
    argumentsJson: JSON.stringify(args),
    allowedKinds: extra.allowedKinds ?? kinds,
    userId: "user-1",
    blockId: "block-1",
    goalIds: extra.goalIds,
  });

/** What the app receives: undefined fields are not sent. */
const wire = (block: unknown) => JSON.parse(JSON.stringify(block));

test("the goal kinds are known to the server, the tool and the prompt", () => {
  for (const kind of kinds) assert.ok(GUIDE_BLOCK_KINDS.includes(kind), kind);
  assert.deepEqual(parseClientBlockKinds(["goal_path", "goal_future", "passage_card"]), ["passage_card", "goal_path"]);

  const properties = (buildShowBlockTool(kinds).parameters as any).properties;
  assert.deepEqual(properties.kind.enum, kinds);
  for (const key of ["goalId", "steps", "shape", "why", "how"]) assert.ok(properties[key], key);
  assert.ok(properties.category.enum.includes("growth") && properties.category.enum.includes("historical"));

  const prompt = buildUiBlocksSystemPrompt(kinds);
  for (const kind of kinds) assert.ok(prompt.includes(`- ${kind}:`), kind);
});

test("goal_proposal streams the model's words and asks the app to fill the rest", async () => {
  const result = await resolve({
    kind: "goal_proposal",
    title: " Work through Paul's letters ",
    shape: "learn",
    category: "reading",
    how: "We could take them in the order he wrote them.",
  });

  assert.ok(result.ok);
  assert.deepEqual(wire(result.block), {
    id: "block-1",
    kind: "goal_proposal",
    v: 1,
    hydrate: true,
    title: "Work through Paul's letters",
    shape: "learn",
    category: "reading",
    how: "We could take them in the order he wrote them.",
    fallback_text: "Goal suggestion: Work through Paul's letters. We could take them in the order he wrote them.",
  });
});

test("goal_path and goal_progress carry the goal id and no facts", async () => {
  const path = await resolve({ kind: "goal_path", goalId: "g1", steps: ["Read a chapter of Mark", "Tell a friend"] }, { goalIds: ["g1"] });
  assert.ok(path.ok);
  assert.deepEqual(wire(path.block), {
    id: "block-1",
    kind: "goal_path",
    v: 1,
    hydrate: true,
    goalId: "g1",
    steps: ["Read a chapter of Mark", "Tell a friend"],
    fallback_text: "Plan for this goal: Read a chapter of Mark; Tell a friend.",
  });

  const stored = await resolve({ kind: "goal_path", goalId: "g1", steps: null }, { goalIds: ["g1"] });
  assert.ok(stored.ok);
  assert.ok(!("steps" in wire(stored.block)));
  assert.equal(stored.block.fallback_text, "Plan for this goal.");

  const progress = await resolve({ kind: "goal_progress", goalId: "g1", note: "A steady few weeks." }, { goalIds: ["g1"] });
  assert.ok(progress.ok);
  assert.deepEqual(wire(progress.block), {
    id: "block-1",
    kind: "goal_progress",
    v: 1,
    hydrate: true,
    goalId: "g1",
    note: "A steady few weeks.",
    fallback_text: "Where this goal stands. A steady few weeks.",
  });
});

test("a goal card must name a goal the app listed, when the app listed any", async () => {
  const unknown = await resolve({ kind: "goal_progress", goalId: "ghost" }, { goalIds: ["g1"] });
  assert.deepEqual(unknown, { ok: false, reason: "goalId is not one of the user's goals" });
  assert.equal((await resolve({ kind: "goal_path", goalId: "g1" }, { goalIds: [] })).ok, false);
  assert.equal((await resolve({ kind: "goal_path", goalId: "g1" })).ok, true);
});

test("bad goal card arguments are rejected", async () => {
  const cases: Array<[object, RegExp]> = [
    [{ kind: "goal_proposal", shape: "learn", category: "reading" }, /title/],
    [{ kind: "goal_proposal", title: "x".repeat(121), shape: "learn", category: "reading" }, /title/],
    [{ kind: "goal_proposal", title: "Pray", shape: "sprint", category: "reading" }, /shape/],
    [{ kind: "goal_proposal", title: "Pray", shape: "practice", category: "historical" }, /category/],
    [{ kind: "goal_proposal", title: "Pray", shape: "practice", category: "prayer", how: "h".repeat(201) }, /how/],
    [{ kind: "goal_path" }, /goalId/],
    [{ kind: "goal_path", goalId: "g1", steps: Array(13).fill("Step") }, /steps/],
    [{ kind: "goal_path", goalId: "g1", steps: [] }, /steps/],
    [{ kind: "goal_progress", goalId: "g1", note: "n".repeat(201) }, /note/],
  ];
  for (const [args, expected] of cases) {
    const result = await resolve(args);
    assert.ok(!result.ok, JSON.stringify(args));
    assert.match(result.reason, expected);
  }
});

test("a kind the client did not list is refused", async () => {
  const result = await resolve({ kind: "goal_progress", goalId: "g1" }, { allowedKinds: ["goal_path"] });
  assert.deepEqual(result, { ok: false, reason: "kind goal_progress is not available" });
});

test("a goal card is announced by kind while the model is still writing it", () => {
  assert.deepEqual(pendingBlockLabel('{"kind":"goal_progress","goal', kinds), { kind: "goal_progress", reference: null });
  assert.deepEqual(pendingBlockLabel('{"kind": "goal_path", "goalId": "g1"', kinds), { kind: "goal_path", reference: null });
  assert.equal(pendingBlockLabel('{"kind":"goal_path"', ["goal_progress"]), null);
});

test("goal_proposal can carry what a reading goal reads, with book ids checked", async () => {
  const result = await resolve({
    kind: "goal_proposal",
    title: "Read the Bible in a year",
    shape: "finish",
    category: "reading",
    reading: { books: ["gen", "EXO", "GEN"], endDate: "2027-11-23" },
  });
  assert.ok(result.ok);
  assert.deepEqual(wire(result.block).reading, { books: ["GEN", "EXO"], endDate: "2027-11-23" });

  const noDate = await resolve({ kind: "goal_proposal", title: "Read Paul", shape: "learn", category: "reading", reading: { books: ["ROM"], endDate: null } });
  assert.ok(noDate.ok);
  assert.deepEqual(wire(noDate.block).reading, { books: ["ROM"] });

  const without = await resolve({ kind: "goal_proposal", title: "Pray", shape: "practice", category: "prayer" });
  assert.ok(without.ok);
  assert.ok(!("reading" in wire(without.block)));

  const unknownBook = await resolve({ kind: "goal_proposal", title: "Read", shape: "finish", category: "reading", reading: { books: ["XYZ"] } });
  assert.deepEqual(unknownBook, { ok: false, reason: "unknown book XYZ" });
  assert.equal((await resolve({ kind: "goal_proposal", title: "Read", shape: "finish", category: "reading", reading: { books: [] } })).ok, false);
  assert.equal((await resolve({ kind: "goal_proposal", title: "Read", shape: "finish", category: "reading", reading: { books: ["GEN"], endDate: "2027-02-30" } })).ok, false);

  const properties = (buildShowBlockTool(kinds).parameters as any).properties;
  assert.ok(properties.reading);
  assert.match(buildUiBlocksSystemPrompt(kinds), /reading with the book codes/);
});

test("goal_proposal can carry a pace, a whole number of chapters a day from 1 to 20", async () => {
  const proposal = (chaptersPerDay: unknown, extra: object = {}) =>
    resolve({ kind: "goal_proposal", title: "Finish Exodus", shape: "finish", category: "reading", reading: { books: ["exo"], chaptersPerDay, ...extra } });

  const paced = await proposal(2);
  assert.ok(paced.ok);
  assert.deepEqual(wire(paced.block).reading, { books: ["EXO"], chaptersPerDay: 2 });

  const both = await proposal(1, { endDate: "2027-01-31" });
  assert.ok(both.ok);
  assert.deepEqual(wire(both.block).reading, { books: ["EXO"], endDate: "2027-01-31", chaptersPerDay: 1 });

  const none = await proposal(null);
  assert.ok(none.ok);
  assert.deepEqual(wire(none.block).reading, { books: ["EXO"] });

  for (const bad of [0, 21, 1.5, "2"]) assert.equal((await proposal(bad)).ok, false, String(bad));

  const props = (buildShowBlockTool(kinds).parameters as any).properties.reading.properties;
  assert.deepEqual([props.chaptersPerDay.type, props.chaptersPerDay.minimum, props.chaptersPerDay.maximum], ["integer", 1, 20]);
  assert.match(buildUiBlocksSystemPrompt(kinds), /chaptersPerDay if they named a pace/);
});
