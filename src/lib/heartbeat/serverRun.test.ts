// Runs without a database, AWS or network: an in-memory store, a fake KMS and a scripted model.
import assert from "node:assert/strict";
import { test } from "node:test";

import { BRIEF_COLLECTION, OUTBOX_COLLECTION, openJson, sealJson } from "./crypto";
import { FIXTURE_NOW, fixture } from "./fixtures";
import { FakeKms, MemoryStore, seedUser } from "./fixtures/fakes";
import { isHeartbeatEnabled } from "./config";
import { beatRequestSchema, briefSchema, type Brief } from "./schemas";
import { passageSource } from "@/lib/guide/uiBlocks";
import { quietEndsAt, runHeartbeat, type LogEvent, type RunDeps } from "./serverRun";

const NOW = FIXTURE_NOW;
const DAY = 86_400_000;
const brief = (): Brief => structuredClone(fixture("finish-due").brief);

/** What the scripted model says for the finish-due fixture. */
const SCRIPT = {
  posts: [{ goalId: "g-bible", reason: "due", type: "reading", payload: { ref: "NUM:14" }, message: "Today's is Numbers 14." }],
  plan: [{ action: "create", goalId: "g-bible", type: "reading", date: "2026-11-24" }],
  workingNotes: [{ goalId: "g-bible", notes: "Offered Numbers 14. Keep the readings short." }],
};

function setup(overrides: Partial<RunDeps> = {}) {
  const store = new MemoryStore();
  const kms = new FakeKms();
  const logs: LogEvent[] = [];
  const modelCalls: string[] = [];
  const deps: RunDeps = {
    store,
    getKms: () => kms,
    callModel: async ({ user }) => {
      modelCalls.push(user);
      return SCRIPT;
    },
    allowModel: async () => true,
    log: (event) => logs.push(event),
    now: () => NOW,
    enabled: true,
    ...overrides,
  };
  return { store, kms, logs, modelCalls, deps };
}

const sleeping = (b: Brief): Brief => ({ ...b, goals: b.goals.map((g) => ({ ...g, activities: g.activities.filter((a) => a.status !== "planned") })) });

test("a due user gets a run: the post and the plan go to the outbox, the brief is updated, the key is dropped", async () => {
  const { store, kms, deps, modelCalls } = setup();
  const { key, keyId } = await seedUser(store, kms, { userId: "u1", brief: brief(), now: NOW });

  const summary = await runHeartbeat(deps);
  assert.deepEqual(summary.outcomes, { ok: 1 });
  assert.equal(modelCalls.length, 1);
  assert.deepEqual(kms.unwrapCalls, ["u1"]);
  assert.ok(kms.unwrapped.every((k) => k.every((b) => b === 0)), "every unwrapped key was zeroed");

  assert.equal(store.outbox.length, 1);
  assert.equal(store.outbox[0].keyId, keyId);
  const item: any = openJson(key, "u1", OUTBOX_COLLECTION, store.outbox[0].ciphertext);
  assert.equal(item.v, 1);
  assert.equal(item.posts[0].id, "g-bible:reading:2026-11-23");
  assert.equal(item.posts[0].card.kind, "reading_card");
  assert.equal(item.meta, undefined, "meta stays on the server");

  const stored = store.briefs.get("u1")!;
  assert.equal(stored.revision, 2);
  const updated = briefSchema.parse(openJson(key, "u1", BRIEF_COLLECTION, stored.ciphertext));
  const g = updated.goals[0];
  assert.equal(g.activities.find((a) => a.id === "g-bible:reading:2026-11-23")?.status, "posted");
  assert.ok(g.activities.some((a) => a.id === "g-bible:reading:2026-11-24" && a.status === "planned"));
  assert.equal(g.thread.turns[g.thread.turns.length - 1].content, "Today's is Numbers 14.");
  assert.match(g.workingNotes ?? "", /Offered Numbers 14/);
  assert.deepEqual(updated.freshness, brief().freshness, "only a device moves freshness");

  const state = store.states.get("u1")!;
  assert.equal(state.claimedUntil, null);
  assert.ok(state.nextBeatAt.getTime() >= NOW.getTime() + 3_600_000);
  assert.equal(store.runs.length, 1);
  assert.deepEqual({ ...store.runs[0], durationMs: 0 }, {
    userId: "u1", trigger: "heartbeat", outcome: "ok", staleness: "fresh", modelCalled: true, posts: 1, activities: 2, dropped: 0, pushed: 0, durationMs: 0,
  });
});

test("nothing readable reaches a log line, a run row or a stored value", async () => {
  const { store, kms, logs, deps } = setup();
  const b = brief();
  b.goals[0].workingNotes = "SECRETMARK private note";
  const { key } = await seedUser(store, kms, { userId: "u1", brief: b, now: NOW });
  // One user breaks in a way whose error message would quote content.
  const bad = await seedUser(store, kms, { userId: "u2", brief: brief(), now: NOW });
  store.briefs.get("u2")!.ciphertext = sealJson(bad.key, "u2", BRIEF_COLLECTION, "SECRETMARK not an object");

  await runHeartbeat(deps);

  const everything = JSON.stringify({ logs, runs: store.runs });
  for (const secret of ["SECRETMARK", "Numbers", "Sam", "Read the Bible", key.toString("base64"), key.toString("hex"), bad.key.toString("base64")]) {
    assert.ok(!everything.includes(secret), `${secret} must not be logged or recorded`);
  }
  // What is stored is ciphertext: neither the words nor the key are in it.
  for (const stored of [store.briefs.get("u1")!.ciphertext, store.outbox[0].ciphertext, store.grants.get("u1")!.wrappedKey]) {
    const raw = Buffer.from(stored, "base64").toString("latin1");
    assert.ok(!raw.includes("Numbers") && !raw.includes("SECRETMARK") && !raw.includes(key.toString("latin1")));
  }
  for (const event of logs) {
    for (const value of Object.values(event)) assert.ok(typeof value !== "string" || value.length < 80, "log values are ids, codes and names");
  }
});

test("only users who are due are run: disabled, not yet due, expired grant, no brief and quiet hours are not", async () => {
  const { store, kms, deps } = setup();
  for (const id of ["due", "later", "off", "expired", "nobrief", "quiet"]) await seedUser(store, kms, { userId: id, brief: brief(), now: NOW });
  store.states.get("later")!.nextBeatAt = new Date(NOW.getTime() + 3_600_000);
  store.states.get("off")!.enabled = false;
  store.grants.get("expired")!.expiresAt = new Date(NOW.getTime() - 1000);
  store.briefs.delete("nobrief");
  // 10:00 in New York is inside 09:00 to 11:00.
  store.states.get("quiet")!.quietStart = "09:00";
  store.states.get("quiet")!.quietEnd = "11:00";

  const summary = await runHeartbeat(deps);
  assert.deepEqual(kms.unwrapCalls, ["due"]);
  assert.equal(summary.deferred, 1);
  // The quiet user is put back until 15 minutes after quiet hours end (11:15 New York), with the lease released.
  const quiet = store.states.get("quiet")!;
  assert.equal(quiet.nextBeatAt.toISOString(), "2026-11-23T16:15:00.000Z");
  assert.equal(quiet.claimedUntil, null);
  assert.equal(store.states.get("later")!.claimedUntil, null);
});

test("quiet hours: when they end, across midnight", () => {
  const user = { timezone: "America/New_York", quietStart: "21:30", quietEnd: "07:00" };
  assert.equal(quietEndsAt(NOW, user), null);
  assert.equal(quietEndsAt(new Date("2026-11-24T03:00:00Z"), user)?.toISOString(), "2026-11-24T12:00:00.000Z"); // 22:00 local, ends tomorrow 07:00
  assert.equal(quietEndsAt(new Date("2026-11-23T10:00:00Z"), user)?.toISOString(), "2026-11-23T12:00:00.000Z"); // 05:00 local, ends today 07:00
  assert.equal(quietEndsAt(NOW, { ...user, quietStart: "07:00", quietEnd: "07:00" }), null);
});

test("two overlapping runs never process the same user", async () => {
  const { store, kms, deps } = setup();
  for (let i = 0; i < 6; i++) await seedUser(store, kms, { userId: `u${i}`, brief: brief(), now: NOW });

  const [a, b] = await Promise.all([runHeartbeat({ ...deps, concurrency: 2 }), runHeartbeat({ ...deps, concurrency: 2 })]);
  assert.equal(a.processed + b.processed, 6);
  assert.deepEqual([...kms.unwrapCalls].sort(), ["u0", "u1", "u2", "u3", "u4", "u5"]);
  assert.equal(store.outbox.length, 6);
});

test("a user under a live lease is skipped, and one whose lease ran out is picked up", async () => {
  const { store, kms, deps } = setup();
  await seedUser(store, kms, { userId: "held", brief: brief(), now: NOW });
  await seedUser(store, kms, { userId: "stale", brief: brief(), now: NOW });
  store.states.get("held")!.claimedUntil = new Date(NOW.getTime() + 60_000);
  store.states.get("stale")!.claimedUntil = new Date(NOW.getTime() - 60_000);

  await runHeartbeat(deps);
  assert.deepEqual(kms.unwrapCalls, ["stale"]);
});

test("a lapsed grant is cleaned up with no key use and no model call", async () => {
  const { store, kms, deps, modelCalls } = setup();
  await seedUser(store, kms, { userId: "expired", brief: brief(), now: NOW });
  await seedUser(store, kms, { userId: "abandoned", brief: brief(), now: NOW });
  store.grants.get("expired")!.expiresAt = new Date(NOW.getTime() - 1000);
  store.briefs.get("abandoned")!.deviceWrittenAt = new Date(NOW.getTime() - 15 * DAY);
  for (const id of ["expired", "abandoned"]) store.outbox.push({ id: `o-${id}`, userId: id, keyId: "k1", ciphertext: "x", createdAt: NOW });

  const summary = await runHeartbeat(deps);
  assert.equal(summary.lapsed, 2);
  for (const id of ["expired", "abandoned"]) {
    assert.ok(!store.grants.has(id) && !store.briefs.has(id));
  }
  assert.equal(store.outbox.length, 0);
  assert.equal(kms.unwrapCalls.length, 0);
  assert.equal(modelCalls.length, 0);
  assert.deepEqual(store.runs.map((r) => r.outcome).sort(), ["lapsed", "lapsed"]);
});

test("a grant that lapses between the claim and the run is deleted by the run", async () => {
  const { store, kms, deps, modelCalls } = setup();
  await seedUser(store, kms, { userId: "u1", brief: brief(), now: NOW });
  const claim = store.claimDue.bind(store);
  store.claimDue = async (...args) => {
    const claimed = await claim(...args);
    const stored = store.briefs.get("u1");
    if (stored) stored.deviceWrittenAt = new Date(NOW.getTime() - 15 * DAY);
    return claimed;
  };
  const summary = await runHeartbeat(deps);
  assert.deepEqual(summary.outcomes, { lapsed: 1 });
  assert.ok(!store.grants.has("u1") && !store.briefs.has("u1"));
  assert.equal(modelCalls.length, 0);
});

test("one failing user does not stop the batch, and each is released to try again later", async () => {
  const { store, kms, logs, deps } = setup();
  const ids = ["kms", "garbled", "tampered", "store", "fine1", "fine2"];
  const seeded: Record<string, { key: Buffer }> = {};
  for (const id of ids) seeded[id] = await seedUser(store, kms, { userId: id, brief: brief(), now: NOW });
  kms.failFor.add("kms");
  store.briefs.get("garbled")!.ciphertext = "AAAA";
  store.briefs.get("tampered")!.ciphertext = sealJson(seeded.tampered.key, "someone-else", BRIEF_COLLECTION, brief());
  store.failFinish.add("store");

  const summary = await runHeartbeat({ ...deps, concurrency: 6 });
  assert.deepEqual(summary.outcomes, { kms_failed: 1, decrypt_failed: 2, error: 1, ok: 2 });
  assert.equal(store.outbox.filter((o) => o.userId.startsWith("fine")).length, 2);
  for (const id of ["kms", "garbled", "tampered", "store"]) {
    const s = store.states.get(id)!;
    assert.equal(s.claimedUntil, null, `${id} is released`);
    assert.ok(s.nextBeatAt.getTime() > NOW.getTime(), `${id} is put back in time`);
    assert.equal(store.outbox.filter((o) => o.userId === id).length, 0);
  }
  assert.ok(logs.some((l) => l.outcome === "error" && l.error === "Error"), "an unexpected error is logged by name only");
  assert.ok(kms.unwrapped.every((k) => k.every((b) => b === 0)));
});

test("kill switch: off by default, and with it off nothing is unwrapped, decrypted or sent to the model", async () => {
  assert.equal(isHeartbeatEnabled({}), false);
  assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "false" }), false);
  assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: "1" }), false);
  assert.equal(isHeartbeatEnabled({ HEARTBEAT_ENABLED: " TRUE " }), true);

  const { store, kms, deps, modelCalls } = setup({ enabled: false, getKms: () => { throw new Error("must not build the KMS client"); } });
  await seedUser(store, kms, { userId: "u1", brief: brief(), now: NOW });
  await seedUser(store, kms, { userId: "gone", brief: brief(), now: NOW });
  store.grants.get("gone")!.expiresAt = new Date(NOW.getTime() - 1000);

  const summary = await runHeartbeat(deps);
  assert.equal(summary.enabled, false);
  assert.equal(summary.processed, 0);
  assert.equal(kms.unwrapCalls.length + modelCalls.length, 0);
  assert.equal(store.states.get("u1")!.claimedUntil, null);
  assert.ok(!store.grants.has("gone"), "expired data is still deleted");
});

test("a device brief written during the run wins; the outbox item is still kept", async () => {
  const { store, kms, deps } = setup();
  const { key } = await seedUser(store, kms, { userId: "u1", brief: brief(), now: NOW });
  const newer = sealJson(key, "u1", BRIEF_COLLECTION, brief());
  const summary = await runHeartbeat({
    ...deps,
    callModel: async () => {
      await store.putBrief("u1", { ciphertext: newer, keyId: "k1", deviceWrittenAt: NOW }, NOW);
      return SCRIPT;
    },
  });
  assert.deepEqual(summary.outcomes, { ok_superseded: 1 });
  assert.equal(store.briefs.get("u1")!.ciphertext, newer);
  assert.equal(store.outbox.length, 1);
});

test("a grant revoked during the run leaves nothing behind", async () => {
  const { store, kms, deps } = setup();
  await seedUser(store, kms, { userId: "u1", brief: brief(), now: NOW });
  await runHeartbeat({
    ...deps,
    callModel: async () => {
      await store.deleteGrantData("u1");
      return SCRIPT;
    },
  });
  assert.equal(store.outbox.length, 0);
  assert.ok(!store.briefs.has("u1") && !store.grants.has("u1"));
});

test("per-user limits: a full outbox waits, a rotation in flight waits, the daily model allowance is honoured", async () => {
  const { store, kms, deps, modelCalls } = setup();
  await seedUser(store, kms, { userId: "full", brief: brief(), now: NOW });
  await seedUser(store, kms, { userId: "rotating", brief: brief(), now: NOW });
  await seedUser(store, kms, { userId: "capped", brief: brief(), now: NOW });
  for (let i = 0; i < 50; i++) store.outbox.push({ id: `o${i}`, userId: "full", keyId: "k1", ciphertext: "x", createdAt: NOW });
  store.grants.get("rotating")!.keyId = "k2";

  const summary = await runHeartbeat({ ...deps, allowModel: async (userId) => userId !== "capped" });
  assert.equal(summary.outcomes.outbox_full, 1);
  assert.equal(summary.outcomes.key_mismatch, 1);
  assert.deepEqual(kms.unwrapCalls, ["capped"]);
  assert.equal(modelCalls.length, 0);
  assert.equal(store.outbox.filter((o) => o.userId === "capped").length, 0, "no model call, nothing to post");
  assert.ok(store.states.get("full")!.nextBeatAt > NOW && store.states.get("rotating")!.nextBeatAt > NOW);
});

test("a beat with nothing to say leaves no outbox item", async () => {
  const { store, kms, deps } = setup();
  await seedUser(store, kms, { userId: "u1", brief: sleeping(fixture("nothing-due").brief), now: NOW });
  await runHeartbeat({ ...deps, callModel: async () => ({}) });
  assert.equal(store.outbox.length, 0);
  assert.equal(store.runs[0].outcome, "ok");
});

test("a run is bounded: at most maxUsers, and none once the time budget is spent", async () => {
  const a = setup();
  for (let i = 0; i < 5; i++) await seedUser(a.store, a.kms, { userId: `u${i}`, brief: brief(), now: NOW });
  const summary = await runHeartbeat({ ...a.deps, concurrency: 1, maxUsers: 2 });
  assert.equal(summary.processed, 2);

  const b = setup();
  await seedUser(b.store, b.kms, { userId: "u1", brief: brief(), now: NOW });
  assert.equal((await runHeartbeat({ ...b.deps, budgetMs: 0 })).processed, 0);
  assert.equal(b.store.states.get("u1")!.claimedUntil, null);
});

test("the server trigger is the server's own: a device may not send it", () => {
  assert.ok(beatRequestSchema.safeParse({ trigger: "app_open", brief: brief() }).success);
  assert.ok(!beatRequestSchema.safeParse({ trigger: "heartbeat", brief: brief() }).success);
});

test("the run's own user id reaches the beat, so a memorize card uses that reader's translation", async (t) => {
  const asked: string[] = [];
  t.mock.method(passageSource, "readerTranslation", async (userId: string) => (asked.push(userId), userId === "user-7" ? "KJV" : "BSB"));
  t.mock.method(passageSource, "loadVerses", async () => [{ n: 1, text: "The Lord is my shepherd." }]);
  const { store, kms, deps } = setup({
    callModel: async () => ({
      posts: [{ goalId: "g-prayer", reason: "rhythm", type: "memorize", payload: { ref: "PSA:23:1" }, message: "Here is a verse to keep close, if you would like to." }],
    }),
  });
  const { key } = await seedUser(store, kms, { userId: "user-7", brief: structuredClone(fixture("memorize-practice").brief), now: NOW });

  const summary = await runHeartbeat(deps);
  assert.deepEqual(summary.outcomes, { ok: 1 });
  assert.deepEqual(asked, ["user-7"]);
  const item: any = openJson(key, "user-7", OUTBOX_COLLECTION, store.outbox[0].ciphertext);
  assert.equal(item.posts[0].card.kind, "passage_card");
  assert.equal(item.posts[0].card.translation, "KJV");
});
