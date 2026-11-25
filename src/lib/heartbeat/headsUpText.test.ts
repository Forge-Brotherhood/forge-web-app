// What the heads-up says (push-engagement-plan.md §5.1, §5.2): no database, AWS or network.
import assert from "node:assert/strict";
import { test } from "node:test";

import { at, fixture, goal, makeBrief } from "./fixtures";
import { aboutProblem, chooseLead, composeHeadsUp, headsUpProblem, timeWordAt, type HeadsUpFact } from "./headsUpText";
import type { Brief } from "./schemas";
import { NEUTRAL_NOTIFICATION_TEXT } from "./terms";

const MORNING = 6 * 60 + 20;
const brief = (): Brief => {
  const b = structuredClone(fixture("finish-due").brief);
  b.pulse.passagesRead.push("JHN:3", "ROM:16");
  return b;
};
const ctx = (sendMinutes = MORNING, refs: string[] = []) => ({ brief: brief(), sendMinutes, refs });
const reading = (extra: Partial<HeadsUpFact> = {}): HeadsUpFact => ({
  goalId: "g-bible",
  activityId: "g-bible:reading:2026-11-23",
  type: "reading",
  ref: "NUM:14",
  timed: false,
  ...extra,
});

test("every heads-up example in the plan passes the real check", () => {
  const examples = [
    "This morning we're reading John 3, where Jesus talks with Nicodemus at night.",
    "This morning's reading is John 3.",
    "I have a short review of John ready for you this morning.",
    "You finished Romans this week. I put together a look back.",
    NEUTRAL_NOTIFICATION_TEXT,
  ];
  for (const text of examples) assert.equal(headsUpProblem(text, ctx()), null, text);
});

test("every template the code writes passes the check, at every time of day", () => {
  const types: HeadsUpFact["type"][] = ["reading", "check_in", "reflection", "prayer", "review", "lesson", "memorize", "step", "people", "note_recall", "milestone"];
  for (const minutes of [MORNING, 13 * 60, 19 * 60 + 30]) {
    for (const type of types) {
      const fact = reading({
        type,
        about: type === "reading" ? "where the spies come back from the land" : undefined,
        completion: type === "milestone" ? { kind: "book", label: "Romans" } : undefined,
      });
      const headsUp = composeHeadsUp({ brief: brief(), facts: [fact], careMode: false, sendMinutes: minutes });
      assert.ok(headsUp, type);
      assert.notEqual(headsUp.text, NEUTRAL_NOTIFICATION_TEXT, `${type} at ${minutes} has its own words`);
      assert.equal(headsUpProblem(headsUp.text, { ...ctx(minutes), refs: ["NUM:14"] }), null, headsUp.text);
    }
  }
  assert.equal(
    composeHeadsUp({ brief: brief(), facts: [reading({ about: "where the spies come back from the land" })], careMode: false, sendMinutes: MORNING })?.text,
    "This morning we're reading Numbers 14, where the spies come back from the land."
  );
  assert.equal(composeHeadsUp({ brief: brief(), facts: [reading()], careMode: false, sendMinutes: 19 * 60 })?.text, "Tonight's reading is Numbers 14.");
});

test("the check refuses a stray number, a discreet title, the wrong time word, an exclamation and a nudge", () => {
  const b = brief();
  b.goals.push(goal({ id: "g-anger", title: "Be slower to anger", shape: "grow", category: "growth" }));
  const c = { brief: b, sendMinutes: MORNING };
  assert.equal(headsUpProblem("This morning's reading is John 3, about 5 minutes long.", c), "number");
  assert.equal(headsUpProblem("This morning's reading is John 4.", c), "number", "a passage the brief does not hold");
  assert.equal(headsUpProblem("This morning's reading is 1 John 2.", { ...c, refs: ["1JN:2"] }), null, "a book's own number is part of the reference");
  assert.equal(headsUpProblem("I have something for Be slower to anger this morning.", c), "discreet_goal");
  assert.equal(headsUpProblem("Tonight's reading is John 3.", c), "time_word");
  assert.equal(headsUpProblem("This evening we're reading John 3.", c), "time_word");
  assert.equal(headsUpProblem("This morning's reading is John 3!", c), "exclamation");
  assert.equal(headsUpProblem("Don't fall behind: John 3 is waiting and you missed yesterday.", c), "nudge");
  assert.equal(headsUpProblem("I noticed you like mornings. John 3 is ready.", c), "observation");
  assert.equal(headsUpProblem("x".repeat(101), c), "too_long");
  assert.equal(timeWordAt(11 * 60 + 59), "morning");
  assert.equal(timeWordAt(12 * 60), "afternoon");
  assert.equal(timeWordAt(17 * 60), "tonight");
});

test("the line about a passage is about the passage: never the person, a concern, a number or the brief's own words", () => {
  const b = brief();
  assert.equal(aboutProblem("where Jesus talks with Nicodemus at night", b), null);
  assert.equal(aboutProblem("which you will find comforting", b), "about_person");
  assert.equal(aboutProblem("a word for Sam today", b), "about_person");
  assert.equal(aboutProblem("written for anyone grieving a death", b), "sensitive");
  assert.equal(aboutProblem("where 12 spies come back", b), "number");
  assert.equal(aboutProblem("on your goal to read the bible in a year", b), "about_person");
  assert.equal(aboutProblem("good for reading on my lunch break", b), "from_brief", "four words from the thread");
  assert.equal(aboutProblem("toward Read the Bible in a year", b), "from_brief", "a goal title");

  // A refused line falls back to the plain template rather than the neutral one.
  const text = composeHeadsUp({ brief: b, facts: [reading({ about: "which you will love" })], careMode: false, sendMinutes: MORNING })?.text;
  assert.equal(text, "This morning's reading is Numbers 14.");
  const long = composeHeadsUp({ brief: b, facts: [reading({ about: "where ".concat("the people grumble and ".repeat(5)) })], careMode: false, sendMinutes: MORNING })?.text;
  assert.equal(long, "This morning's reading is Numbers 14.", "too long with the line");
});

test("the lead: a timed activity first, then the goal last active; never one with notifications off; none in care mode", () => {
  const b = makeBrief([
    goal({ id: "g-a", title: "Read Mark", shape: "finish", category: "reading", lastActivityAt: at(-1) }),
    goal({ id: "g-b", title: "Pray mornings", shape: "practice", category: "prayer", lastActivityAt: at(-3) }),
    goal({ id: "g-c", title: "Learn Romans", shape: "learn", category: "reading", lastActivityAt: at(0), notificationsOn: false }),
  ]);
  const fact = (goalId: string, timed = false): HeadsUpFact => ({ goalId, activityId: `${goalId}:prayer:x`, type: "prayer", timed });

  assert.equal(chooseLead(b, [fact("g-b"), fact("g-a")], false)?.goalId, "g-a", "the most recently active");
  assert.equal(chooseLead(b, [fact("g-a"), fact("g-b", true)], false)?.goalId, "g-b", "a time today wins");
  assert.equal(chooseLead(b, [fact("g-c", true)], false), null, "notifications off");
  assert.equal(chooseLead(b, [fact("g-c", true), fact("g-b")], false)?.goalId, "g-b");
  assert.equal(chooseLead(b, [fact("g-a")], true), null, "care mode sends no heads-up");
});

test("a discreet lead gets the neutral line", () => {
  const b = makeBrief([goal({ id: "g-grow", title: "Be slower to anger", shape: "grow", category: "growth" })]);
  const headsUp = composeHeadsUp({ brief: b, facts: [{ goalId: "g-grow", activityId: "g-grow:step:x", type: "step", timed: false }], careMode: false, sendMinutes: MORNING });
  assert.deepEqual(headsUp, { goalId: "g-grow", activityId: "g-grow:step:x", text: NEUTRAL_NOTIFICATION_TEXT });
});
