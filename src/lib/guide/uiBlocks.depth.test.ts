// Runs without a database or network: the Phase 6 cards are built from arguments alone.
import assert from "node:assert/strict";
import { test } from "node:test";

import { GUIDE_BLOCK_KINDS, HEARTBEAT_ONLY_BLOCK_KINDS, buildUiBlocksSystemPrompt, parseClientBlockKinds, resolveShowBlockCall, type GuideBlockKind } from "./uiBlocks";
import type { GoalShape } from "@/lib/goals/goalTypes";

const kinds: GuideBlockKind[] = ["recap_card", "milestone_card", "note_recall"];

const resolve = (args: object, extra: { goalIds?: string[]; goalShapes?: Record<string, GoalShape>; noteExcerpts?: string[] } = {}) =>
  resolveShowBlockCall({ argumentsJson: JSON.stringify(args), allowedKinds: kinds, userId: "user-1", blockId: "block-1", ...extra });

const wire = (block: unknown) => JSON.parse(JSON.stringify(block));

test("the Phase 6 kinds are known, are heartbeat-only, and the chat prompt tells the model never to use them", () => {
  for (const kind of kinds) assert.ok(GUIDE_BLOCK_KINDS.includes(kind), kind);
  assert.deepEqual(parseClientBlockKinds(["recap_card", "milestone_card", "note_recall", "nope"]), kinds);
  assert.deepEqual([...HEARTBEAT_ONLY_BLOCK_KINDS].sort(), [...kinds].sort());
  const prompt = buildUiBlocksSystemPrompt(kinds);
  for (const kind of kinds) assert.match(prompt, new RegExp(`- ${kind}: only the heartbeat posts this`));
});

test("recap_card carries the goal, the period and one line of the Guide's own, and no facts", async () => {
  const result = await resolve({ kind: "recap_card", goalId: "g1", note: " A steady week, with one hard day. " }, { goalIds: ["g1"] });
  assert.ok(result.ok);
  assert.deepEqual(wire(result.block), {
    id: "block-1",
    kind: "recap_card",
    v: 1,
    hydrate: true,
    goalId: "g1",
    period: "week",
    note: "A steady week, with one hard day.",
    fallback_text: "A look back at the week. A steady week, with one hard day.",
  });
  const month = await resolve({ kind: "recap_card", goalId: "g1", period: "month" });
  assert.ok(month.ok && month.block.kind === "recap_card" && month.block.period === "month");
  assert.equal((await resolve({ kind: "recap_card", goalId: "g1", period: "year" })).ok, false);
  assert.equal((await resolve({ kind: "recap_card", goalId: "g1", note: "x".repeat(201) })).ok, false);
  assert.deepEqual(await resolve({ kind: "recap_card", goalId: "ghost" }, { goalIds: ["g1"] }), { ok: false, reason: "goalId is not one of the user's goals" });
});

test("milestone_card names a completion and is never shown for a Grow goal, nor when the shape is not known", async () => {
  const ok = await resolve({ kind: "milestone_card", goalId: "g1", completionId: "c-gen" }, { goalShapes: { g1: "finish" } });
  assert.ok(ok.ok);
  assert.deepEqual(wire(ok.block), {
    id: "block-1",
    kind: "milestone_card",
    v: 1,
    hydrate: true,
    goalId: "g1",
    completionId: "c-gen",
    fallback_text: "Something on this goal is finished.",
  });
  for (const shape of ["finish", "practice", "learn"] as const) {
    assert.ok((await resolve({ kind: "milestone_card", goalId: "g1", completionId: "c" }, { goalShapes: { g1: shape } })).ok, shape);
  }
  assert.deepEqual(await resolve({ kind: "milestone_card", goalId: "g1", completionId: "c" }, { goalShapes: { g1: "grow" } }), {
    ok: false,
    reason: "milestone_card is never shown for a Grow goal",
  });
  // Fail closed: with no shape given there is no way to know it is not a Grow goal.
  assert.deepEqual(await resolve({ kind: "milestone_card", goalId: "g1", completionId: "c" }), { ok: false, reason: "the goal's shape is not known" });
  assert.equal((await resolve({ kind: "milestone_card", goalId: "g1" }, { goalShapes: { g1: "finish" } })).ok, false);
});

test("note_recall may quote only an excerpt that is in the brief", async () => {
  const excerpt = "Grace holds me when I do not.";
  const ok = await resolve({ kind: "note_recall", goalId: "g1", excerpt: ` ${excerpt} ` }, { noteExcerpts: [excerpt, "Another."] });
  assert.ok(ok.ok);
  assert.deepEqual(wire(ok.block), {
    id: "block-1",
    kind: "note_recall",
    v: 1,
    hydrate: true,
    goalId: "g1",
    excerpt,
    fallback_text: `You wrote: "${excerpt}"`,
  });
  const reason = "the excerpt is not in the brief";
  assert.deepEqual(await resolve({ kind: "note_recall", goalId: "g1", excerpt: "Something the model made up." }, { noteExcerpts: [excerpt] }), { ok: false, reason });
  // With no brief at all (a chat turn) there is nothing it may quote.
  assert.deepEqual(await resolve({ kind: "note_recall", goalId: "g1", excerpt }), { ok: false, reason });
  assert.equal((await resolve({ kind: "note_recall", goalId: "g1", excerpt: "x".repeat(241) }, { noteExcerpts: ["x".repeat(241)] })).ok, false);
});
