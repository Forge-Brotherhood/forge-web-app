// Phase 6, the server side. Runs without a database or network: the model is a scripted answer and
// these tests check the code rules around it, one rule at a time, including the hard cases.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createActivityToolRunner, buildActivityTools } from "@/lib/chat/tools/activityTools";
import { passageSource } from "@/lib/guide/uiBlocks";
import { ACTIVITY_REGISTRY, ACTIVITY_TYPES, excerptKey } from "./activityRegistry";
import { FIXTURES, FIXTURE_NOW, at, entry, fixture, goal, makeBrief } from "./fixtures";
import { BEAT_SYSTEM_PROMPT } from "./prompt";
import { decide, memorizeStatus, unansweredCount } from "./rules";
import { runBeat } from "./runBeat";
import { beatOutputSchema, type BeatOutput, type BeatTrigger, type Brief } from "./schemas";
import type { BeatModelInput } from "./model";

type Run = { output: BeatOutput; calls: BeatModelInput[] };

const beat = async (brief: Brief, raw: unknown, trigger: BeatTrigger = "app_open"): Promise<Run> => {
  const calls: BeatModelInput[] = [];
  const output = await runBeat(brief, FIXTURE_NOW, {
    trigger,
    callModel: async (input) => {
      calls.push(input);
      if (raw instanceof Error) throw raw;
      return raw;
    },
  });
  assert.ok(beatOutputSchema.safeParse(output).success, "the output matches its schema");
  return { output, calls };
};

const codes = (run: Run) => run.output.meta.dropped.map((d) => d.code);
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));
const created = (run: Run) => run.output.activities.flatMap((op) => (op.action === "create" ? [op.activity] : []));

const REVIEW_MESSAGE = "It has been a steady week with this. Here is a look back, if you would like it.";
const review = (goalId: string, over: object = {}) => ({ goalId, reason: "review", type: "review", payload: {}, message: REVIEW_MESSAGE, ...over });
const milestone = (over: object = {}) => ({
  goalId: "g-bible",
  reason: "milestone",
  type: "milestone",
  payload: { completionId: "c-gen" },
  message: "Genesis is finished. That is a good thing to have behind you.",
  ...over,
});
const recall = (over: object = {}) => ({
  goalId: "g-paul",
  reason: "rhythm",
  type: "note_recall",
  payload: { excerptIndex: 0 },
  message: "There is something you wrote that might be worth another look.",
  ...over,
});
const people = (over: object = {}) => ({
  goalId: "g-anger",
  reason: "rhythm",
  type: "people",
  payload: { person: "wife" },
  message: "Is there someone you trust, maybe your wife, who could hear what you are working on? Only when you are ready.",
  ...over,
});
const memorize = (over: object = {}) => ({
  goalId: "g-prayer",
  reason: "rhythm",
  type: "memorize",
  payload: { ref: "PSA:23:1-3" },
  message: "Here is a verse to keep close, if you would like to.",
  ...over,
});
const lessonPayload = { title: "Why Paul wrote Galatians", category: "historical", body: "Paul wrote to churches that were being told they needed more than Christ. His tone is firm because the gospel itself was at stake." };
const lesson = (over: object = {}) => ({
  goalId: "g-paul",
  reason: "rhythm",
  type: "lesson",
  payload: lessonPayload,
  message: "Here is a short lesson on why Paul wrote Galatians, for when you have a few minutes.",
  ...over,
});
const step = (over: object = {}) => ({
  goalId: "g-free",
  reason: "rhythm",
  type: "step",
  payload: { ref: "PSA:51" },
  message: "Psalm 51 begins with an honest prayer. Maybe say it out loud tonight.",
  ...over,
});

const inBrief = (name: string, goalFile: object = {}, writtenDaysAgo = 0) => {
  const f = fixture(name).brief;
  return makeBrief(f.goals.map((g) => ({ ...g, ...goalFile })), { person: f.person, pulse: f.pulse, wishes: f.wishes }, writtenDaysAgo);
};

// MARK: - The registry

test("the six new types and the milestone are registry entries, each with who it serves, done-when and guidance", () => {
  for (const type of ["review", "lesson", "memorize", "step", "people", "note_recall", "milestone"] as const) {
    assert.ok(ACTIVITY_TYPES.includes(type), type);
    const def = ACTIVITY_REGISTRY[type];
    assert.ok(def.serves.length && def.guidance.length > 40 && def.doneWhen && def.expiresAfterDays >= 1, type);
    assert.ok(BEAT_SYSTEM_PROMPT.includes(`- ${type} (serves ${def.serves.join(", ")})`), type);
  }
  assert.deepEqual(ACTIVITY_REGISTRY.review.serves, ["finish", "practice", "learn", "grow"]);
  assert.deepEqual(ACTIVITY_REGISTRY.lesson.serves, ["learn"]);
  assert.deepEqual(ACTIVITY_REGISTRY.memorize.serves, ["practice", "grow"]);
  assert.deepEqual(ACTIVITY_REGISTRY.step.serves, ["grow"]);
  assert.deepEqual(ACTIVITY_REGISTRY.people.serves, ["grow"]);
  assert.deepEqual(ACTIVITY_REGISTRY.note_recall.serves, ["learn", "grow"]);
  // Cards: the plan's table. step and people have none.
  const cardKind = (type: (typeof ACTIVITY_TYPES)[number]) => ACTIVITY_REGISTRY[type].card;
  assert.equal(cardKind("step"), undefined);
  assert.equal(cardKind("people"), undefined);
  assert.ok(cardKind("review") && cardKind("lesson") && cardKind("memorize") && cardKind("note_recall") && cardKind("milestone"));
});

test("a milestone is never allowed for a Grow goal, in the registry, in the checks and on the card", () => {
  assert.ok(!ACTIVITY_REGISTRY.milestone.serves.includes("grow"));
  assert.equal(ACTIVITY_REGISTRY.milestone.plannable, false);
});

test("the prompt tells the beat the new reasons and the voice of each new type", () => {
  assert.match(BEAT_SYSTEM_PROMPT, /"review": the goal's state says reviewDue/);
  assert.match(BEAT_SYSTEM_PROMPT, /"milestone": the goal's state lists milestoneIds/);
  assert.match(BEAT_SYSTEM_PROMPT, /invitation, never an assignment/);
  assert.match(BEAT_SYSTEM_PROMPT, /A milestone is a brief, glad word/);
  assert.match(BEAT_SYSTEM_PROMPT, /You never quote it/);
});

// MARK: - review

test("review: a week of history and no review yet is due; it is posted with a recap card and carries no figure", async () => {
  const brief = fixture("review-finish").brief;
  assert.equal(decide(brief, FIXTURE_NOW, "app_open").goals[0].review, "due");
  const run = await beat(brief, { posts: [review("g-bible")] });
  assert.equal(run.calls.length, 1);
  assert.match(run.calls[0].user, /"reviewDue":true/);
  assert.deepEqual(codes(run), []);
  const [post] = run.output.posts;
  assert.equal(post.id, "g-bible:review:2026-11-23");
  assert.equal(post.reason, "review");
  assert.deepEqual(wire(post.card), {
    id: "block-g-bible:review:2026-11-23",
    kind: "recap_card",
    v: 1,
    hydrate: true,
    goalId: "g-bible",
    period: "week",
    fallback_text: "A look back at the week.",
    activityId: "g-bible:review:2026-11-23",
  });
  assert.equal(created(run)[0].type, "review");
  assert.equal(created(run)[0].expiresAt, "2026-11-26T04:59:59.000Z");
});

test("review: it makes the beat ask the model even when nothing else is due, and is silent when it is not due", async () => {
  const brief = fixture("review-finish").brief;
  const planned = { ...brief, goals: [{ ...brief.goals[0], rhythm: "weekly" as const, activities: [...brief.goals[0].activities.filter((a) => a.status !== "planned"), entry("g-bible", "reading", 1, "planned")] }] };
  assert.equal(decide(planned, FIXTURE_NOW, "app_open").needsModel, true);
  const notDue = fixture("nothing-due").brief;
  const run = await beat(notDue, new Error("must not be asked"));
  assert.equal(run.calls.length, 0);
});

test("review during care mode is dropped: the person before the plan", async () => {
  const brief = fixture("review-while-grieving").brief;
  assert.equal(decide(brief, FIXTURE_NOW, "app_open").careMode, true);
  const run = await beat(brief, { posts: [review("g-bible")], plan: [{ action: "create", goalId: "g-bible", type: "review", date: "2026-11-24" }] });
  assert.deepEqual(run.output.posts, []);
  assert.deepEqual(run.output.activities, []);
  assert.deepEqual(codes(run), ["reason_not_allowed", "planning_paused"]);
});

test("a second review in the same week is dropped, and one a week later is allowed", async () => {
  const brief = fixture("review-twice-in-a-week").brief;
  assert.equal(decide(brief, FIXTURE_NOW, "app_open").goals[0].review, "too_soon");
  const run = await beat(brief, { posts: [review("g-bible")], plan: [{ action: "create", goalId: "g-bible", type: "review", date: "2026-11-25" }] });
  assert.deepEqual(run.output.posts, []);
  assert.deepEqual(codes(run), ["review_too_soon", "review_too_soon"]);
  // Planned for the day the week is up: fine.
  const later = await beat(brief, { plan: [{ action: "create", goalId: "g-bible", type: "review", date: "2026-11-27" }] });
  assert.deepEqual(codes(later), []);
  assert.equal(created(later).length, 1);

  const weekOld = inBrief("review-finish", { activities: brief.goals[0].activities.filter((a) => a.type !== "review").concat(entry("g-bible", "review", -7, "done")) });
  assert.equal((await beat(weekOld, { posts: [review("g-bible")] })).output.posts.length, 1);

  // After a review is applied, the next brief says it is too soon, and the model is not even asked.
  const first = await beat(fixture("review-finish").brief, { posts: [review("g-bible")] });
  const next = { ...fixture("review-finish").brief, goals: [{ ...fixture("review-finish").brief.goals[0], activities: [...fixture("review-finish").brief.goals[0].activities, ...created(first)] }] };
  assert.equal(decide(next, FIXTURE_NOW, "app_open").goals[0].review, "too_soon");
});

test("review only when the brief is fresh: not when it is a few days old", async () => {
  const brief = fixture("review-brief-3-days-old").brief;
  const run = await beat(brief, { posts: [review("g-bible")] });
  assert.equal(run.output.meta.staleness, "aging");
  assert.deepEqual(run.output.posts, []);
  assert.deepEqual(codes(run), ["review_not_fresh"]);
  // Nor in a gentle (week-old) brief.
  const gentle = await beat(inBrief("review-finish", {}, 9), { posts: [review("g-bible")] });
  assert.deepEqual(gentle.output.posts, []);
});

test("review needs a week to look back on, and is not offered to a goal that has gone ignored", async () => {
  const young = fixture("finish-due").brief;
  assert.equal(decide(young, FIXTURE_NOW, "app_open").goals[0].review, "not_due");
  assert.deepEqual(codes(await beat(young, { posts: [review("g-bible")] })), ["review_not_due"]);

  // Nothing done or posted for a week: nothing to look back on.
  const idle = inBrief("review-finish", { lastActivityAt: at(-12), activities: [entry("g-bible", "reading", -12, "done")] });
  assert.equal(decide(idle, FIXTURE_NOW, "app_open").goals[0].review, "not_due");

  // Three posts unanswered: a review would be one more nudge.
  const ignored = inBrief("review-finish", {
    lastActivityAt: at(-12),
    thread: { turns: [] },
    activities: [entry("g-bible", "reading", -9, "done"), entry("g-bible", "reading", -3, "expired"), entry("g-bible", "reading", -2, "expired"), entry("g-bible", "reading", -1, "expired")],
  });
  assert.equal(decide(ignored, FIXTURE_NOW, "app_open").goals[0].review, "not_due");
});

test("review on a Grow goal: words only. Figures, counts and scores, in the message or on the card, are dropped", async () => {
  const brief = fixture("review-grow").brief;
  const ok = await beat(brief, { posts: [review("g-anger", { message: "It has been a mixed week. Here is a look back, if you would like it." })] });
  assert.deepEqual(codes(ok), []);
  const card = wire(ok.output.posts[0].card);
  assert.equal(card.kind, "recap_card");
  assert.deepEqual(Object.keys(card).sort(), ["activityId", "fallback_text", "goalId", "hydrate", "id", "kind", "period", "v"]);

  const bad: Array<[object, string]> = [
    [review("g-anger", { message: "You handled it 4 times this week." }), "figures_in_message"],
    [review("g-anger", { message: "Four days this week went well." }), "grow_scoring"],
    [review("g-anger", { message: "A good week by my score." }), "grow_scoring"],
    [review("g-anger", { message: "You are on track this week." }), "grow_scoring"],
    [review("g-anger", { message: "A week of progress. Here is a look back.", payload: { note: "Three days clean" } }), "card_grow_scoring"],
    [review("g-anger", { payload: { note: "5 good days" } }), "card_figures_in_message"],
    [review("g-anger", { payload: { note: "Keep it up" } }), "card_nudge_language"],
    [review("g-anger", { payload: { note: "A hard week — and a real one." } }), "card_dash"],
    [review("g-anger", { message: "Your streak holds." }), "nudge_language"],
  ];
  for (const [post, code] of bad) {
    const run = await beat(brief, { posts: [post] });
    assert.deepEqual(run.output.posts, [], JSON.stringify(post));
    assert.deepEqual(codes(run), [code], JSON.stringify(post));
  }
});

// MARK: - milestone

test("milestone: a device-proven completion is marked with a brief message and a milestone card", async () => {
  const brief = fixture("milestone-finish").brief;
  assert.deepEqual(decide(brief, FIXTURE_NOW, "app_open").goals[0].milestones, ["c-gen"]);
  const run = await beat(brief, { posts: [milestone()] });
  assert.equal(run.calls.length, 1);
  assert.match(run.calls[0].user, /"milestoneIds":\["c-gen"\]/);
  assert.deepEqual(codes(run), []);
  const [post] = run.output.posts;
  assert.equal(post.id, "g-bible:milestone:2026-11-23");
  assert.deepEqual(wire(post.card), {
    id: "block-g-bible:milestone:2026-11-23",
    kind: "milestone_card",
    v: 1,
    hydrate: true,
    goalId: "g-bible",
    completionId: "c-gen",
    fallback_text: "Something on this goal is finished.",
    activityId: "g-bible:milestone:2026-11-23",
  });
  assert.equal(created(run)[0].note, "completion:c-gen");
});

test("milestone on a Grow goal is dropped, whatever the brief says", async () => {
  const brief = fixture("milestone-on-a-grow-goal").brief;
  assert.equal(brief.goals[0].completions?.length, 1);
  assert.deepEqual(decide(brief, FIXTURE_NOW, "app_open").goals[0].milestones, []);
  const run = await beat(brief, { posts: [milestone({ goalId: "g-anger", payload: { completionId: "c-pause" }, message: "That step is finished. I am glad." })] });
  assert.deepEqual(run.output.posts, []);
  assert.deepEqual(codes(run), ["type_not_for_shape"]);
  // And never planned or scheduled.
  const plan = await beat(brief, { plan: [{ action: "create", goalId: "g-anger", type: "milestone", date: "2026-11-24" }] });
  assert.deepEqual(plan.output.activities, []);
});

test("milestone needs real proof: a completion in the brief, recent, on the path, not already marked", async () => {
  const brief = fixture("milestone-finish").brief;
  const cases: Array<[Brief, object, string]> = [
    [brief, milestone({ payload: { completionId: "c-other" } }), "no_completion"],
    [brief, milestone({ reason: "rhythm" }), "reason_type_mismatch"],
    [brief, milestone({ type: "reading", payload: { ref: "NUM:14" }, message: "Today's is Numbers 14." }), "reason_type_mismatch"],
    [inBrief("milestone-finish", { completions: [{ id: "c-gen", kind: "book", label: "Genesis", at: at(-20) }] }), milestone(), "milestone_not_proven"],
    [inBrief("milestone-finish", { completions: [{ id: "c-gen", kind: "book", label: "Genesis", at: at(-1) }], activities: [entry("g-bible", "milestone", -2, "done", { note: "completion:c-gen" })] }), milestone(), "milestone_not_proven"],
    [inBrief("milestone-finish", { completions: [{ id: "c-gen", kind: "path_step", label: "A step that is not on the path", at: at(-1) }] }), milestone(), "completion_not_on_path"],
    [inBrief("milestone-finish", { completions: undefined }), milestone(), "no_completion"],
  ];
  for (const [b, post, code] of cases) {
    const run = await beat(b, { posts: [post] });
    assert.deepEqual(run.output.posts, [], code);
    assert.deepEqual(codes(run), [code], code);
  }
  const onPath = inBrief("milestone-finish", { completions: [{ id: "c-step", kind: "path_step", label: "Read the Pentateuch", at: at(-1) }] });
  assert.equal((await beat(onPath, { posts: [milestone({ payload: { completionId: "c-step" } })] })).output.posts.length, 1);
  // Without a completion there is nothing to decide, so the model is not asked about it.
  const none = await beat(fixture("nothing-due").brief, new Error("must not be asked"));
  assert.equal(none.calls.length, 0);
});

test("milestone is brief and glad: no figures, no streaks, no scoring, and it is never planned", async () => {
  const brief = fixture("milestone-finish").brief;
  for (const message of ["Genesis is finished, all 50 chapters.", "Genesis is done. Keep it up.", "Genesis is finished, a personal best.", "Genesis is finished — well done."]) {
    assert.deepEqual((await beat(brief, { posts: [milestone({ message })] })).output.posts, [], message);
  }
  const plan = await beat(brief, { plan: [{ action: "create", goalId: "g-bible", type: "milestone", date: "2026-11-24" }] });
  assert.deepEqual(codes(plan), ["not_plannable"]);
});

test("a milestone asks nothing of the person, so it never counts as an unanswered post", () => {
  const f = fixture("milestone-finish").brief;
  const goalFile = { ...f.goals[0], lastActivityAt: undefined, thread: { turns: [] }, activities: [entry("g-bible", "milestone", -3, "expired"), entry("g-bible", "milestone", -2, "expired")] };
  assert.equal(unansweredCount(goalFile, FIXTURE_NOW), 0);
  const asked = { ...goalFile, activities: [entry("g-bible", "reading", -3, "expired"), entry("g-bible", "reading", -2, "expired")] };
  assert.equal(unansweredCount(asked, FIXTURE_NOW), 2);
});

// MARK: - note_recall

test("note_recall: only an excerpt that is in the brief, shown on a card unchanged", async () => {
  const brief = fixture("note-recall-learn").brief;
  assert.deepEqual(decide(brief, FIXTURE_NOW, "app_open").goals[0].recallable, [0]);
  const run = await beat(brief, { posts: [recall()] });
  assert.deepEqual(codes(run), []);
  assert.deepEqual(wire(run.output.posts[0].card), {
    id: "block-g-paul:note_recall:2026-11-23",
    kind: "note_recall",
    v: 1,
    hydrate: true,
    goalId: "g-paul",
    excerpt: brief.goals[0].noteExcerpts[0],
    fallback_text: `You wrote: "${brief.goals[0].noteExcerpts[0]}"`,
    activityId: "g-paul:note_recall:2026-11-23",
  });
  assert.equal(created(run)[0].note, `excerpt:${excerptKey(brief.goals[0].noteExcerpts[0])}`);
});

test("note_recall without an excerpt in the brief is dropped, and so is a position that is not there", async () => {
  const none = inBrief("note-recall-learn", { noteExcerpts: [] });
  const run = await beat(none, { posts: [recall()] });
  assert.deepEqual(run.output.posts, []);
  assert.deepEqual(codes(run), ["no_excerpt"]);
  const brief = fixture("note-recall-learn").brief;
  assert.deepEqual(codes(await beat(brief, { posts: [recall({ payload: { excerptIndex: 3 } })] })), ["no_excerpt"]);
  // The model cannot supply words of its own: the payload has no field for them.
  assert.deepEqual(codes(await beat(brief, { posts: [recall({ payload: { excerpt: "Something I made up." } })] })), ["invalid_payload"]);
  // A blank excerpt is no excerpt.
  assert.deepEqual(codes(await beat(inBrief("note-recall-learn", { noteExcerpts: ["   "] }), { posts: [recall()] })), ["no_excerpt"]);
});

test("note_recall is not repeated within 30 days, only for the same words", async () => {
  const brief = fixture("note-recall-learn").brief;
  const [excerpt] = brief.goals[0].noteExcerpts;
  const recalled = (days: number) => [entry("g-paul", "note_recall", days, "done", { note: `excerpt:${excerptKey(excerpt)}` })];
  const within = inBrief("note-recall-learn", { activities: recalled(-29) });
  assert.deepEqual(decide(within, FIXTURE_NOW, "app_open").goals[0].recallable, []);
  assert.deepEqual(codes(await beat(within, { posts: [recall()] })), ["note_recall_repeated"]);
  const past = inBrief("note-recall-learn", { activities: recalled(-30) });
  assert.equal((await beat(past, { posts: [recall()] })).output.posts.length, 1);
  // Other words are free to come back.
  const two = inBrief("note-recall-learn", { noteExcerpts: [excerpt, "A different thing I wrote."], activities: recalled(-5) });
  assert.deepEqual(decide(two, FIXTURE_NOW, "app_open").goals[0].recallable, [1]);
  assert.equal((await beat(two, { posts: [recall({ payload: { excerptIndex: 1 } })] })).output.posts.length, 1);
  // A hard subject in their notes is not opened by a thread that is not on it.
  const heavy = inBrief("note-recall-learn", { noteExcerpts: ["I think about the funeral every night."] });
  assert.deepEqual(codes(await beat(heavy, { posts: [recall()] })), ["card_opens_sensitive_subject"]);
});

// MARK: - people

test("people: a Grow goal gets a step toward a real person, as an invitation, with no card", async () => {
  const brief = fixture("people-grow").brief;
  assert.equal(decide(brief, FIXTURE_NOW, "app_open").goals[0].people, "due");
  const run = await beat(brief, { posts: [people()] });
  assert.deepEqual(codes(run), []);
  const [post] = run.output.posts;
  assert.equal(post.id, "g-anger:people:2026-11-23");
  assert.equal(post.card, undefined);
  assert.equal(created(run)[0].card, undefined);
  assert.equal(created(run)[0].type, "people");
  assert.equal(created(run)[0].expiresAt, "2026-11-26T04:59:59.000Z");
});

test("people: due makes the beat ask the model even when the rhythm says nothing is due", async () => {
  const brief = inBrief("people-grow", {
    rhythm: "weekly",
    activities: [entry("g-anger", "check_in", -10, "done"), entry("g-anger", "check_in", -3, "done"), entry("g-anger", "check_in", 2, "planned")],
  });
  const decision = decide(brief, FIXTURE_NOW, "app_open");
  assert.equal(decision.goals[0].rhythmDue, false);
  assert.equal(decision.goals[0].needsPlan, false);
  assert.equal(decision.needsModel, true);
  const run = await beat(brief, { posts: [people()] });
  assert.match(run.calls[0].user, /"peopleDue":true/);
  assert.equal(run.output.posts.length, 1);
});

test("people is an invitation: no deadline, no 'make sure', no report back, no number, and only a person the thread names", async () => {
  const brief = fixture("people-grow").brief;
  const bad: Array<[object, string]> = [
    [people({ message: "Make sure you tell your wife this week." }), "people_assignment"],
    [people({ message: "Is there someone you could talk to by Friday?" }), "people_assignment"],
    [people({ message: "Tell your wife, then let me know how it went." }), "people_assignment"],
    [people({ message: "You must tell someone about this." }), "nudge_language"],
    [people({ message: "Talk to someone you trust. Five minutes is enough." }), "grow_scoring"],
    [people({ message: "Is there a friend you could tell about this? Pick 1." }), "figures_in_message"],
    [people({ payload: { person: "Pastor Mike" } }), "person_not_in_brief"],
  ];
  for (const [post, code] of bad) {
    const run = await beat(brief, { posts: [post] });
    assert.deepEqual(run.output.posts, [], code);
    assert.deepEqual(codes(run), [code], code);
  }
});

test("people is never the only thing offered, and not more than once a review cycle", async () => {
  const alone = inBrief("people-grow", { activities: [entry("g-anger", "check_in", 1, "planned")] });
  assert.equal(decide(alone, FIXTURE_NOW, "app_open").goals[0].people, "only_offer");
  assert.deepEqual(codes(await beat(alone, { posts: [people()] })), ["people_only_offer"]);

  const recent = inBrief("people-grow", { activities: [entry("g-anger", "check_in", -4, "done"), entry("g-anger", "people", -3, "done")] });
  assert.equal(decide(recent, FIXTURE_NOW, "app_open").goals[0].people, "too_soon");
  assert.deepEqual(codes(await beat(recent, { posts: [people()], plan: [{ action: "create", goalId: "g-anger", type: "people", date: "2026-11-25" }] })), ["people_too_soon", "people_too_soon"]);
  const weekAgo = inBrief("people-grow", { activities: [entry("g-anger", "check_in", -4, "done"), entry("g-anger", "people", -7, "done")] });
  assert.equal((await beat(weekAgo, { posts: [people()] })).output.posts.length, 1);
});

test("people serves Grow goals only", async () => {
  const brief = fixture("finish-due").brief;
  assert.deepEqual(codes(await beat(brief, { posts: [people({ goalId: "g-bible", payload: {} })] })), ["type_not_for_shape"]);
});

// MARK: - memorize

test("memorize: a new verse is posted as a passage card with the verse's own text, filled by the server", async (t) => {
  t.mock.method(passageSource, "readerTranslation", async (userId: string) => (userId === "user-7" ? "KJV" : "BSB"));
  t.mock.method(passageSource, "loadVerses", async () => [{ n: 1, text: "The Lord is my shepherd." }, { n: 2, text: "He makes me lie down." }, { n: 3, text: "He restores my soul." }]);
  const brief = fixture("memorize-practice").brief;
  const calls: BeatModelInput[] = [];
  const output = await runBeat(brief, FIXTURE_NOW, {
    trigger: "app_open",
    callModel: async (i) => (calls.push(i), { posts: [memorize()] }),
    userId: "user-7",
  });
  assert.deepEqual(output.meta.dropped, []);
  const card = wire(output.posts[0].card);
  assert.equal(card.kind, "passage_card");
  assert.equal(card.translation, "KJV");
  assert.equal(card.reference, "Psalms 23:1-3");
  assert.deepEqual(card.verses.map((v: any) => v.n), [1, 2, 3]);
  assert.equal(output.activities[0].action === "create" && output.activities[0].activity.note, "verse:PSA:23:1-3");
});

test("memorize: a verse in review comes back on the spaced schedule, and only that verse", async (t) => {
  t.mock.method(passageSource, "readerTranslation", async () => "BSB");
  t.mock.method(passageSource, "loadVerses", async () => [{ n: 1, text: "The Lord is my shepherd." }]);
  const brief = fixture("memorize-review").brief;
  assert.deepEqual(decide(brief, FIXTURE_NOW, "app_open").goals[0].memorize, { mode: "review", ref: "PSA:23:1-3", offered: ["PSA:23:1-3"] });
  const run = await beat(brief, { posts: [memorize()] });
  assert.deepEqual(codes(run), []);
  assert.match(run.calls[0].user, /"memorize":\{"mode":"review","ref":"PSA:23:1-3"\}/);
  assert.equal(run.output.posts.length, 1);
  // A different verse while one is due for review is dropped.
  assert.deepEqual(codes(await beat(brief, { posts: [memorize({ payload: { ref: "PSA:46:1" } })] })), ["memorize_review_due"]);
});

test("memorize spacing: too soon is dropped, the gaps widen, a carried verse is let rest, and a verse is not offered twice as new", () => {
  const withPosts = (...days: number[]) =>
    goal({ id: "g", title: "x", shape: "practice", category: "prayer", activities: days.map((d) => entry("g", "memorize", d, "done", { note: "verse:PSA:23:1-3" })) });
  const status = (g: ReturnType<typeof withPosts>, day: string) => memorizeStatus(g, "America/New_York", day);
  // After the first showing: wait two days.
  assert.equal(status(withPosts(-1), "2026-11-23").mode, "wait");
  assert.equal(status(withPosts(-2), "2026-11-23").mode, "review");
  // After the second: four days. Third: seven. Fourth: fourteen.
  assert.equal(status(withPosts(-6, -3), "2026-11-23").mode, "wait");
  assert.equal(status(withPosts(-6, -4), "2026-11-23").mode, "review");
  assert.equal(status(withPosts(-14, -10, -6), "2026-11-23").mode, "wait");
  assert.equal(status(withPosts(-14, -10, -7), "2026-11-23").mode, "review");
  assert.equal(status(withPosts(-30, -26, -22, -13), "2026-11-23").mode, "wait");
  assert.equal(status(withPosts(-30, -26, -22, -14), "2026-11-23").mode, "review");
  // After the fifth showing it is carried. A new verse may follow after two days.
  assert.equal(status(withPosts(-60, -58, -54, -47, -33), "2026-11-23").mode, "new");
  assert.equal(status(withPosts(-30, -28, -24, -17, -1), "2026-11-23").mode, "wait");
  // Left unreviewed for a fortnight past due: let go, a new verse is allowed.
  assert.equal(status(withPosts(-30), "2026-11-23").mode, "new");
  assert.equal(status(withPosts(), "2026-11-23").mode, "new");
});

test("memorize: too soon, already offered, too long and not a verse are all dropped", async (t) => {
  t.mock.method(passageSource, "readerTranslation", async () => "BSB");
  t.mock.method(passageSource, "loadVerses", async () => [{ n: 1, text: "The Lord is my shepherd." }]);
  const tooSoon = inBrief("memorize-review", { activities: [entry("g-prayer", "memorize", -1, "done", { note: "verse:PSA:23:1-3" })] });
  assert.deepEqual(codes(await beat(tooSoon, { posts: [memorize()], plan: [{ action: "create", goalId: "g-prayer", type: "memorize", date: "2026-11-23" }] })), ["memorize_too_soon", "memorize_too_soon"]);
  // Planned for the day it is due, it is fine.
  assert.deepEqual(codes(await beat(tooSoon, { plan: [{ action: "create", goalId: "g-prayer", type: "memorize", date: "2026-11-24" }] })), []);

  const carried = inBrief("memorize-review", {
    activities: [-60, -58, -54, -47, -33].map((d) => entry("g-prayer", "memorize", d, "done", { note: "verse:PSA:23:1-3" })),
  });
  assert.deepEqual(codes(await beat(carried, { posts: [memorize()] })), ["memorize_already_offered"]);
  assert.equal((await beat(carried, { posts: [memorize({ payload: { ref: "PSA:46:1" } })] })).output.posts.length, 1);

  const fresh = fixture("memorize-practice").brief;
  const bad: Array<[object, string]> = [
    [memorize({ payload: { ref: "PSA:23" } }), "invalid_ref"],
    [memorize({ payload: { ref: "PSA:23-24" } }), "invalid_ref"],
    [memorize({ payload: { ref: "XYZ:1:1" } }), "invalid_ref"],
    [memorize({ payload: { ref: "PSA:23:1-4" } }), "verse_too_long"],
  ];
  for (const [post, code] of bad) assert.deepEqual(codes(await beat(fresh, { posts: [post] })), [code], code);
  assert.deepEqual(codes(await beat(fixture("finish-due").brief, { posts: [memorize({ goalId: "g-bible" })] })), ["type_not_for_shape"]);
});

// MARK: - lesson

test("lesson: a Learn goal gets a short teaching on a study card, and the card's words are held to the plain wording", async () => {
  const brief = fixture("lesson-learn").brief;
  const run = await beat(brief, { posts: [lesson()] });
  assert.deepEqual(codes(run), []);
  const card = wire(run.output.posts[0].card);
  assert.equal(card.kind, "context_callout");
  assert.equal(card.category, "historical");
  assert.equal(card.title, "Why Paul wrote Galatians");
  assert.equal(run.output.posts[0].activityId, "g-paul:lesson:2026-11-23");

  const bad: Array<[object, string]> = [
    [lesson({ payload: { ...lessonPayload, body: `${lessonPayload.body} It was written — urgently.` } }), "card_dash"],
    [lesson({ payload: { ...lessonPayload, body: `${lessonPayload.body} You should read it again.` } }), "card_nudge_language"],
    [lesson({ payload: { ...lessonPayload, body: "A short body." } }), "invalid_payload"],
    [lesson({ payload: { ...lessonPayload, category: "gossip" } }), "invalid_payload"],
    [lesson({ payload: { ...lessonPayload, body: `${lessonPayload.body} Some of the believers had also faced the funeral of a friend and the grief that followed.` } }), "card_opens_sensitive_subject"],
  ];
  for (const [post, code] of bad) assert.deepEqual(codes(await beat(brief, { posts: [post] })), [code], code);
  assert.deepEqual(codes(await beat(fixture("finish-due").brief, { posts: [lesson({ goalId: "g-bible" })] })), ["type_not_for_shape"]);
});

// MARK: - step

test("step: one practical thing that comes out of a passage in the brief, with no card", async () => {
  const brief = fixture("step-grow").brief;
  const run = await beat(brief, { posts: [step()] });
  assert.deepEqual(codes(run), []);
  assert.equal(run.output.posts[0].card, undefined);
  assert.equal(created(run)[0].card, undefined);
  // The passage's own number is allowed; any other is a figure.
  assert.deepEqual(codes(await beat(brief, { posts: [step({ message: "Psalm 51 begins with an honest prayer. Say it 3 times." })] })), ["figures_in_message"]);
});

test("step: the text it comes from must be in the brief, and it serves Grow goals only", async () => {
  const brief = fixture("step-grow").brief;
  assert.deepEqual(codes(await beat(brief, { posts: [step({ payload: { ref: "ROM:8" } })] })), ["passage_not_in_brief"]);
  assert.deepEqual(codes(await beat(brief, { posts: [step({ payload: { ref: "nonsense" } })] })), ["invalid_ref"]);
  // A passage the thread names counts, and so does a verse inside a chapter that was read.
  assert.equal((await beat(brief, { posts: [step({ payload: { ref: "MAT:5:21-26" }, message: "Matthew 5 has a plain word about this. Maybe reread it tonight." })] })).output.posts.length, 1);
  const named = inBrief("step-grow", { thread: { summary: "Sam read Romans 8 and it helped.", turns: [] } });
  assert.equal((await beat(named, { posts: [step({ payload: { ref: "ROM:8" }, message: "Romans 8 says it better than I can. Maybe read it again tonight." })] })).output.posts.length, 1);
  assert.deepEqual(codes(await beat(fixture("finish-due").brief, { posts: [step({ goalId: "g-bible" })] })), ["type_not_for_shape"]);
});

// MARK: - Grow goals are never scored

test("no wording that scores, ranks or counts gets through on a Grow goal, for any type, and the same words are fine elsewhere", async () => {
  const brief = fixture("grow-checkin").brief;
  const checkIn = (message: string) => ({ goalId: "g-anger", reason: "rhythm", type: "check_in", payload: { options: ["Going well", "It has been hard"] }, message });
  for (const message of ["How is it going? Your score is a good one.", "How is it going? You are ahead of where you were.", "How is it going? A new milestone, maybe.", "How is it going after seven days?"]) {
    const run = await beat(brief, { posts: [checkIn(message)] });
    assert.deepEqual(run.output.posts, [], message);
  }
  const practice = fixture("practice-rhythm").brief;
  const ok = await beat(practice, { posts: [{ goalId: "g-prayer", reason: "rhythm", type: "check_in", payload: { options: ["Going well", "It has been hard"] }, message: "How is it going? Tell me about the morning." }] });
  assert.equal(ok.output.posts.length, 1);
});

// MARK: - schedule_activity

test("a milestone cannot be put on the calendar from a conversation", () => {
  const run = createActivityToolRunner({ goalIds: ["g1"], goals: [{ id: "g1", title: "t", shape: "finish", category: "reading", path: [], progressSummary: "" } as any], today: "2026-11-23" });
  const refused = run({ callId: "c", name: "schedule_activity", argumentsJson: JSON.stringify({ goalId: "g1", type: "milestone", date: "2026-11-24" }) } as any);
  assert.deepEqual(JSON.parse(refused.output), { ok: false, reason: "type_not_schedulable" });
  assert.equal(refused.event, undefined);
  const allowed = run({ callId: "c", name: "schedule_activity", argumentsJson: JSON.stringify({ goalId: "g1", type: "review", date: "2026-11-29" }) } as any);
  assert.equal(JSON.parse(allowed.output).ok, true);
  const tool = buildActivityTools()[0].parameters as any;
  assert.ok(tool.properties.type.enum.includes("review") && tool.properties.type.enum.includes("people"));
  assert.ok(!tool.properties.type.enum.includes("milestone"));
});

// MARK: - The fixtures, end to end

test("every Phase 6 fixture runs, and an empty model posts nothing", async () => {
  const names = ["review-finish", "review-grow", "review-while-grieving", "review-twice-in-a-week", "review-brief-3-days-old", "milestone-finish", "milestone-on-a-grow-goal", "people-grow", "lesson-learn", "note-recall-learn", "memorize-practice", "memorize-review", "step-grow"];
  for (const name of names) assert.ok(FIXTURES.some((f) => f.name === name), name);
  for (const name of names) {
    const run = await beat(fixture(name).brief, {}, fixture(name).trigger);
    assert.deepEqual(run.output.posts, [], name);
  }
});
