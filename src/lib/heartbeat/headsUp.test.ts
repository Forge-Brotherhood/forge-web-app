// The heads-up run (push-engagement-plan.md §4): no database, AWS or network.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PushPayload } from "@/lib/apns";
import { FIXTURE_NOW, TIME_ZONE, entry, fixture } from "./fixtures";
import { FakeKms, MemoryStore, seedUser } from "./fixtures/fakes";
import { decide, dueSendTime, nextSendTime, zonedInstant } from "./rules";
import type { Brief } from "./schemas";
import { runHeartbeat, type LogEvent, type RunDeps } from "./serverRun";

const MIN = 60_000;
const DAY = 86_400_000;
/** Monday 23 November 2026, 06:20 in New York: inside quiet hours (21:30 to 07:00). */
const SEND = zonedInstant("2026-11-23", "06:20", TIME_ZONE);
const TOMORROW = new Date(SEND.getTime() + DAY);
const brief = (): Brief => structuredClone(fixture("finish-due").brief);

const SCRIPT = {
  posts: [{ goalId: "g-bible", reason: "due", type: "reading", payload: { ref: "NUM:14" }, message: "Today's is Numbers 14.", notify: { text: "A reading is ready for you" } }],
};

function setup(at: Date = SEND) {
  const store = new MemoryStore();
  const kms = new FakeKms();
  const logs: LogEvent[] = [];
  const sent: PushPayload[] = [];
  const clock = { now: at };
  const deps: RunDeps = {
    store,
    getKms: () => kms,
    callModel: async () => SCRIPT,
    allowModel: async () => true,
    log: (event) => logs.push(event),
    now: () => clock.now,
    enabled: true,
    push: {
      tokensFor: async () => ["tok"],
      send: async (tokens, payload) => (sent.push(payload), { successCount: tokens.length, failedTokens: [] }),
      cleanup: async () => undefined,
    },
  };
  return { store, kms, logs, sent, clock, deps };
}

/** A user whose send time is due at `SEND` and who has not opened the app today. */
async function seedHeadsUp(s: ReturnType<typeof setup>, userId = "u1", sendTimes = [SEND, TOMORROW]) {
  const seeded = await seedUser(s.store, s.kms, { userId, brief: brief(), now: s.clock.now, nextBeatAt: SEND, pushEnabled: true });
  s.store.states.get(userId)!.sendTimes = sendTimes;
  s.store.briefs.get(userId)!.receivedAt = new Date(SEND.getTime() - DAY);
  return seeded;
}

const pushCode = (logs: LogEvent[]) => logs.find((l) => l.tag === "heartbeat.run" && l.outcome !== undefined && "pushed" in l)?.push;

test("dueSendTime and nextSendTime: due for an hour after it comes, then not", () => {
  const times = [SEND, TOMORROW];
  assert.equal(dueSendTime(times, new Date(SEND.getTime() - 1)), null);
  assert.equal(dueSendTime(times, SEND)?.getTime(), SEND.getTime());
  assert.equal(dueSendTime(times, new Date(SEND.getTime() + 59 * MIN))?.getTime(), SEND.getTime());
  assert.equal(dueSendTime(times, new Date(SEND.getTime() + 60 * MIN)), null);
  assert.equal(nextSendTime(times, SEND)?.getTime(), TOMORROW.getTime());
  assert.equal(nextSendTime(times, new Date(SEND.getTime() - 1))?.getTime(), SEND.getTime());
  assert.equal(nextSendTime([], SEND), null);
});

test("a run at a send time inside quiet hours goes ahead and pushes, expiring an hour after the send time", async () => {
  const s = setup();
  await seedHeadsUp(s);
  const summary = await runHeartbeat(s.deps);

  assert.equal(summary.deferred, 0);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].expiresAt?.getTime(), SEND.getTime() + 60 * MIN);
  assert.equal(s.sent[0].collapseId, "headsup-2026-11-23");
  assert.equal(s.store.states.get("u1")!.lastHeadsUpDay, "2026-11-23");
  assert.equal(s.store.outbox.length, 1);
  assert.ok(s.store.states.get("u1")!.nextBeatAt.getTime() <= TOMORROW.getTime(), "the next beat is no later than the next send time");
});

test("outside a send time, quiet hours still hold a run back, but never past the next send time", async () => {
  const s = setup(new Date(SEND.getTime() - 440 * MIN)); // 23:00 the night before
  await seedHeadsUp(s);
  s.store.states.get("u1")!.nextBeatAt = new Date(s.clock.now.getTime() - MIN);

  const summary = await runHeartbeat(s.deps);
  assert.equal(summary.deferred, 1);
  assert.equal(s.store.states.get("u1")!.nextBeatAt.getTime(), SEND.getTime(), "at 06:20, not 07:15");
});

test("a run due earlier on a day with a send time still to come waits for it", async () => {
  const s = setup(new Date(SEND.getTime() + 80 * MIN)); // 07:40, after quiet hours
  const later = zonedInstant("2026-11-23", "08:30", TIME_ZONE);
  await seedHeadsUp(s, "u1", [later, new Date(later.getTime() + DAY)]);
  s.store.states.get("u1")!.nextBeatAt = s.clock.now;

  const summary = await runHeartbeat(s.deps);
  assert.equal(summary.deferred, 1);
  assert.equal(s.store.outbox.length, 0, "the day's post is left for the heads-up");
  assert.equal(s.store.states.get("u1")!.nextBeatAt.getTime(), later.getTime());
});

test("the person was already in the app today: the post is made, the push is not", async () => {
  const s = setup();
  await seedHeadsUp(s);
  s.store.briefs.get("u1")!.receivedAt = zonedInstant("2026-11-23", "05:50", TIME_ZONE);
  await runHeartbeat(s.deps);
  assert.equal(s.sent.length, 0);
  assert.equal(s.store.outbox.length, 1);
  assert.equal(pushCode(s.logs), "here_today");
});

test("a device brief written during the run means they are here: no push", async () => {
  const s = setup();
  await seedHeadsUp(s);
  s.deps.callModel = async () => {
    await s.store.putBrief("u1", { ciphertext: s.store.briefs.get("u1")!.ciphertext, keyId: "k1", deviceWrittenAt: SEND }, SEND);
    return SCRIPT;
  };
  await runHeartbeat(s.deps);
  assert.equal(s.sent.length, 0);
  assert.equal(pushCode(s.logs), "superseded");
});

test("paused, or a heads-up already sent today: no push", async () => {
  const paused = setup();
  await seedHeadsUp(paused);
  paused.store.states.get("u1")!.pausedUntil = new Date(SEND.getTime() + 3 * DAY);
  await runHeartbeat(paused.deps);
  assert.equal(paused.sent.length, 0);
  assert.equal(pushCode(paused.logs), "paused");

  const twice = setup();
  await seedHeadsUp(twice);
  twice.store.states.get("u1")!.lastHeadsUpDay = "2026-11-23";
  await runHeartbeat(twice.deps);
  assert.equal(twice.sent.length, 0);
  assert.equal(pushCode(twice.logs), "already_today");
  assert.equal(twice.store.outbox.length, 1, "the post still arrives");
});

test("a run more than 10 minutes after its send time posts but sends no push", async () => {
  const s = setup(new Date(SEND.getTime() + 15 * MIN));
  await seedHeadsUp(s);
  await runHeartbeat(s.deps);
  assert.equal(s.sent.length, 0);
  assert.equal(s.store.outbox.length, 1);
  assert.equal(pushCode(s.logs), "late");
});

test("a heads-up run that fails tries again in 5 minutes; another run waits an hour, or until the next send time", async () => {
  const s = setup();
  await seedHeadsUp(s);
  s.kms.failFor.add("u1");
  await runHeartbeat(s.deps);
  assert.equal(s.store.states.get("u1")!.nextBeatAt.getTime(), SEND.getTime() + 5 * MIN);

  // 23:50 the night before a send time at 00:20, with no quiet hours, so the run goes ahead.
  const soon = zonedInstant("2026-11-23", "00:20", TIME_ZONE);
  const other = setup(new Date(soon.getTime() - 30 * MIN));
  await seedHeadsUp(other, "u1", [soon]);
  other.store.states.get("u1")!.quietStart = other.store.states.get("u1")!.quietEnd;
  other.store.states.get("u1")!.nextBeatAt = other.clock.now;
  other.kms.failFor.add("u1");
  await runHeartbeat(other.deps);
  assert.deepEqual(other.kms.unwrapCalls, ["u1"]);
  assert.equal(other.store.states.get("u1")!.nextBeatAt.getTime(), soon.getTime(), "not an hour later, past the send time");
});

test("the same tick run twice, or two runs at once, send one push", async () => {
  const s = setup();
  await seedHeadsUp(s);
  await Promise.all([runHeartbeat(s.deps), runHeartbeat(s.deps)]);
  s.store.states.get("u1")!.nextBeatAt = SEND; // as if the tick came again
  await runHeartbeat(s.deps);
  assert.equal(s.sent.length, 1);
});

test("a device that sends send times gets no push from other runs; one that sends none keeps the older push", async () => {
  const s = setup(FIXTURE_NOW); // 10:00, no send time due
  await seedHeadsUp(s, "new", [TOMORROW]);
  s.store.states.get("new")!.nextBeatAt = FIXTURE_NOW;
  await seedHeadsUp(s, "old", []);
  s.store.states.get("old")!.nextBeatAt = FIXTURE_NOW;

  await runHeartbeat(s.deps);
  assert.equal(s.store.outbox.length, 2, "both get the post");
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].collapseId, undefined, "the older push is not a heads-up");
});

test("on a heads-up run, an activity starting within the hour counts as due; otherwise only at its time", () => {
  const b = brief();
  b.goals[0].activities = [entry("g-bible", "reading", 0, "planned", { scheduledTime: "07:00" })];
  assert.deepEqual(decide(b, SEND, "heartbeat", { headsUp: true }).goals[0].dueTypes, ["reading"]);
  assert.deepEqual(decide(b, SEND, "heartbeat").goals[0].dueTypes, []);
  b.goals[0].activities = [entry("g-bible", "reading", 0, "planned", { scheduledTime: "07:30" })];
  assert.deepEqual(decide(b, SEND, "heartbeat", { headsUp: true }).goals[0].dueTypes, []);
});

test("new send times bring the next beat forward, never back", async () => {
  const store = new MemoryStore();
  const state = { enabled: true, timezone: TIME_ZONE, quietStart: "21:30", quietEnd: "07:00", pushEnabled: true };
  const now = new Date(SEND.getTime() - 10 * 60 * MIN);
  await store.putState("u1", state, now);
  store.states.get("u1")!.nextBeatAt = new Date(SEND.getTime() + 2 * DAY);

  await store.putState("u1", { ...state, sendTimes: [SEND, TOMORROW] }, now);
  assert.equal(store.states.get("u1")!.nextBeatAt.getTime(), SEND.getTime());
  await store.putState("u1", { ...state, sendTimes: [TOMORROW] }, now);
  assert.equal(store.states.get("u1")!.nextBeatAt.getTime(), SEND.getTime(), "a later send time does not push the beat back");
});
