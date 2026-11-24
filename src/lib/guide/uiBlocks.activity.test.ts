// Runs without a database or network: activity cards are built from the model's arguments alone.
import assert from "node:assert/strict";
import { test } from "node:test";

import { GUIDE_BLOCK_KINDS, buildShowBlockTool, buildUiBlocksSystemPrompt, parseReadingRef, resolveShowBlockCall, type GuideBlockKind } from "./uiBlocks";

const kinds: GuideBlockKind[] = ["reading_card", "prompt_card"];

const resolve = (args: object, goalIds?: string[]) =>
  resolveShowBlockCall({ argumentsJson: JSON.stringify(args), allowedKinds: kinds, userId: "user-1", blockId: "block-1", goalIds });

const wire = (block: unknown) => JSON.parse(JSON.stringify(block));

test("the activity card kinds are known to the server, the tool and the prompt", () => {
  for (const kind of kinds) assert.ok(GUIDE_BLOCK_KINDS.includes(kind), kind);
  const properties = (buildShowBlockTool(kinds).parameters as any).properties;
  assert.deepEqual(properties.kind.enum, kinds);
  assert.ok(properties.prompt && properties.goalId && properties.ref_key);
  const prompt = buildUiBlocksSystemPrompt(kinds);
  for (const kind of kinds) assert.ok(prompt.includes(`- ${kind}:`), kind);
});

test("reading references are checked and spelled out; the card carries no facts", async () => {
  assert.deepEqual(parseReadingRef(" num:14 "), { refKey: "NUM:14", reference: "Numbers 14" });
  assert.deepEqual(parseReadingRef("NUM:14-16"), { refKey: "NUM:14-16", reference: "Numbers 14 to 16" });
  assert.deepEqual(parseReadingRef("PSA:23:1-6"), { refKey: "PSA:23:1-6", reference: "Psalms 23:1-6" });
  assert.deepEqual(parseReadingRef("PSA:23:4"), { refKey: "PSA:23:4", reference: "Psalms 23:4" });
  for (const bad of ["XYZ:1", "NUM", "NUM:0", "NUM:16-14", "NUM:14-14", "NUM:1-12", "NUM:14:5-2", "NUM:14-16:2"]) {
    assert.equal(parseReadingRef(bad), null, bad);
  }

  const result = await resolve({ kind: "reading_card", goalId: "g1", ref_key: "num:14" }, ["g1"]);
  assert.ok(result.ok);
  assert.deepEqual(wire(result.block), {
    id: "block-1",
    kind: "reading_card",
    v: 1,
    hydrate: true,
    goalId: "g1",
    ref_key: "NUM:14",
    reference: "Numbers 14",
    fallback_text: "Reading: Numbers 14.",
  });
  assert.deepEqual(await resolve({ kind: "reading_card", goalId: "g1", ref_key: "XYZ:1" }), {
    ok: false,
    reason: "ref_key must be BOOK:CHAPTER, BOOK:FIRST-LAST or BOOK:CHAPTER:FIRST-LAST",
  });
});

test("prompt_card carries the question and the goal", async () => {
  const result = await resolve({ kind: "prompt_card", goalId: "g1", prompt: " Where did you see God's patience this week? " });
  assert.ok(result.ok);
  assert.deepEqual(wire(result.block), {
    id: "block-1",
    kind: "prompt_card",
    v: 1,
    hydrate: true,
    goalId: "g1",
    prompt: "Where did you see God's patience this week?",
    fallback_text: "A question to write on: Where did you see God's patience this week?",
  });
  assert.equal((await resolve({ kind: "prompt_card", goalId: "g1", prompt: "short" })).ok, false);
});

test("an activity card must name a goal the app listed", async () => {
  assert.deepEqual(await resolve({ kind: "prompt_card", goalId: "ghost", prompt: "A question long enough." }, ["g1"]), {
    ok: false,
    reason: "goalId is not one of the user's goals",
  });
});
