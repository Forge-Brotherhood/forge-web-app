// Runs without a database: the chat path must not need one, and would throw here if it tried.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

import { handleChatRequest, type HandleChatInput } from "./handleChatRequest";

process.env.OPENAI_API_KEY = "test-key";

type Body = { input: Array<Record<string, any>>; tools: Array<{ name: string }>; store: unknown; conversation: unknown };

/** Answers each model request with the next scripted output, and records what was sent. */
const mockModel = (rounds: Array<{ text?: string; output: unknown[] }>) => {
  const bodies: Body[] = [];
  let call = 0;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? "{}"));
    const round = rounds[call++] ?? { output: [] };
    const events = [
      ...(round.text ? [{ type: "response.output_text.delta", delta: round.text }] : []),
      { type: "response.completed", response: { id: `resp_${call}`, output: round.output } },
    ];
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { status: 200 });
  }) as typeof fetch;
  return bodies;
};

const chat = async (input: Partial<HandleChatInput>) => {
  const response = await handleChatRequest({
    request: new NextRequest("http://localhost/api/chat?stream=1", { method: "POST" }),
    userId: "user-1",
    surface: "general",
    input: { history: [], ...input },
    force: { mode: "general" },
  });
  const events = (await response.text())
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.replace(/^data: /, "")) as Record<string, any>);
  return { events, done: events.find((e) => e.type === "done")! };
};

const message = (text: string) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
const call = (callId: string, name: string, args: object) => ({
  type: "function_call",
  call_id: callId,
  name,
  arguments: JSON.stringify(args),
});

const context = {
  profile: { name: "Daniel", season: "weary" },
  sessionNotes: [{ text: "Is on night shifts this month" }],
  globalNotes: [{ text: "Leads a small group on Thursdays" }],
};

test("a turn is answered from what the app sends, and the app gets back only the conversation", async () => {
  const bodies = mockModel([{ text: "Abide in him.", output: [message("Abide in him.")] }]);
  const history = [{ role: "user", content: "Earlier question" }, message("Earlier answer")];

  const { events, done } = await chat({ message: "What is abiding?", history, context });

  const sent = bodies[0];
  assert.equal(sent.store, false);
  assert.equal(sent.conversation, undefined);
  const systems = sent.input.filter((i) => i.role === "system");
  assert.equal(sent.input.indexOf(systems.at(-1)!), systems.length - 1, "system messages come first");
  const personal = systems.at(-1)!.content as string;
  for (const fact of ["Daniel", "weary", "night shifts", "Thursdays"]) assert.ok(personal.includes(fact), fact);
  assert.ok(!(systems[0].content as string).includes("Daniel"), "the fixed prompt carries nothing personal");
  assert.deepEqual(sent.input.slice(systems.length), [...history, { role: "user", content: "What is abiding?" }]);

  assert.deepEqual(done.items, [{ role: "user", content: "What is abiding?" }, message("Abide in him.")]);
  assert.equal(done.pendingToolCalls, undefined);
  assert.deepEqual(events.filter((e) => e.type === "delta").map((e) => e.text), ["Abide in him."]);
  assert.ok(events.some((e) => e.type === "actions"));
});

test("memory can be turned off", async () => {
  const bodies = mockModel([{ output: [message("Hello")] }]);

  await chat({ message: "Hello there", context: { ...context, memoryEnabled: false } });

  const personal = bodies[0].input.filter((i) => i.role === "system").at(-1)!.content as string;
  assert.ok(!personal.includes("night shifts") && !personal.includes("Thursdays"));
});

test("a lookup of the user's own data is left for the app, and a saved note is handed to it", async () => {
  const notes = call("call_notes", "get_verse_notes", { bookId: "JHN", chapter: 15 });
  const save = call("call_save", "save_memory_candidate", {
    text: "User wants to pray each morning.",
    category: "goal",
    confidence: "explicit",
    source: "user_message",
  });
  const bodies = mockModel([{ text: "Let me look.", output: [message("Let me look."), notes, save] }]);

  const { events, done } = await chat({ message: "What did I note in John 15? I want to pray each morning." });

  assert.equal(bodies.length, 1, "the model is not asked to continue until the app answers");
  assert.deepEqual(done.pendingToolCalls, [
    { callId: "call_notes", name: "get_verse_notes", argumentsJson: notes.arguments },
  ]);
  assert.deepEqual(
    done.items.filter((i: any) => i.type === "function_call_output"),
    [{ type: "function_call_output", call_id: "call_save", output: '{"saved":true}' }]
  );
  assert.deepEqual(events.find((e) => e.type === "memory_note")?.note, {
    text: "User wants to pray each morning.",
    keywords: [],
  });
  assert.ok(!events.some((e) => e.type === "actions"), "the reply is not finished yet");
});

test("the app's tool outputs continue the reply", async () => {
  const notes = call("call_notes", "get_verse_notes", { bookId: "JHN", chapter: 15 });
  const history = [{ role: "user", content: "What did I note?" }, message("Let me look."), notes];
  const bodies = mockModel([{ text: "You wrote about pruning.", output: [message("You wrote about pruning.")] }]);

  const { events, done } = await chat({ history, toolOutputs: [{ callId: "call_notes", output: '{"notes":[]}' }] });

  const sent = bodies[0].input.filter((i) => i.role !== "system");
  assert.deepEqual(sent, [...history, { type: "function_call_output", call_id: "call_notes", output: '{"notes":[]}' }]);
  assert.equal(done.pendingToolCalls, undefined);
  assert.deepEqual(done.items.at(-1), message("You wrote about pruning."));
  assert.ok(events.some((e) => e.type === "actions"));
});

test("the reader greeting does not look up the user's own data", async () => {
  const bodies = mockModel([{ output: [message("Hi Daniel.")] }]);

  const response = await handleChatRequest({
    request: new NextRequest("http://localhost/api/bible-chat?stream=1", { method: "POST" }),
    userId: "user-1",
    surface: "bible",
    input: { history: [], message: "BIBLE_CHAT_START", verseReference: "John 15", selectionState: "visible", context },
    force: { entrypoint: "bible_reader", mode: "bible" },
  });
  await response.text();

  const toolNames = bodies[0].tools.map((t) => t.name);
  assert.ok(toolNames.includes("search_reading_plans"));
  assert.ok(!toolNames.some((name) => name.startsWith("get_") || name.startsWith("search_verse")));
  assert.deepEqual(bodies[0].input.at(-1), { role: "user", content: "Begin." });
});
