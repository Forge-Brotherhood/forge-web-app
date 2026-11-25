// The heads-up simulator (push-engagement-plan.md §12.2): the real server run, rules and sealing over
// 28 days in 5-minute ticks, against the in-memory store, a fake KMS and a scripted model. Each persona
// declares its send times and app opens directly; the phone's learner is tested in XCTest. The expected
// counts make silence fail.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PushPayload } from "@/lib/apns";
import { BRIEF_COLLECTION, openJson, sealJson } from "./crypto";
import { goal, makeBrief } from "./fixtures";
import { FakeKms, MemoryStore, seedUser } from "./fixtures/fakes";
import { addDays, localParts, zonedInstant } from "./rules";
import { briefSchema, type Brief } from "./schemas";
import { runHeartbeat, type LogEvent } from "./serverRun";

const TZ = "America/New_York";
/** A Monday, with no daylight-saving change in the next 28 days. */
const START_DAY = "2026-11-30";
const DAYS = 28;
const TICK = 5 * 60_000;
const DAY = 86_400_000;
const USER = "u1";

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;
const dayIndex = (at: Date) => Math.round((Date.parse(`${localParts(at, TZ).date}T00:00:00Z`) - Date.parse(`${START_DAY}T00:00:00Z`)) / DAY);
const clockOf = (at: Date) => {
  const m = localParts(at, TZ).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

type Persona = {
  name: string;
  /** The local send time on a day, if any. */
  send: (day: number, weekday: number) => string | null;
  /** The local time the app is first opened on a day, if at all. */
  opens: (day: number, weekday: number) => string | null;
  /** Grieving from this day on (the device writes it into the brief at the next open). */
  griefFrom?: number;
  /** Notifications paused for these days, set by the device at the start of the first. */
  paused?: { from: number; to: number };
  /** KMS fails on this day between these local times. */
  kmsDown?: { day: number; from: string; to: string };
  expected: number;
  /** Days that must still get a post from the server. */
  postsOn?: (day: number, weekday: number) => boolean;
};

const PERSONAS: Persona[] = [
  { name: "early-riser", send: (_, w) => (isWeekday(w) ? "06:20" : null), opens: () => "06:40", expected: 20 },
  { name: "anchor-in-quiet-hours", send: (_, w) => (isWeekday(w) ? "06:10" : null), opens: () => "06:30", expected: 20 },
  { name: "opens-at-07", send: (_, w) => (isWeekday(w) ? "06:40" : null), opens: () => "07:00", expected: 20 },
  {
    name: "opens-first",
    send: (_, w) => (isWeekday(w) ? "07:10" : null),
    opens: () => "06:50",
    expected: 0,
    postsOn: (_, w) => isWeekday(w),
  },
  // After quiet hours: the morning run must wait for the send time, not take the day's post at 07:15.
  { name: "late-riser", send: (_, w) => (isWeekday(w) ? "08:30" : null), opens: () => "08:50", expected: 20 },
  { name: "grieving", send: () => "06:30", opens: () => "07:00", griefFrom: 4, expected: 4 },
  { name: "paused", send: () => "06:30", opens: () => "07:00", paused: { from: 9, to: 15 }, expected: 21 },
  {
    name: "late-run",
    send: (_, w) => (isWeekday(w) ? "06:20" : null),
    opens: () => "06:50",
    kmsDown: { day: 2, from: "06:20", to: "06:45" },
    expected: 19,
    postsOn: (d) => d === 2,
  },
];

/** What the scripted model always offers: the reading, as due or by rhythm, whichever the rules allow. */
const post = (reason: string) => ({
  goalId: "g-bible",
  reason,
  type: "reading",
  payload: { ref: "NUM:14" },
  message: "Today's reading is ready.",
  notify: { text: "A reading is ready for you" },
});
const SCRIPT = { posts: [post("due"), post("rhythm")] };

function startBrief(at: Date): Brief {
  const b = makeBrief([
    goal({
      id: "g-bible",
      title: "Read the Bible in a year",
      shape: "finish",
      category: "reading",
      rhythm: "daily",
      nextReadings: ["NUM:14"],
      lastActivityAt: new Date(at.getTime() - DAY).toISOString(),
    }),
  ]);
  const iso = at.toISOString();
  b.freshness = { person: iso, pulse: iso, goals: iso, outreach: iso, wishes: iso };
  return b;
}

async function simulate(p: Persona) {
  const store = new MemoryStore();
  const kms = new FakeKms();
  const start = zonedInstant(START_DAY, "00:00", TZ);
  let now = start;
  const pushes: Array<{ at: Date; payload: PushPayload }> = [];
  const postDays = new Set<number>();
  const opens = new Map<number, Date>();

  const { key, keyId } = await seedUser(store, kms, { userId: USER, brief: startBrief(start), now, nextBeatAt: start, pushEnabled: true });
  store.briefs.get(USER)!.receivedAt = new Date(start.getTime() - DAY);

  /** The phone works out the next 7 send times on each open (§3.4). */
  const sendTimes = (from: Date): Date[] => {
    const out: Date[] = [];
    const today = dayIndex(from);
    for (let d = today; d < today + 9 && out.length < 7; d++) {
      const date = addDays(START_DAY, d);
      const clock = p.send(d, localParts(zonedInstant(date, "12:00", TZ), TZ).weekday);
      const at = clock && zonedInstant(date, clock, TZ);
      if (at && at.getTime() > from.getTime()) out.push(at);
    }
    return out;
  };
  let pausedUntil: Date | null = null;
  const putState = () =>
    store.putState(USER, { enabled: true, timezone: TZ, quietStart: "21:30", quietEnd: "07:00", pushEnabled: true, sendTimes: sendTimes(now), pausedUntil }, now);
  await putState();

  /** An app open: take the outbox, mark what was posted as done, write the brief, renew the grant, send the state. */
  const open = async (day: number) => {
    opens.set(day, now);
    const items = await store.listOutbox(USER, 100);
    await store.ackOutbox(USER, items.map((i) => i.id));
    const b = briefSchema.parse(openJson(key, USER, BRIEF_COLLECTION, store.briefs.get(USER)!.ciphertext));
    const iso = now.toISOString();
    b.freshness = { person: iso, pulse: iso, goals: iso, outreach: iso, wishes: iso };
    if (p.griefFrom !== undefined && day + 1 >= p.griefFrom) b.person.season = "grieving";
    for (const g of b.goals) {
      g.lastActivityAt = iso;
      g.activities = g.activities.map((a) => (a.status === "posted" ? { ...a, status: "done" as const, outcome: { at: iso } } : a)).slice(-10);
      g.thread.turns = g.thread.turns.slice(-10);
    }
    await store.putBrief(USER, { ciphertext: sealJson(key, USER, BRIEF_COLLECTION, b), keyId, deviceWrittenAt: now }, now);
    store.grants.get(USER)!.expiresAt = new Date(now.getTime() + 14 * DAY);
    await putState();
  };

  const deps = {
    store,
    getKms: () => kms,
    callModel: async () => SCRIPT,
    allowModel: async () => true,
    log: (event: LogEvent) => {
      if (event.tag === "heartbeat.run" && typeof event.posts === "number" && event.posts > 0) postDays.add(dayIndex(now));
    },
    now: () => now,
    enabled: true,
    push: {
      tokensFor: async () => ["tok"],
      send: async (tokens: string[], payload: PushPayload) => (pushes.push({ at: now, payload }), { successCount: tokens.length, failedTokens: [] }),
      cleanup: async () => undefined,
    },
  };

  for (let t = start.getTime(); t < start.getTime() + DAYS * DAY; t += TICK) {
    now = new Date(t);
    const day = dayIndex(now);
    const { weekday } = localParts(now, TZ);
    const clock = clockOf(now);

    if (p.paused && day === p.paused.from && clock === "00:00") {
      pausedUntil = zonedInstant(addDays(START_DAY, p.paused.to + 1), "00:00", TZ);
      await putState();
    }
    if (p.kmsDown && day === p.kmsDown.day) {
      if (clock === p.kmsDown.from) kms.failFor.add(USER);
      if (clock === p.kmsDown.to) kms.failFor.delete(USER);
    }
    if (p.opens(day, weekday) === clock) await open(day);
    await runHeartbeat(deps);
  }

  return { pushes, postDays, opens, grantKeyId: keyId };
}

for (const persona of PERSONAS) {
  test(`simulator: ${persona.name} gets ${persona.expected} heads-ups in ${DAYS} days`, async () => {
    const { pushes, postDays, opens, grantKeyId } = await simulate(persona);

    // The rules at every push.
    const days = pushes.map((x) => dayIndex(x.at));
    assert.equal(new Set(days).size, days.length, "at most one heads-up a day");
    for (const { at, payload } of pushes) {
      const day = dayIndex(at);
      const weekday = localParts(at, TZ).weekday;
      assert.ok(payload.collapseId?.startsWith("headsup-"), "every push is a heads-up");
      assert.equal(clockOf(at), persona.send(day, weekday), "sent at the send time");
      const opened = opens.get(day);
      assert.ok(!opened || opened.getTime() > at.getTime(), "none after they opened the app that day");
      if (persona.paused) assert.ok(day < persona.paused.from || day > persona.paused.to, "none while paused");
      if (persona.griefFrom !== undefined) assert.ok(day < persona.griefFrom, "none in care mode");
      assert.equal(payload.data?.keyId, grantKeyId, "sealed under the key the device holds");
    }

    assert.equal(pushes.length, persona.expected);
    if (persona.postsOn) {
      for (let d = 0; d < DAYS; d++) {
        const weekday = localParts(zonedInstant(addDays(START_DAY, d), "12:00", TZ), TZ).weekday;
        if (persona.postsOn(d, weekday)) assert.ok(postDays.has(d), `a post on day ${d}`);
      }
    }
  });
}
