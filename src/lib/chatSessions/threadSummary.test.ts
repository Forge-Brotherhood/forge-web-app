// Runs without a database or network: the request is checked, and the model is stubbed.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { MAX_THREAD_SUMMARY_CHARS, clampSummary, generateThreadSummary, threadSummaryRequestSchema } from "./threadSummary";

process.env.OPENAI_API_KEY = "test-key";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

test("the request takes up to 60 turns and an optional earlier summary", () => {
  const turn = { role: "user", content: "I read Mark 3 today." };
  assert.ok(threadSummaryRequestSchema.safeParse({ turns: [turn] }).success);
  assert.ok(threadSummaryRequestSchema.safeParse({ previousSummary: "So far...", turns: Array(60).fill(turn) }).success);
  assert.ok(!threadSummaryRequestSchema.safeParse({ turns: [] }).success);
  assert.ok(!threadSummaryRequestSchema.safeParse({ turns: Array(61).fill(turn) }).success);
  assert.ok(!threadSummaryRequestSchema.safeParse({ turns: [{ role: "system", content: "x" }] }).success);
  assert.ok(!threadSummaryRequestSchema.safeParse({}).success);
});

test("a long summary is cut to the cap at a word boundary", () => {
  assert.equal(clampSummary("  short  "), "short");
  const clamped = clampSummary("word ".repeat(1000));
  assert.ok(clamped.length <= MAX_THREAD_SUMMARY_CHARS);
  assert.ok(clamped.endsWith("word…"));
});

test("the earlier summary and the new turns go to the model, and one summary comes back", async () => {
  let sent: { messages: Array<{ content: string }>; store: unknown } | undefined;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    sent = JSON.parse(init?.body ?? "{}");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "x".repeat(2000) }) } }] }), {
      status: 200,
    });
  }) as typeof fetch;

  const summary = await generateThreadSummary({
    previousSummary: "They want to read the Bible in a year.",
    turns: [
      { role: "user", content: "I fell behind this week." },
      { role: "assistant", content: "That happens to most people." },
    ],
  });

  assert.equal(summary.length, MAX_THREAD_SUMMARY_CHARS);
  assert.equal(sent?.store, false);
  const prompt = sent!.messages[1].content;
  assert.ok(prompt.includes("They want to read the Bible in a year."));
  assert.ok(prompt.includes("USER: I fell behind this week.") && prompt.includes("ASSISTANT: That happens"));
});

test("a model failure is an error, and its message carries no conversation", async () => {
  globalThis.fetch = (async () => new Response("echo: I fell behind this week.", { status: 500 })) as typeof fetch;
  await assert.rejects(
    generateThreadSummary({ turns: [{ role: "user", content: "I fell behind this week." }] }),
    (err: Error) => err.message === "OpenAI API error: 500"
  );

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 })) as typeof fetch;
  await assert.rejects(generateThreadSummary({ turns: [{ role: "user", content: "hello there" }] }));
});
