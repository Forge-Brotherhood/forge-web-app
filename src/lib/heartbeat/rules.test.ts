// Runs without a database or network: the rules are arithmetic on a brief and a clock.
import assert from "node:assert/strict";
import { test } from "node:test";

import { FIXTURES, FIXTURE_NOW, TIME_ZONE, TODAY, at, entry, fixture, goal, makeBrief } from "./fixtures";
import {
  activityId,
  decide,
  effectiveStatus,
  isCareMode,
  isQuietMinute,
  localParts,
  stalenessOf,
  unansweredCount,
  zonedInstant,
} from "./rules";
import { blockedWeekdays, sensitiveFamilies } from "./terms";

test("local time is the user's, including across a daylight saving change", () => {
  assert.deepEqual(localParts(FIXTURE_NOW, TIME_ZONE), { date: TODAY, minutes: 600, weekday: 1 });
  assert.equal(zonedInstant(TODAY, "07:00", TIME_ZONE).toISOString(), "2026-11-23T12:00:00.000Z");
  // New York springs forward on 2027-03-14: 07:00 is UTC-4 afterwards and UTC-5 before.
  assert.equal(zonedInstant("2027-03-13", "07:00", TIME_ZONE).toISOString(), "2027-03-13T12:00:00.000Z");
  assert.equal(zonedInstant("2027-03-15", "07:00", TIME_ZONE).toISOString(), "2027-03-15T11:00:00.000Z");
  // Just before midnight UTC is still the same day in Los Angeles.
  assert.equal(localParts(new Date("2026-11-23T23:30:00Z"), "America/Los_Angeles").date, TODAY);
});

test("quiet hours can cross midnight", () => {
  const quiet = { start: "21:30", end: "07:00" };
  assert.equal(isQuietMinute(22 * 60, quiet), true);
  assert.equal(isQuietMinute(3 * 60, quiet), true);
  assert.equal(isQuietMinute(7 * 60, quiet), false);
  assert.equal(isQuietMinute(21 * 60 + 29, quiet), false);
  assert.equal(isQuietMinute(10 * 60, { start: "09:00", end: "11:00" }), true);
  assert.equal(isQuietMinute(10 * 60, { start: "09:00", end: "09:00" }), false);
});

test("the staleness tiers follow the plan", () => {
  const brief = fixture("finish-due").brief;
  const age = (days: number) => stalenessOf(brief, new Date(FIXTURE_NOW.getTime() + (days - 1 / 24) * 86_400_000)).tier;
  // The fixture's brief was written an hour before FIXTURE_NOW.
  assert.equal(age(1.9), "fresh");
  assert.equal(age(2), "aging");
  assert.equal(age(6.9), "aging");
  assert.equal(age(7), "gentle");
  assert.equal(age(13.9), "gentle");
  assert.equal(age(14), "lapsed");
  // The oldest section decides.
  const mixed = { ...brief, freshness: { ...brief.freshness, pulse: new Date(FIXTURE_NOW.getTime() - 8 * 86_400_000).toISOString() } };
  assert.equal(stalenessOf(mixed, FIXTURE_NOW).tier, "gentle");
});

test("an activity is one goal, one type and one day", () => {
  assert.equal(activityId("g1", "reading", "2026-11-23"), "g1:reading:2026-11-23");
  assert.equal(activityId("g1", "reading", "2026-11-23"), activityId("g1", "reading", "2026-11-23"));
  assert.notEqual(activityId("g1", "reading", "2026-11-23"), activityId("g1", "prayer", "2026-11-23"));
});

test("an activity past its expiry is expired whatever the app last said", () => {
  const planned = entry("g1", "reading", -2, "planned");
  assert.equal(effectiveStatus(planned, FIXTURE_NOW), "expired");
  assert.equal(effectiveStatus(entry("g1", "reading", 0, "planned"), FIXTURE_NOW), "planned");
  assert.equal(effectiveStatus(entry("g1", "reading", -5, "done"), FIXTURE_NOW), "done");
});

test("unanswered posts are the expired ones since the person last did anything", () => {
  const g = fixture("ignored-two-weeks").brief.goals[0];
  assert.equal(unansweredCount(g, FIXTURE_NOW), 5);
  // Anything the person did on the goal since a post answers it, and everything before it.
  assert.equal(unansweredCount({ ...g, lastActivityAt: at(-14) }, FIXTURE_NOW), 3);
  // So does a reply in the thread.
  const replied = { ...g, thread: { ...g.thread, turns: [{ role: "user" as const, content: "Sorry, busy.", at: at(-10, "12:00") }] } };
  assert.equal(unansweredCount(replied, FIXTURE_NOW), 1);
  // A post that has not expired yet is not unanswered yet.
  assert.equal(unansweredCount({ ...g, activities: [entry("g", "prayer", 0, "posted")] }, FIXTURE_NOW), 0);
});

test("a hard season is read from the person's own words, not from Scripture talk", () => {
  const base = fixture("finish-due").brief;
  assert.equal(isCareMode(base), false);
  assert.equal(isCareMode(fixture("grieving").brief), true);
  assert.equal(isCareMode({ ...base, person: { ...base.person, season: "grieving" } }), true);
  assert.equal(isCareMode({ ...base, person: { ...base.person, season: "anxious" } }), false);
  assert.equal(isCareMode({ ...base, person: { ...base.person, carrying: "My mom was just diagnosed with cancer" } }), true);
  const scripture = { ...base, pulse: { ...base.pulse, conversations: [{ at: at(-1), summary: "Talked about the death and resurrection of Christ.", concerns: [] }] } };
  assert.equal(isCareMode(scripture), false);
});

test("sensitive subjects and weekday wishes are recognised", () => {
  assert.deepEqual([...sensitiveFamilies("My father died last month")], ["death"]);
  assert.deepEqual([...sensitiveFamilies("She struggles with anxiety and porn")].sort(), ["mentalHealth", "sexuality"]);
  assert.equal(sensitiveFamilies("Today's is Numbers 14.").size, 0);
  // Panic in a passage is narration, not the person's health.
  assert.equal(sensitiveFamilies("Read for the difference between Caleb's trust and the crowd's panic.").size, 0);
  assert.deepEqual([...sensitiveFamilies("I had a panic attack at work")], ["mentalHealth"]);
  assert.deepEqual([...blockedWeekdays(["Not on Sundays please", "never on tuesday"])].sort(), [0, 2]);
  assert.equal(blockedWeekdays(["no sunscreen"]).size, 0);
});

test("rules first: which fixtures need the model at all", () => {
  const needs = Object.fromEntries(FIXTURES.map((f) => [f.name, decide(f.brief, FIXTURE_NOW, f.trigger).needsModel]));
  assert.deepEqual(needs, {
    "finish-due": true,
    "reading-lead-in": true,
    "practice-rhythm": true,
    "learn-rhythm": true,
    "grow-checkin": true,
    grieving: true,
    "ignored-two-weeks": true,
    "finish-20-days-behind": true,
    "grow-after-failure": true,
    "stale-3-days": true,
    "stale-9-days": true,
    "stale-16-days": false,
    "nothing-due": false,
    "review-finish": true,
    "review-grow": true,
    "review-while-grieving": true,
    "review-twice-in-a-week": true,
    "review-brief-3-days-old": true,
    "milestone-finish": true,
    "milestone-on-a-grow-goal": true,
    "people-grow": true,
    "lesson-learn": true,
    "note-recall-learn": true,
    "memorize-practice": true,
    "memorize-review": true,
    "step-grow": true,
  });
  assert.equal(decide(fixture("grieving").brief, FIXTURE_NOW, "app_open").mode, "care");
  assert.equal(decide(fixture("stale-9-days").brief, FIXTURE_NOW, "app_open").mode, "gentle");
  assert.equal(decide(fixture("stale-16-days").brief, FIXTURE_NOW, "app_open").mode, "none");
});

test("a back-off lengthens the gap, and enough unanswered posts silence the goal", () => {
  const g = fixture("ignored-two-weeks").brief.goals[0];
  const state = (goalFile: typeof g) => decide(makeBrief([goalFile]), FIXTURE_NOW, "app_open").goals[0];
  assert.equal(state(g).gapDays, 7);
  assert.equal(state(g).quiet, false);
  const sixth = { ...g, activities: [entry(g.id, "prayer", -19, "expired"), ...g.activities] };
  assert.equal(state(sixth).quiet, true);
  assert.equal(decide(makeBrief([sixth]), FIXTURE_NOW, "app_open").needsModel, false);
  const lightGoal = goal({ id: "g", title: "t", shape: "practice", category: "prayer", rhythm: "daily", activities: [entry("g", "prayer", -3, "done")] });
  assert.equal(state(lightGoal).gapDays, 1);
});
