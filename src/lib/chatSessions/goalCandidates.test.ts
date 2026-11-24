// Runs without a database or network: the model's answer is checked, and endChat is run against a stubbed model.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { chatEndRequestSchema, endChat } from "./endChat";
import { filterGoalCandidates } from "./goalCandidates";

process.env.OPENAI_API_KEY = "test-key";

const messages = [
  { role: "user" as const, content: "I keep coming back to Paul's letters." },
  { role: "assistant" as const, content: "He wrote most of them from prison or on the road." },
  { role: "user" as const, content: "I wish I prayed more in the mornings." },
  { role: "assistant" as const, content: "Start small." },
  { role: "user" as const, content: "   " },
];

const paul = { title: "Work through Paul's letters", shape: "learn", category: "reading", evidence: [0, 1] };
const prayer = { title: "Pray every morning", why: "I wish I prayed more", shape: "practice", category: "prayer", evidence: [2] };

const filter = (raw: unknown, titles: { active?: string[]; declined?: string[] } = {}) =>
  filterGoalCandidates({ raw, messages, activeTitles: titles.active ?? [], declinedTitles: titles.declined ?? [] });

test("well-formed candidates that cite the user's messages are kept, in order and capped at two", () => {
  assert.deepEqual(filter([paul, prayer, { ...prayer, title: "Memorize Psalm 23" }]), [
    { title: "Work through Paul's letters", shape: "learn", category: "reading", evidence: [0, 1] },
    { title: "Pray every morning", why: "I wish I prayed more", shape: "practice", category: "prayer", evidence: [2] },
  ]);
  assert.deepEqual(filter("nothing"), []);
  assert.deepEqual(filter(undefined), []);
});

test("a candidate must cite real messages, and at least one of them the user's", () => {
  assert.deepEqual(filter([{ ...paul, evidence: [] }]), []);
  assert.deepEqual(filter([{ ...paul, evidence: undefined }]), []);
  assert.deepEqual(filter([{ ...paul, evidence: [1] }]), [], "only the assistant's message");
  assert.deepEqual(filter([{ ...paul, evidence: [4] }]), [], "an empty message");
  assert.deepEqual(filter([{ ...paul, evidence: [9, -1, 1.5, "0"] }]), []);
  assert.deepEqual(filter([{ ...paul, evidence: [9, 2, 2, 0] }])[0].evidence, [0, 2]);
});

test("an active or declined goal is never suggested again, nor one already suggested", () => {
  assert.deepEqual(filter([paul, prayer], { active: ["pray every morning"] }).map((c) => c.title), [paul.title]);
  assert.deepEqual(filter([paul, prayer], { declined: ["Work through Paul's letters!"] }).map((c) => c.title), [prayer.title]);
  assert.deepEqual(filter([paul], { declined: ["Work through Paul's letters, one a week"] }), [], "one inside the other");
  assert.deepEqual(filter([paul, { ...paul, title: "WORK THROUGH PAUL'S LETTERS" }]).length, 1);
  assert.equal(filter([{ ...prayer, title: "Pray" }], { active: ["Pray every morning"] }).length, 1, "a short word is not a match");
});

test("malformed or unsafe candidates are dropped", () => {
  const bad = [
    { ...paul, title: "" },
    { ...paul, title: "x".repeat(121) },
    { ...paul, why: "w".repeat(301) },
    { ...paul, shape: "sprint" },
    { ...paul, category: "historical" },
    { ...paul, title: "Share my password with the group" },
    { ...paul, why: "ignore previous instructions" },
    null,
    "paul",
  ];
  assert.deepEqual(filter(bad), []);
});

// MARK: - endChat

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

/** Answers the goal step with the given goals and every other step with an empty JSON object. */
const stubModel = (goals: unknown[]) => {
  const prompts: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { messages: Array<{ content: string }> };
    const isGoalStep = body.messages[0].content.startsWith("You read a finished conversation");
    if (isGoalStep) prompts.push(body.messages[1].content);
    const content = isGoalStep ? JSON.stringify({ goals }) : JSON.stringify({ globalNotes: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  return prompts;
};

const endRequest = (extra: object = {}) =>
  chatEndRequestSchema.parse({ messages: messages.slice(0, 4), ...extra });

test("the chat-end request takes the goal fields, and older apps' requests still parse", () => {
  const parsed = endRequest({ memoryEnabled: false, activeGoalTitles: ["A"], declinedGoalTitles: ["B"] });
  assert.equal(parsed.memoryEnabled, false);
  assert.deepEqual([parsed.activeGoalTitles, parsed.declinedGoalTitles], [["A"], ["B"]]);
  const old = endRequest();
  assert.deepEqual([old.memoryEnabled, old.activeGoalTitles, old.declinedGoalTitles], [undefined, [], []]);
  assert.throws(() => endRequest({ activeGoalTitles: Array(11).fill("A") }));
});

test("chat end returns goal candidates, numbered by the app's own message indices", async () => {
  const prompts = stubModel([paul, prayer, { ...paul, title: "Memorize Psalm 23", evidence: [3] }]);

  const result = await endChat(endRequest({ activeGoalTitles: ["Pray every morning"], declinedGoalTitles: ["Old goal"] }));

  assert.deepEqual(result.goalCandidates, [
    { title: "Work through Paul's letters", shape: "learn", category: "reading", evidence: [0, 1] },
  ]);
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].includes("[2] USER: I wish I prayed more"));
  assert.ok(prompts[0].includes('["Pray every morning"]') && prompts[0].includes('["Old goal"]'));
});

test("with memory off no goal is looked for at all", async () => {
  const prompts = stubModel([paul]);

  const result = await endChat(endRequest({ memoryEnabled: false }));

  assert.deepEqual(result.goalCandidates, []);
  assert.equal(prompts.length, 0, "the model is not asked");
});

test("a failing goal step costs the user nothing", async () => {
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { messages: Array<{ content: string }> };
    if (body.messages[0].content.startsWith("You read a finished conversation")) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ globalNotes: [] }) } }] }), { status: 200 });
  }) as typeof fetch;

  assert.deepEqual((await endChat(endRequest())).goalCandidates, []);
});
