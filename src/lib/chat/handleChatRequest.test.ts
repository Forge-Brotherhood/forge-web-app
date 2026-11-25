// Runs without a database: the chat path must not need one, and would throw here if it tried.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

import { z } from "zod";
import { chatRequestFields, handleChatRequest, type HandleChatInput } from "./handleChatRequest";
import { TOOL_ENABLED_GUIDE_SYSTEM_PROMPT } from "./toolEnabledSystemPrompt";

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
  assert.ok(!toolNames.some((name) => name.startsWith("get_") || name.startsWith("search_verse")));
  assert.deepEqual(bodies[0].input.at(-1), { role: "user", content: "Begin." });
});

// MARK: - Goals

const goalContext = {
  ...context,
  today: "2026-11-23",
  goals: [
    {
      id: "goal-1",
      title: "Read the Bible in a year",
      why: "I never finished it",
      shape: "finish" as const,
      category: "reading" as const,
      rhythm: "daily" as const,
      path: ["Genesis to Exodus", "Psalms alongside"],
      progressSummary: "Day 12 of 365, on pace",
      workingNotes: "Offered a psalm once",
    },
    {
      id: "goal-2",
      title: "Overcome anger",
      shape: "grow" as const,
      category: "growth" as const,
      path: [],
      progressSummary: "",
    },
  ],
};

const personalPrompt = (body: Body) => body.input.filter((i) => i.role === "system").at(-1)!.content as string;

test("the goals the app lists go to the model compactly, after the fixed prompt, which does not change", async () => {
  const withGoals = mockModel([{ output: [message("Hello")] }]);
  await chat({ message: "Hi", context: goalContext });
  const plain = mockModel([{ output: [message("Hello")] }]);
  await chat({ message: "Hi", context });

  const first = withGoals[0].input.filter((i) => i.role === "system")[0].content;
  assert.equal(first, plain[0].input.filter((i) => i.role === "system")[0].content, "the cached prefix is the same");

  const personal = personalPrompt(withGoals[0]);
  assert.ok(personal.includes("Today: 2026-11-23, a Monday."));
  assert.ok(personal.includes('Goal goal-1 (finish, reading, daily): "Read the Bible in a year".'));
  assert.ok(personal.includes("Path: Genesis to Exodus; Psalms alongside."));
  assert.ok(personal.includes("Progress: Day 12 of 365, on pace"));
  assert.ok(personal.includes("Your working notes: Offered a psalm once"));
  assert.ok(personal.includes('Goal goal-2 (grow, growth): "Overcome anger".'));
  assert.ok(!personalPrompt(plain[0]).includes("<goals>"), "an app that sends no goals gets none");
  assert.ok(withGoals[0].tools.map((t) => t.name).includes("set_goal"));
});

test("a goal says whether it has a reading schedule, and the prompt tells Lumen what to do about one that has none", async () => {
  const scheduled = { ...goalContext.goals[0], reading: { books: ["EXO"], endDate: "2027-01-31" } };
  const bodies = mockModel([{ output: [message("Hello")] }, { output: [message("Hello")] }]);
  await chat({ message: "Hi", context: { ...goalContext, goals: [goalContext.goals[0], goalContext.goals[1]] } });
  await chat({ message: "Hi", context: { ...goalContext, goals: [scheduled] } });

  const without = personalPrompt(bodies[0]);
  assert.ok(without.includes("Reading schedule: none yet."), "a reading goal with no schedule says so");
  assert.equal(without.split("Reading schedule").length, 2, "a goal outside reading says nothing");
  assert.ok(personalPrompt(bodies[1]).includes("Reading schedule: Exodus, to finish by 2027-01-31."));
  assert.ok(!personalPrompt(bodies[1]).includes("none yet"));

  const thread = mockModel([{ output: [message("Go on.")] }]);
  await chat({ message: "Hi", context: goalContext, goalThread: { goalId: "goal-1" } });
  assert.ok(personalPrompt(thread[0]).includes("you may offer once, in plain words"));
  assert.ok(personalPrompt(thread[0]).includes("Never say you are updating the goal."));
});

test("a stored reading schedule can never make a request fail", () => {
  const schema = z.object(chatRequestFields);
  const goal = goalContext.goals[0];
  const parse = (reading: unknown) => {
    const result = schema.safeParse({ message: "hi", context: { goals: [{ ...goal, reading }] } });
    assert.ok(result.success, "accepted");
    return result.data.context?.goals?.[0].reading;
  };

  assert.deepEqual(parse({ books: ["exo", "GEN", "exo"], endDate: "2027-01-31" }), { books: ["EXO", "GEN"], endDate: "2027-01-31" });
  assert.deepEqual(parse({ books: ["EXO"] }), { books: ["EXO"] });
  assert.deepEqual(parse({ books: ["EXO", "NOPE", 7], endDate: "soon" }), { books: ["EXO"] }, "bad ids and dates are dropped");
  assert.equal(parse({ books: ["NOPE"] }), undefined, "no valid books means no schedule");
  assert.equal(parse(null), undefined);
  assert.equal(parse(undefined), undefined);
  const all = ["GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL", "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV"];
  const big = parse({ books: [...all, ...all, ...all] }) as { books: string[] };
  assert.ok(big.books.length <= 66);
});

test("a reading schedule's pace is shown to the model, and a bad pace in a stored goal is dropped, not refused", async () => {
  const goal = goalContext.goals[0];
  const bodies = mockModel([{ output: [message("Hello")] }, { output: [message("Hello")] }, { output: [message("Hello")] }]);
  await chat({ message: "Hi", context: { ...goalContext, goals: [{ ...goal, reading: { books: ["EXO"], chaptersPerDay: 2, endDate: "2027-01-31" } }] } });
  await chat({ message: "Hi", context: { ...goalContext, goals: [{ ...goal, reading: { books: ["EXO"], chaptersPerDay: 1 } }] } });
  await chat({ message: "Hi", context: { ...goalContext, goals: [{ ...goal, reading: { books: ["EXO"], endDate: "2027-01-31" } }] } });

  assert.ok(personalPrompt(bodies[0]).includes("Reading schedule: Exodus, 2 chapters a day, finishing by 2027-01-31."));
  assert.ok(personalPrompt(bodies[1]).includes("Reading schedule: Exodus, 1 chapter a day, no end date yet."));
  assert.ok(personalPrompt(bodies[2]).includes("Reading schedule: Exodus, to finish by 2027-01-31."), "no pace, no change");

  const schema = z.object(chatRequestFields);
  const parse = (chaptersPerDay: unknown) => {
    const result = schema.safeParse({ message: "hi", context: { goals: [{ ...goal, reading: { books: ["EXO"], chaptersPerDay } }] } });
    assert.ok(result.success, `accepted ${String(chaptersPerDay)}`);
    return result.data.context?.goals?.[0].reading;
  };
  assert.deepEqual(parse(3), { books: ["EXO"], chaptersPerDay: 3 });
  for (const bad of [0, 21, 1.5, "2", null, {}]) assert.deepEqual(parse(bad), { books: ["EXO"] }, `dropped ${JSON.stringify(bad)}`);
});

test("a pace reaches the app in the reading object of a created or updated goal, and the thread prompt covers pace and retries", async () => {
  const set = call("call_set", "set_goal", {
    title: "Finish Exodus",
    shape: "finish",
    category: "reading",
    reading: { books: ["exo"], chaptersPerDay: 2 },
    status: "active",
    confidence: "explicit",
  });
  const update = call("call_update", "update_goal", { goalId: "goal-1", reading: { books: ["EXO"], chaptersPerDay: 1 } });
  const bodies = mockModel([{ output: [set, update] }]);

  const { events } = await chat({ message: "A chapter a day.", context: { ...goalContext, goals: [goalContext.goals[0]] }, goalThread: { goalId: "goal-1" } });

  assert.deepEqual(events.filter((e) => e.type === "goal").map((e) => e.goal?.reading ?? e.changes?.reading), [
    { books: ["EXO"], chaptersPerDay: 2 },
    { books: ["EXO"], chaptersPerDay: 1 },
  ]);

  const thread = personalPrompt(bodies[0]);
  assert.ok(thread.includes("that is a pace: call update_goal with reading holding what to read and how it is spread"));
  assert.ok(thread.includes("chaptersPerDay, a whole number from 1 to 20, or perPeriod"));
  assert.ok(thread.includes("correct the call and call it again in the same turn"));
  assert.ok(thread.includes('("update my plan")'));
  assert.ok(thread.includes("ask one short plain question"));
  assert.ok(thread.includes("Never tell them you tried, that something failed, or that you can't change it from here"));
  assert.ok(thread.includes('"tap Adjust on the card"'));
});

test("a refused goal call is logged by its reason code only, and an accepted one by its action", async () => {
  const lines: Array<Record<string, any>> = [];
  const capture = (...args: unknown[]) => {
    try {
      lines.push(JSON.parse(String(args[0])));
    } catch {
      // not one of our log lines
    }
  };
  const original = { warn: console.warn, info: console.info };
  console.warn = capture;
  console.info = capture;
  try {
    const refused = call("call_bad", "update_goal", { goalId: "goal-1", reading: { books: ["EXO", "Hobbit"], chaptersPerDay: 2 } });
    const invalid = call("call_invalid", "update_goal", { goalId: "goal-1", reading: { books: ["EXO"], chaptersPerDay: 99 } });
    const ok = call("call_ok", "log_progress", { goalId: "goal-1", kind: "checkin", note: "Prayed", date: "2026-11-23" });
    mockModel([{ output: [refused, invalid, ok] }]);
    await chat({ message: "Update my plan.", context: { ...goalContext, goals: [goalContext.goals[0]] }, conversationId: "conv-1" });
  } finally {
    console.warn = original.warn;
    console.info = original.info;
  }

  const warns = lines.filter((l) => l.event === "goal_tool_refused");
  assert.deepEqual(warns.map((l) => [l.level, l.tool, l.reason, l.conversationId]), [
    ["warn", "update_goal", "unknown_book", "conv-1"],
    ["warn", "update_goal", "invalid_arguments", "conv-1"],
  ]);
  assert.ok(warns.every((l) => typeof l.correlationId === "string"));
  assert.ok(!JSON.stringify(lines).includes("Hobbit"), "nothing the model sent reaches a log");
  assert.ok(!JSON.stringify(lines).includes("chaptersPerDay"), "nor a field name from the arguments");

  const oks = lines.filter((l) => l.event === "goal_tool_ok");
  assert.deepEqual(oks.map((l) => [l.level, l.tool, l.action]), [["info", "log_progress", "log_progress"]]);
  assert.ok(!JSON.stringify(oks).includes("Prayed"));
});

test("an ignored status is logged by tool name only, and the event carries no status", async () => {
  const lines: Array<Record<string, any>> = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    try {
      lines.push(JSON.parse(String(args[0])));
    } catch {
      // not one of our log lines
    }
  };
  let events: Array<Record<string, any>> = [];
  try {
    const both = call("call_both", "update_goal", { goalId: "goal-1", title: "Quiet new name", status: "paused" });
    mockModel([{ output: [both] }]);
    ({ events } = await chat({ message: "Rename it.", context: { ...goalContext, goals: [goalContext.goals[0]] }, conversationId: "conv-2" }));
  } finally {
    console.info = original;
  }

  assert.deepEqual(events.filter((e) => e.type === "goal").map((e) => e.changes), [{ title: "Quiet new name" }]);
  const ignored = lines.filter((l) => l.event === "goal_tool_status_ignored");
  assert.deepEqual(ignored.map((l) => [l.level, l.tool, l.conversationId]), [["info", "update_goal", "conv-2"]]);
  assert.deepEqual(Object.keys(ignored[0]).sort(), ["conversationId", "correlationId", "env", "event", "level", "tool", "tag", "ts"].sort());
  assert.ok(!JSON.stringify(lines).includes("Quiet new name"), "no goal content in a log");
});

test("a goal thread is answered with the goal-thread prompt, the folded summary and the shape's posture", async () => {
  const bodies = mockModel([{ output: [message("Go on.")] }]);

  await chat({
    message: "I missed three days.",
    history: [{ role: "user", content: "Recent turn" }],
    context: goalContext,
    goalThread: { goalId: "goal-2", summary: "They lose their temper with their brother." },
  });

  const prompt = personalPrompt(bodies[0]);
  assert.ok(prompt.includes("GOAL THREAD"));
  assert.ok(prompt.includes('The goal is goal-2: "Overcome anger". This is a Grow goal.'));
  assert.ok(prompt.includes("never score it"));
  assert.ok(prompt.includes("step toward a real person"));
  assert.ok(prompt.includes("They lose their temper with their brother."));
  assert.ok(!prompt.includes("This is the start of the thread"));
  assert.ok(prompt.indexOf("<goals>") < prompt.indexOf("GOAL THREAD"), "new text goes after the personal context");
});

test("the goal thread tells Lumen when to rename the goal", async () => {
  const bodies = mockModel([{ output: [message("Go on.")] }]);
  await chat({ message: "Hi", context: goalContext, goalThread: { goalId: "goal-1" } });

  const prompt = personalPrompt(bodies[0]);
  assert.ok(prompt.includes("rename it in the same update_goal call with title"));
  assert.ok(prompt.includes("making the smallest change"));
  assert.ok(prompt.includes("never rename a Grow goal unless the user asks"));
  assert.ok(prompt.includes('("I\'ve renamed it to ...") only when you actually renamed it'));
});

test("a thread's first message opens it, and the marker is never sent to the model as the user's words", async () => {
  const bodies = mockModel([{ output: [message("You said you want to read the Bible in a year.")] }]);

  const { done } = await chat({
    message: "GOAL_THREAD_START",
    context: goalContext,
    goalThread: { goalId: "goal-1" },
  });

  const prompt = personalPrompt(bodies[0]);
  assert.ok(prompt.includes("This is the start of the thread"));
  assert.ok(prompt.includes("This is a Finish goal."));
  assert.ok(!prompt.includes("step toward a real person"), "only grow goals get that");
  assert.deepEqual(bodies[0].input.at(-1), { role: "user", content: "Begin." });
  assert.deepEqual(done.items[0], { role: "user", content: "Begin." });
});

test("a goal setup opens with Lumen's question, drawn on what it knows, and the marker is never sent as the user's words", async () => {
  const bodies = mockModel([{ output: [message("What would you like to work toward?")] }]);

  const { done } = await chat({
    message: "GOAL_SETUP_START",
    context: goalContext,
    uiBlocks: ["quick_replies", "goal_proposal"],
    goalSetup: { noticed: ["Pray with my wife"], recentReading: ["JHN:3", "PSA:23"] },
  });

  const prompt = personalPrompt(bodies[0]);
  assert.ok(prompt.includes("GOAL SETUP"));
  assert.ok(prompt.includes("This is the start."));
  assert.ok(prompt.includes('"Pray with my wife"'));
  assert.ok(prompt.includes("John 3, Psalms 23") || prompt.includes("John 3, Psalm 23"));
  assert.ok(!prompt.includes("GOAL THREAD"));
  assert.ok(!prompt.includes("the most they can have"), "one goal leaves room");
  assert.deepEqual(bodies[0].input.at(-1), { role: "user", content: "Begin." });
  assert.deepEqual(done.items[0], { role: "user", content: "Begin." });
});

test("a goal setup's later turns keep the setup prompt without the opening, and three goals are said plainly", async () => {
  const goal = goalContext.goals[0];
  const bodies = mockModel([{ output: [message("Why does it matter to you?")] }]);

  await chat({
    message: "Read the Bible in a year",
    context: { ...goalContext, goals: [goal, { ...goal, id: "goal-2", title: "B" }, { ...goal, id: "goal-3", title: "C" }] },
    goalSetup: { noticed: [], recentReading: [] },
  });

  const prompt = personalPrompt(bodies[0]);
  assert.ok(prompt.includes("GOAL SETUP"));
  assert.ok(!prompt.includes("This is the start."));
  assert.ok(prompt.includes("the most they can have"));
  assert.deepEqual(bodies[0].input.at(-1), { role: "user", content: "Read the Bible in a year" });
});

test("a thread that opens after its goal was set up lays out the steps without saying the goal back", async () => {
  const bodies = mockModel([{ output: [message("Here is how I'd begin.")] }]);

  await chat({
    message: "GOAL_THREAD_START",
    history: [{ role: "user", content: "Read the Bible in a year" }],
    context: goalContext,
    goalThread: { goalId: "goal-1" },
    // Sent by mistake with a thread: the thread wins.
    goalSetup: { noticed: [], recentReading: [] },
  });

  const prompt = personalPrompt(bodies[0]);
  assert.ok(prompt.includes("The goal was just made in the conversation above"));
  assert.ok(!prompt.includes("say the goal back in their own words"));
  assert.ok(!prompt.includes("GOAL SETUP"));
});

test("goal setup requests are held to their limits", () => {
  const schema = z.object(chatRequestFields);
  assert.ok(schema.safeParse({ message: "GOAL_SETUP_START", goalSetup: {} }).success);
  assert.ok(!schema.safeParse({ message: "hi", goalSetup: { noticed: ["a", "b", "c", "d"] } }).success, "at most 3 noticed");
  assert.ok(!schema.safeParse({ message: "hi", goalSetup: { recentReading: Array(9).fill("JHN:1") } }).success, "at most 8 chapters");
  assert.ok(!schema.safeParse({ message: "hi", goalSetup: { noticed: ["n".repeat(121)] } }).success);
});

test("coming back after the reading begins a reflection, led by what they made but never reciting it", async () => {
  const bodies = mockModel([{ output: [message("Jesus says the good shepherd knows his own.")] }]);

  const { done } = await chat({
    message: "GOAL_THREAD_REFLECT",
    context: goalContext,
    uiBlocks: ["passage_card", "quick_replies"],
    goalThread: {
      goalId: "goal-1",
      reflection: {
        ref: "JHN:10",
        made: { highlights: ["JHN:10:14"], notes: [{ ref: "JHN:10:14", text: "He knows me first." }], questions: ["What does lay down his life mean?"], minutes: 11 },
      },
    },
  });

  const prompt = personalPrompt(bodies[0]);
  assert.ok(prompt.includes("This turn begins a reflection."));
  assert.ok(prompt.includes("the reading for this goal, John 10,"));
  assert.ok(prompt.includes("- Marked: John 10:14"));
  assert.ok(prompt.includes('- Wrote beside John 10:14: "He knows me first."'));
  assert.ok(prompt.includes('- Asked you while reading: "What does lay down his life mean?"'));
  assert.ok(prompt.includes("Do not recite it back"));
  assert.ok(prompt.includes("Ask the hard question when it is the true one"));
  assert.ok(prompt.includes("Never build a sentence on a contrast"));
  assert.ok(!bodies[0].tools.some((t) => t.name === "show_block"), "the start of a reflection shows no card");
  assert.ok(!prompt.includes("This is the start of the thread"));
  assert.deepEqual(bodies[0].input.at(-1), { role: "user", content: "Begin." });
  assert.deepEqual(done.items[0], { role: "user", content: "Begin." });

  // Nothing made: it still begins, from the passage and the goal.
  const quiet = mockModel([{ output: [message("Go on.")] }]);
  await chat({ message: "GOAL_THREAD_REFLECT", context: goalContext, goalThread: { goalId: "goal-1", reflection: { ref: "JHN:10", made: { highlights: [], notes: [], questions: [] } } } });
  assert.ok(personalPrompt(quiet[0]).includes("They did not mark, note or ask anything while reading this time."));

  // An ordinary turn in the thread is not a reflection.
  const plain = mockModel([{ output: [message("Go on.")] }]);
  await chat({ message: "Hi", context: goalContext, goalThread: { goalId: "goal-1" }, uiBlocks: ["passage_card", "cross_refs"] });
  assert.ok(!personalPrompt(plain[0]).includes("This turn begins a reflection."));
  assert.ok(plain[0].tools.some((t) => t.name === "show_block"), "an ordinary turn still offers cards");
  assert.ok(personalPrompt(plain[0]).includes("Never build a sentence on a contrast"), "every turn in a goal thread holds the plain-voice rule");
});

test("verses in an answer are links in its text: the model is never offered a passage card", async () => {
  const bodies = mockModel([{ output: [message("Read John 8:12.")] }, { output: [message("Go on.")] }]);
  await chat({ message: "What does light mean in John 8?", context, uiBlocks: ["passage_card", "cross_refs"] });
  await chat({ message: "Hi", context, uiBlocks: ["passage_card"] });

  const showBlock = JSON.stringify(bodies[0].tools.find((t) => t.name === "show_block"));
  assert.ok(showBlock.includes("cross_refs"));
  assert.ok(!JSON.stringify(bodies[0].instructions ?? bodies[0]).includes("- passage_card:"), "no passage_card guidance");
  assert.ok(!bodies[1].tools.some((t) => t.name === "show_block"), "offering only a passage card offers nothing");
});

test("a card asked for from Lumen's menu must be shown, when it is one the model may show", async () => {
  const bodies = mockModel([{ output: [message("Here.")] }, { output: [message("Here.")] }, { output: [message("Here.")] }]);
  await chat({ message: "Compare translations of Romans 8:28", context, uiBlocks: ["cross_refs", "compare_translations"], requestedBlock: "compare_translations" });
  await chat({ message: "Show me Psalm 23", context, uiBlocks: ["passage_card", "cross_refs"], requestedBlock: "passage_card" });
  await chat({ message: "Hi", context, uiBlocks: ["cross_refs", "compare_translations"] });

  const rule = "Your reply to it must show one";
  assert.ok(JSON.stringify(bodies[0]).includes(`to see a compare_translations card. ${rule} compare_translations card`));
  assert.ok(!JSON.stringify(bodies[1]).includes(rule), "a card the model is never offered is not asked for");
  assert.ok(!JSON.stringify(bodies[2]).includes(rule), "an ordinary question asks for no card");
  assert.ok(z.object(chatRequestFields).safeParse({ message: "hi", requestedBlock: "word_study" }).success);
});

test("goal-thread requests are accepted by both routes' schema, with the limits the contract sets", () => {
  const schema = z.object(chatRequestFields);
  const goal = goalContext.goals[0];

  assert.ok(schema.safeParse({ message: "hi", context: goalContext, goalThread: { goalId: "goal-1", summary: "s" } }).success);
  assert.ok(schema.safeParse({ message: "hi", context: { goals: [] } }).success);
  assert.ok(!schema.safeParse({ message: "hi", context: { goals: [goal, goal, goal, goal] } }).success, "at most 3 goals");
  assert.ok(!schema.safeParse({ message: "hi", context: { goals: [{ ...goal, path: Array(13).fill("Step") }] } }).success);
  assert.ok(!schema.safeParse({ message: "hi", context: { goals: [{ ...goal, progressSummary: "p".repeat(301) }] } }).success);
  assert.ok(!schema.safeParse({ message: "hi", context: { goals: [{ ...goal, workingNotes: "n".repeat(1001) }] } }).success);
  assert.ok(!schema.safeParse({ message: "hi", context: { goals: [{ ...goal, shape: "sprint" }] } }).success);
  assert.ok(!schema.safeParse({ message: "hi", goalThread: {} }).success);
  const reflection = (made: object) => ({ message: "GOAL_THREAD_REFLECT", goalThread: { goalId: "goal-1", reflection: { ref: "JHN:10", made } } });
  assert.ok(schema.safeParse(reflection({ highlights: [], notes: [], questions: [] })).success);
  assert.ok(!schema.safeParse(reflection({ highlights: Array(9).fill("JHN:10:1"), notes: [], questions: [] })).success, "at most 8 highlights");
  assert.ok(!schema.safeParse(reflection({ highlights: [], notes: [{ ref: "JHN:10:1", text: "n".repeat(241) }], questions: [] })).success);
  assert.ok(!schema.safeParse(reflection({ highlights: [], notes: [], questions: Array(5).fill("q") })).success, "at most 4 questions");
});

test("set_goal reaches the app as a goal event, and the model is told only that it worked", async () => {
  const set = call("call_goal", "set_goal", {
    title: "Pray every morning",
    shape: "practice",
    category: "prayer",
    rhythm: "daily",
    status: "active",
    confidence: "explicit",
  });
  mockModel([{ text: "Good.", output: [message("Good."), set] }]);

  const { events, done } = await chat({ message: "I want to pray every morning.", context: { ...goalContext, goals: [] } });

  assert.deepEqual(events.find((e) => e.type === "goal"), {
    type: "goal",
    action: "create",
    goal: { title: "Pray every morning", shape: "practice", category: "prayer", rhythm: "daily", status: "active" },
  });
  assert.deepEqual(
    done.items.filter((i: any) => i.type === "function_call_output"),
    [{ type: "function_call_output", call_id: "call_goal", output: '{"ok":true}' }]
  );
});

test("a fourth goal is refused with nothing sent to the app, and a goal that is not listed is not touched", async () => {
  const three = [...goalContext.goals, { ...goalContext.goals[0], id: "goal-3", title: "Third" }];
  const set = call("call_set", "set_goal", {
    title: "Memorize Psalm 23",
    shape: "learn",
    category: "reading",
    status: "active",
    confidence: "explicit",
  });
  const update = call("call_update", "update_goal", { goalId: "ghost", status: "paused" });
  const log = call("call_log", "log_progress", { goalId: "goal-1", kind: "reading", ref: "NUM:14", date: "2026-11-23" });
  mockModel([{ output: [set, update, log] }]);

  const { events, done } = await chat({ message: "Do these.", context: { ...goalContext, goals: three } });

  assert.deepEqual(
    done.items.filter((i: any) => i.type === "function_call_output").map((i: any) => [i.call_id, i.output]),
    [
      ["call_set", '{"ok":false,"reason":"goal_limit_reached"}'],
      ["call_update", '{"ok":false,"reason":"unknown_goal"}'],
      ["call_log", '{"ok":true}'],
    ]
  );
  assert.deepEqual(
    events.filter((e) => e.type === "goal").map((e) => [e.action, e.goalId]),
    [["log_progress", "goal-1"]]
  );
});

test("schedule_activity reaches the app as an activity event, and the model is told only that it worked", async () => {
  const schedule = call("call_sched", "schedule_activity", { goalId: "goal-2", type: "check_in", date: "2026-11-24", note: "Ask how the talk with his brother went" });
  const bodies = mockModel([{ text: "I will check in tomorrow.", output: [message("I will check in tomorrow."), schedule] }, { output: [] }]);

  const { events, done } = await chat({
    message: "Can you check on me tomorrow?",
    context: goalContext,
    goalThread: { goalId: "goal-2" },
  });

  assert.ok(bodies[0].tools.map((t) => t.name).includes("schedule_activity"));
  const event = events.find((e) => e.type === "activity")!;
  assert.equal(event.action, "schedule");
  assert.equal(event.activity.id, "goal-2:check_in:2026-11-24");
  assert.equal(event.activity.status, "planned");
  assert.deepEqual(
    done.items.filter((i: any) => i.type === "function_call_output"),
    [{ type: "function_call_output", call_id: "call_sched", output: '{"ok":true}' }]
  );
  const prompt = personalPrompt(bodies[0]);
  assert.ok(prompt.includes("only in a turn where you also call schedule_activity"));
});

test("cards only the heartbeat posts are never offered to the chat model, even when the app lists them", async () => {
  const bodies = mockModel([{ text: "Here is where you are.", output: [message("Here is where you are.")] }]);
  await chat({
    message: "How am I doing?",
    context: goalContext,
    goalThread: { goalId: "goal-1" },
    uiBlocks: ["goal_progress", "recap_card", "milestone_card", "note_recall"],
  });
  const showBlock = bodies[0].tools.find((t) => t.name === "show_block") as any;
  assert.deepEqual(showBlock.parameters.properties.kind.enum, ["goal_progress"]);
});

test("goal cards are streamed to be filled by the app, and only for a goal in the request", async () => {
  const card = call("call_card", "show_block", { kind: "goal_progress", goalId: "goal-1" });
  const ghost = call("call_ghost", "show_block", { kind: "goal_path", goalId: "ghost" });
  mockModel([{ text: "Here is where you are.", output: [message("Here is where you are."), card, ghost] }, { output: [] }]);

  const { events, done } = await chat({
    message: "How am I doing?",
    context: goalContext,
    goalThread: { goalId: "goal-1" },
    uiBlocks: ["goal_progress", "goal_path", "goal_proposal"],
  });

  const blocks = events.filter((e) => e.type === "block").map((e) => e.block);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "goal_progress");
  assert.equal(blocks[0].goalId, "goal-1");
  assert.equal(blocks[0].hydrate, true);
  assert.match(blocks[0].fallback_text, /^Where this goal stands/);
  const outputs = done.items.filter((i: any) => i.type === "function_call_output").map((i: any) => i.output);
  assert.equal(outputs[1], "Rejected: goalId is not one of the user's goals");
});

const GOAL_TOOLS = ["set_goal", "update_goal", "log_progress"];
const GOAL_RULE =
  "- You can start a goal from any conversation when they ask for one or state one plainly; an implied goal is only offered, as above. The app then shows the new goal as a card they can open, so after you create one say one plain sentence about it and do not describe the card, the schedule or the tools.";

const bibleChat = async (input: Partial<HandleChatInput>) => {
  const response = await handleChatRequest({
    request: new NextRequest("http://localhost/api/bible-chat?stream=1", { method: "POST" }),
    userId: "user-1",
    surface: "bible",
    input: { history: [], verseReference: "John 15", ...input },
    force: { entrypoint: "bible_reader", mode: "bible" },
  });
  await response.text();
};

test("the goal rule text is in the fixed prompt", () => {
  assert.ok(TOOL_ENABLED_GUIDE_SYSTEM_PROMPT.includes(GOAL_RULE));
});

test("every Guide entrypoint offers set_goal, update_goal and log_progress, the reader greeting included", async () => {
  const entrypoints: Record<string, () => Promise<unknown>> = {
    "general chat": () => chat({ message: "Hi", context: goalContext }),
    "home": () => chat({ message: "Hi", context: goalContext, entrypoint: "home" }),
    "community": () => chat({ message: "Hi", context: goalContext, entrypoint: "community" }),
    "goal thread": () => chat({ message: "GOAL_THREAD_START", context: goalContext, goalThread: { goalId: "goal-1" } }),
    "reader, verse selected": () =>
      bibleChat({ message: "What does this mean?", verseText: "Abide in me.", selectionState: "selected", context: goalContext }),
    "reader greeting, verses visible": () =>
      bibleChat({ message: "BIBLE_CHAT_START", selectionState: "visible", context: goalContext }),
    "reader greeting, verse selected": () =>
      bibleChat({ message: "BIBLE_CHAT_START", selectionState: "selected", context: goalContext }),
  };

  for (const [name, run] of Object.entries(entrypoints)) {
    const bodies = mockModel([{ output: [message("Hello")] }]);
    await run();

    const names = bodies[0].tools.map((t) => t.name);
    for (const tool of GOAL_TOOLS) assert.ok(names.includes(tool), `${name} offers ${tool}`);

    // Every entrypoint sends the same fixed prompt, which carries the goal rules.
    const fixed = bodies[0].input.filter((i) => i.role === "system")[0].content;
    assert.equal(fixed, TOOL_ENABLED_GUIDE_SYSTEM_PROMPT, `${name} sends the fixed prompt`);
    assert.ok(fixed.includes(GOAL_RULE), `${name} carries the goal rule`);
  }
});

test("a plan of passages or of whole books by the week is shown to the model, and a bad passage is dropped", async () => {
  const goal = goalContext.goals[0];
  const bodies = mockModel([{ output: [message("Hello")] }, { output: [message("Hello")] }]);
  const prayers = { passages: ["MAT:6:9-13", "JHN:17"], perPeriod: 1 };
  const letters = { books: ["PHP", "COL"], unit: "book", period: "week", perPeriod: 1, order: "any" };
  await chat({ message: "Hi", context: { ...goalContext, goals: [{ ...goal, reading: prayers }] } });
  await chat({ message: "Hi", context: { ...goalContext, goals: [{ ...goal, reading: letters }] } });

  assert.ok(personalPrompt(bodies[0]).includes("Reading schedule: passages MAT:6:9-13, JHN:17, 1 passage a day, no end date yet."));
  assert.ok(personalPrompt(bodies[1]).includes("Reading schedule: Philippians, Colossians, 1 book a week, in any order, no end date yet."));

  const parsed = z.object(chatRequestFields).safeParse({
    message: "hi",
    context: { goals: [{ ...goal, reading: { passages: ["mat:6:9-13", "Matthew 6", 7], period: "month", order: "any" } }] },
  });
  assert.ok(parsed.success);
  assert.deepEqual(parsed.data.context?.goals?.[0].reading, { passages: ["MAT:6:9-13"], order: "any" });
});

test("a change to notifications reaches the app, and reading them is left for the app", async () => {
  const read = call("call_read", "get_notification_settings", {});
  const update = call("call_update", "update_notification_settings", { change: "reflect_reminders_off" });
  const bodies = mockModel([{ output: [read, update] }]);

  const { events, done } = await chat({ message: "Stop reminding me to reflect.", context: goalContext });

  assert.ok(bodies[0].tools.some((t) => t.name === "get_notification_settings"));
  assert.ok(TOOL_ENABLED_GUIDE_SYSTEM_PROMPT.includes("NOTIFICATION RULES"));
  assert.deepEqual(events.find((e) => e.type === "notification_settings"), {
    type: "notification_settings",
    changes: { reflectReminders: false },
  });
  assert.deepEqual(done.pendingToolCalls, [{ callId: "call_read", name: "get_notification_settings", argumentsJson: "{}" }]);
});

test("after three unopened reminders, the goal's thread is told to ask whether they help", async () => {
  const bodies = mockModel([{ output: [message("Hello")] }, { output: [message("Hello")] }]);
  await chat({ message: "Hi", context: goalContext, goalThread: { goalId: "goal-1", remindersUnopened: true } });
  await chat({ message: "Hi", context: goalContext, goalThread: { goalId: "goal-1" } });

  const asks = (body: Body) => body.input.some((i) => i.role === "system" && String(i.content).includes("three reminders to reflect"));
  assert.ok(asks(bodies[0]));
  assert.ok(!asks(bodies[1]));
});
