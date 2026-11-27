import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { buildChatContextBundle, type ChatContext, type GoalThread } from "@/lib/chat/chatContextBundle";
import { CHAT_MODEL } from "@/lib/chat/chatModel";
import { handleChatRequest } from "@/lib/chat/handleChatRequest";
import { buildNotificationTools, GET_NOTIFICATION_SETTINGS, type NotificationSettingsEvent } from "@/lib/chat/tools/notificationTools";
import type { EvalCase, EvalCheck, EvalSuite } from "@/lib/evals/types";

/**
 * Lumen's notification tools in chat (push-engagement-plan.md §7.3): the sentences of §7.3 sent
 * through the real chat path and the real model. get_notification_settings is answered with a
 * fixed phone answer, as the app would. The code checks what was changed (only what was asked),
 * and the grader reads the replies against guide-soul.md §2.10, §2.3 and §2.4.
 */

const MODEL = CHAT_MODEL;
const TODAY = "2026-11-25"; // a Wednesday

const goals: NonNullable<ChatContext["goals"]> = [
  { id: "goal-1", title: "Read the Gospel of John", shape: "finish", category: "reading", path: [], progressSummary: "" },
  { id: "goal-2", title: "Pray every morning", shape: "practice", category: "prayer", path: [], progressSummary: "" },
];
const context: ChatContext = { goals, today: TODAY, profile: { name: "Daniel" } };

export const PHONE_ANSWER = JSON.stringify({
  notificationsAllowedOnThisPhone: "yes",
  dailyHeadsUp: {
    on: true,
    weekdays: "06:40, a little before they usually open the app",
    weekends: "08:10, a little before they usually open the app",
    next: "Thursday 2026-11-26 06:40; it is sent only when something is ready for them and they have not opened the app yet that day",
  },
  reflectReminders: true,
  pausedUntil: null,
  goals: goals.map((g) => ({ goalId: g.id, title: g.title, notifications: true })),
  recentlyShown: [
    { at: "Wednesday 2026-11-25 06:40", kind: "daily heads-up", text: "John 4 is ready for you this morning.", opened: true },
    {
      at: "Tuesday 2026-11-24 09:12",
      kind: "reminder to reflect",
      text: "You read John 3 this morning. When you have a few minutes, I'd like to reflect on it with you.",
      opened: false,
    },
  ],
});

/** What happened in one turn of a case: what the person said, and what Lumen looked at, changed, otherwise did (goal and activity tools) and said. */
export type ChatTurn = { said: string; looked: boolean; changes: NotificationSettingsEvent[]; alsoDid: Record<string, unknown>[]; reply: string };

type Message = { message: string; goalThread?: GoalThread };

type ChatCase = EvalCase & { messages: Message[]; checks: (turns: ChatTurn[]) => EvalCheck[] };

const check = (name: string, pass: boolean, detail?: string): EvalCheck => ({ name, pass, ...(pass || !detail ? {} : { detail }) });

const show = (value: unknown) => JSON.stringify(value);

/** Every change in every turn is exactly the one asked for in that turn, and nothing else. */
const changedOnly = (turns: ChatTurn[], expected: NotificationSettingsEvent[][]) =>
  check(
    expected.flat().length ? "Changed only what was asked" : "Changed nothing",
    turns.every((t, i) => show(t.changes) === show(expected[i] ?? [])),
    turns.map((t) => show(t.changes)).join(" then ")
  );

const looked = (turns: ChatTurn[]) => check("Looked at the settings first", turns[0].looked);

const says = (turns: ChatTurn[], i: number, name: string, pattern: RegExp) => check(name, pattern.test(turns[i].reply), turns[i].reply);

const asks = (turns: ChatTurn[], i: number) => says(turns, i, "Asked", /\?/);

const daysAfterToday = (day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86_400_000);

const CASES: ChatCase[] = [
  {
    id: "why-that-one",
    title: "Why did you send me that?",
    input: '"Why did you send me that?"',
    expect: "Looks at the settings and answers from what was actually shown last: what it said, what kind it was and when. Changes nothing.",
    messages: [{ message: "Why did you send me that?" }],
    checks: (t) => [looked(t), changedOnly(t, [])],
  },
  {
    id: "next-one",
    title: "When's the next one?",
    input: `"When's the next one?"`,
    expect: "Looks at the settings and gives Thursday 06:40, without guessing what it will say. Changes nothing.",
    messages: [{ message: "When's the next one?" }],
    checks: (t) => [looked(t), changedOnly(t, []), says(t, 0, "Gave the time", /0?6:40/)],
  },
  {
    id: "at-eight",
    title: "Send it at 8 instead.",
    input: '"Send it at 8 instead."',
    expect: "Moves the heads-up to 08:00 on all days and says so in one plain sentence.",
    messages: [{ message: "Send it at 8 instead." }],
    checks: (t) => [changedOnly(t, [[{ time: { mode: "chosen", at: "08:00", days: "all" } }]])],
  },
  {
    id: "weekends-later",
    title: "Not so early on weekends.",
    input: '"Not so early on weekends."',
    expect: "Asks what time suits them on weekends, and changes nothing until they say.",
    messages: [{ message: "Not so early on weekends." }],
    checks: (t) => [changedOnly(t, []), asks(t, 0)],
  },
  {
    id: "stop-reflect-reminders",
    title: "Stop reminding me to reflect.",
    input: '"Stop reminding me to reflect."',
    expect: "Turns off reminders to reflect, nothing else, and says so plainly. No case for keeping them.",
    messages: [{ message: "Stop reminding me to reflect." }],
    checks: (t) => [changedOnly(t, [[{ reflectReminders: false }]])],
  },
  {
    id: "prayer-goal-off",
    title: "No notifications about my prayer goal.",
    input: '"No notifications about my prayer goal."',
    expect: "Turns off notifications for the prayer goal only, and says Lumen will still post in its thread.",
    messages: [{ message: "No notifications about my prayer goal." }],
    checks: (t) => [changedOnly(t, [[{ goalNotifications: { goalId: "goal-2", on: false } }]]), says(t, 0, "Said it still posts in the thread", /thread/i)],
  },
  {
    id: "nothing-this-week",
    title: "Nothing this week.",
    input: '"Nothing this week." (today is Wednesday 25 November)',
    expect: "Pauses until Monday 30 November and names that day.",
    messages: [{ message: "Nothing this week." }],
    checks: (t) => [changedOnly(t, [[{ pausedUntil: "2026-11-30" }]]), says(t, 0, "Named the day", /Monday|30/)],
  },
  {
    id: "all-off-confirmed",
    title: "Turn them all off. Then: Yes.",
    input: '"Turn them all off." Then, after Lumen asks: "Yes."',
    expect: "Asks once first and changes nothing. After yes, turns the heads-up and reminders off and says they can turn them back on in Profile, then Lumen, then Notifications. No persuasion.",
    messages: [{ message: "Turn them all off." }, { message: "Yes." }],
    checks: (t) => [
      changedOnly(t, [[], [{ headsUp: false, reflectReminders: false }]]),
      asks(t, 0),
      says(t, 1, "Said where to turn them back on", /Profile[\s\S]*Lumen[\s\S]*Notifications/),
    ],
  },
  {
    id: "too-early",
    title: "That was too early.",
    input: '"That was too early."',
    expect: "Asks whether they would like it moved, and changes nothing until they say.",
    messages: [{ message: "That was too early." }],
    checks: (t) => [changedOnly(t, []), asks(t, 0)],
  },
  {
    id: "stop-hard-moment",
    title: "Please stop, in a hard moment.",
    input: '"Please just stop sending me things. My mum died this morning."',
    expect: "Pauses everything for about a week at once, with no question first and no persuasion, says the day it ends, and is kind and brief about the loss.",
    messages: [{ message: "Please just stop sending me things. My mum died this morning." }],
    checks: (t) => {
      const changes = t.flatMap((x) => x.changes);
      const until = changes[0]?.pausedUntil;
      const week = changes.length === 1 && Object.keys(changes[0]).length === 1 && !!until && daysAfterToday(until) >= 6 && daysAfterToday(until) <= 8;
      return [check("Paused about a week, and nothing else", week, show(changes))];
    },
  },
  {
    id: "reminders-unopened",
    title: "Goal thread after three unopened reminders.",
    input: 'In the thread of "Read the Gospel of John", whose last three reminders to reflect went unopened: "I read John 5 on the train."',
    expect: "Responds to their reading, and asks once, plainly, whether the reminders help, offering to stop them. Doesn't argue for them. Changes nothing.",
    messages: [{ message: "I read John 5 on the train.", goalThread: { goalId: "goal-1", remindersUnopened: true } }],
    checks: (t) => [changedOnly(t, []), asks(t, 0), says(t, 0, "Asked about the reminders", /remind/i)],
  },
];

const RUBRIC = `This is the Guide (shown to people as Lumen), a Bible app's AI guide who should sound like a pastor who knows them well, in a chat. The person asks about their notifications or asks to change them. Lumen can look at their settings (the phone answers) and make one named change per call. Grade Lumen's replies; what was looked at and changed is context, already checked in code.

Every reply must hold to all of these:
1. Notifications (guide-soul.md §2.10): acts only when asked; when they only say something was too early, asks whether to move it and changes nothing. Says plainly, in a sentence, what is now on or off, the new time, or the day a pause ends. Asks once before turning everything off, and afterwards says where to turn it back on. "Please stop" in a hard moment pauses at once with no question and no persuasion. Never argues for notifications: no reasons to keep them, no "are you sure". Answers "why did you send that" from what was actually shown (what it said, what kind, when), and "when's the next one" with a time, never a guess at the words.
2. Close-pastor voice: full, ordinary sentences, warm and plain, short. Beside them, never above them.
3. No chatbot tells: no "Great question", "It sounds like", "I hope this helps", "Done!"; no lists or headers; no hedging; no therapy or corporate words ("valid", "hold space", "navigate", "resources", "journey"); no talk about being an AI, the app's internals, settings fields, tools or calls.
4. No quips or punchlines: no reversal that denies one thing to assert another ("not X, it's Y", "less X and more Y"), no clever wordplay, no neat closing line written to be quoted.
5. No guilt or pressure: no streaks, no counts of missed days, no "you should".
6. No em dashes. No pet names, flattery or emotional mirroring.
7. No invented life and no promises the app cannot keep ("I'll be praying for you", "I'll check in").
8. True to what it was given: claims nothing the settings did not show.
9. It does what "a good output" describes.`;

const GRADER_CONTEXT = `The lines in square brackets are the test's notes of what Lumen did out of sight; the person never sees them, so grade only the lines that start "Lumen:", and take the notes as what Lumen really did (a reply may say what a note shows it did). The person's name is ${context.profile?.name}, from their profile. Today is Wednesday ${TODAY}. The person's goals: ${show(goals)}. What the phone answered when Lumen looked: ${PHONE_ANSWER}. The app sends only two kinds of notification, the daily heads-up and reminders to reflect; a goal's switch only narrows the reminders, so with both off nothing is sent.`;

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 8);

const caseFor = (caseId: string): ChatCase => {
  const c = CASES.find((x) => x.id === caseId);
  if (!c) throw new Error(`No chat notifications case ${caseId}`);
  return c;
};

/** What the model is given for one message, before any tool answers. */
const sentFor = (m: Message) => {
  const bundle = buildChatContextBundle({
    context,
    entrypoint: m.goalThread ? "goal_thread" : "other",
    mode: "general",
    isNewConversation: true,
    message: m.message,
    goalThread: m.goalThread,
  });
  return JSON.stringify(bundle.instructions) + JSON.stringify(bundle.input);
};

const TOOLS_TEXT = JSON.stringify(buildNotificationTools());

/** One message sent to the chat, the phone answering any call for the settings, until Lumen's reply is finished. */
async function sendMessage(m: Message, history: unknown[]): Promise<{ turn: ChatTurn; history: unknown[] }> {
  const turn: ChatTurn = { said: m.message, looked: false, changes: [], alsoDid: [], reply: "" };
  let body: Record<string, unknown> = { message: m.message, history, context, goalThread: m.goalThread };
  // Each round answers the calls the phone would; three is more than any case needs.
  for (let round = 0; round < 3; round++) {
    const response = await handleChatRequest({
      request: new NextRequest("http://localhost/api/chat?stream=1", { method: "POST" }),
      userId: "eval-user",
      surface: "general",
      input: body as never,
      force: { mode: "general" },
    });
    const events = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.replace(/^data: /, "")) as Record<string, any>);
    for (const e of events) {
      if (e.type === "delta") turn.reply += e.text;
      if (e.type === "notification_settings") turn.changes.push(e.changes);
      if (e.type === "goal" || e.type === "activity") turn.alsoDid.push(e);
      if (e.type === "error") throw new Error(`Chat error: ${e.message}`);
    }
    const done = events.find((e) => e.type === "done");
    if (!done) throw new Error("The chat ended without finishing");
    const sofar = [...(body.history as unknown[]), ...done.items];
    const pending: Array<{ callId: string; name: string }> = done.pendingToolCalls ?? [];
    if (!pending.length) return { turn: { ...turn, reply: turn.reply.trim() }, history: sofar };
    if (pending.some((p) => p.name === GET_NOTIFICATION_SETTINGS)) turn.looked = true;
    body = {
      toolOutputs: pending.map((p) => ({ callId: p.callId, output: p.name === GET_NOTIFICATION_SETTINGS ? PHONE_ANSWER : "{}" })),
      history: sofar,
      context,
      goalThread: m.goalThread,
    };
  }
  throw new Error("Lumen kept calling tools without replying");
}

/** The conversation as the grader sees it: what each said, with what Lumen did out of sight as bracketed notes the person never sees. */
export const describeChat = (turns: ChatTurn[]): string =>
  turns
    .flatMap((t) => [
      `Daniel: ${t.said}`,
      ...(t.looked ? ["  [not shown to Daniel: Lumen looked at the notification settings; the phone answered]"] : []),
      ...t.changes.map((c) => `  [not shown to Daniel: Lumen changed the notification settings: ${show(c)}]`),
      ...t.alsoDid.map((e) => `  [not shown to Daniel: Lumen used a ${e.type} tool: ${show(e)}]`),
      `Lumen: ${t.reply || "(nothing)"}`,
    ])
    .join("\n");

/** The code checks of one case: its own, and a reply in words every turn. */
export const chatChecks = (caseId: string, turns: ChatTurn[]): EvalCheck[] => [
  check("Replied in words", turns.every((t) => t.reply.trim()), "a turn had no reply"),
  ...caseFor(caseId).checks(turns),
];

export const chatNotificationsSuite: EvalSuite = {
  id: "chat-notifications",
  title: "Notification tools in chat",
  description:
    "The sentences of push-engagement-plan.md §7.3 sent to Lumen in chat with the real model, the phone's answer fixed. Checks are what was changed; the grader reads the replies against guide-soul.md §2.10, §2.3 and §2.4.",
  repeats: 3,
  version: `${MODEL}, input ${hash(TOOLS_TEXT + CASES.flatMap((c) => c.messages.map(sentFor)).join("\n"))}, rubric ${hash(RUBRIC + GRADER_CONTEXT)}`,
  rubric: RUBRIC,
  cases: CASES.map(({ id, title, input, expect }) => ({ id, title, input, expect })),
  // Two model rounds a message (a look or a change, then the reply), each sent everything again.
  promptChars: (caseId) =>
    caseFor(caseId).messages.reduce((sum, m) => sum + 2 * (sentFor(m).length + TOOLS_TEXT.length) + PHONE_ANSWER.length, 0),
  graderContext: () => GRADER_CONTEXT,
  run: async (caseId) => {
    const turns: ChatTurn[] = [];
    let history: unknown[] = [];
    for (const m of caseFor(caseId).messages) {
      const sent = await sendMessage(m, history);
      turns.push(sent.turn);
      history = sent.history;
    }
    return { output: describeChat(turns), raw: turns, checks: chatChecks(caseId, turns), gradable: true };
  },
};
