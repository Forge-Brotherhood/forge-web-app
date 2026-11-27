import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EMPTY_ALLOWANCE,
  FIRST_DAY_CAP,
  WEEK_MS,
  allowanceView,
  freeRepliesPerWeek,
  readAllowance,
  takeChatReply,
  takeReply,
  type AllowanceRow,
  type AllowanceStore,
} from "./allowance";

const HOUR = 3_600_000;
const CREATED = new Date("2026-11-01T09:00:00Z");
const LATER = new Date(CREATED.getTime() + 10 * 24 * HOUR); // well past the first day

/** Takes `n` replies in a row at `now`, returning the row and how many were allowed. */
const takeMany = (row: AllowanceRow, n: number, now: Date, limit = 20) => {
  let allowed = 0;
  for (let i = 0; i < n; i++) {
    const r = takeReply(row, { now, accountCreatedAt: CREATED, limit });
    if (r.allowed) {
      row = r.next;
      allowed++;
    } else {
      row = r.refused;
    }
  }
  return { row, allowed };
};

test("the window starts at the first counted reply and the limit is the week's", () => {
  const before = allowanceView(EMPTY_ALLOWANCE, { now: LATER, accountCreatedAt: CREATED, limit: 20 });
  assert.deepEqual(before, { limit: 20, used: 0, remaining: 20, resetsAt: null });

  const { row, allowed } = takeMany(EMPTY_ALLOWANCE, 22, LATER);
  assert.equal(allowed, 20);
  assert.equal(row.windowStart?.getTime(), LATER.getTime());
  assert.deepEqual([row.gateHits, row.lastGateAt?.getTime()], [2, LATER.getTime()]);
  assert.deepEqual(allowanceView(row, { now: LATER, accountCreatedAt: CREATED, limit: 20 }), {
    limit: 20,
    used: 20,
    remaining: 0,
    resetsAt: new Date(LATER.getTime() + WEEK_MS).toISOString(),
  });
});

test("the window rolls over a week after it started, and the next one starts at the next counted reply", () => {
  const { row } = takeMany(EMPTY_ALLOWANCE, 20, LATER);
  const almost = new Date(LATER.getTime() + WEEK_MS - 1);
  assert.equal(takeReply(row, { now: almost, accountCreatedAt: CREATED, limit: 20 }).allowed, false);

  const after = new Date(LATER.getTime() + WEEK_MS + 3 * 24 * HOUR);
  assert.deepEqual(allowanceView(row, { now: after, accountCreatedAt: CREATED, limit: 20 }), { limit: 20, used: 0, remaining: 20, resetsAt: null });
  const r = takeReply(row, { now: after, accountCreatedAt: CREATED, limit: 20 });
  assert.ok(r.allowed);
  assert.deepEqual([r.next.used, r.next.windowStart?.getTime()], [1, after.getTime()]);
});

test("the first 24 hours are not counted against the week, up to the cap, and remaining includes them", () => {
  const firstHour = new Date(CREATED.getTime() + HOUR);
  const view = allowanceView(EMPTY_ALLOWANCE, { now: firstHour, accountCreatedAt: CREATED, limit: 20 });
  assert.deepEqual(view, { limit: 20, used: 0, remaining: 20 + FIRST_DAY_CAP, resetsAt: null });

  const { row, allowed } = takeMany(EMPTY_ALLOWANCE, FIRST_DAY_CAP + 25, firstHour);
  assert.equal(allowed, FIRST_DAY_CAP + 20, "the cap, then the week");
  assert.equal(row.firstDayUsed, FIRST_DAY_CAP);
  assert.equal(row.used, 20);
  assert.equal(row.gateHits, 5);
});

test("after the first day, the week counts from the next reply; unused first-day replies do not carry over", () => {
  const { row } = takeMany(EMPTY_ALLOWANCE, 5, new Date(CREATED.getTime() + HOUR));
  assert.deepEqual([row.firstDayUsed, row.used, row.windowStart], [5, 0, null]);
  const day2 = new Date(CREATED.getTime() + 25 * HOUR);
  assert.deepEqual(allowanceView(row, { now: day2, accountCreatedAt: CREATED, limit: 20 }).remaining, 20);
  const r = takeReply(row, { now: day2, accountCreatedAt: CREATED, limit: 20 });
  assert.ok(r.allowed);
  assert.deepEqual([r.next.used, r.next.firstDayUsed], [1, 5]);
});

test("a limit changed mid-window applies at once, up or down", () => {
  const { row } = takeMany(EMPTY_ALLOWANCE, 12, LATER);
  const lower = { now: LATER, accountCreatedAt: CREATED, limit: 10 };
  assert.equal(takeReply(row, lower).allowed, false);
  assert.deepEqual(allowanceView(row, lower).remaining, 0);
  const higher = { now: LATER, accountCreatedAt: CREATED, limit: 30 };
  assert.equal(takeReply(row, higher).allowed, true);
  assert.equal(allowanceView(row, higher).remaining, 18);
});

test("FREE_REPLIES_PER_WEEK sets the limit, 20 when unset or not a count", () => {
  const before = process.env.FREE_REPLIES_PER_WEEK;
  delete process.env.FREE_REPLIES_PER_WEEK;
  assert.equal(freeRepliesPerWeek(), 20);
  process.env.FREE_REPLIES_PER_WEEK = "10";
  assert.equal(freeRepliesPerWeek(), 10);
  process.env.FREE_REPLIES_PER_WEEK = "lots";
  assert.equal(freeRepliesPerWeek(), 20);
  if (before === undefined) delete process.env.FREE_REPLIES_PER_WEEK;
  else process.env.FREE_REPLIES_PER_WEEK = before;
});

/** A store held in memory, with the same compare-and-set rule as the database's. */
function memoryAllowanceStore(accountCreatedAt = CREATED) {
  const rows = new Map<string, AllowanceRow>();
  const store: AllowanceStore = {
    load: async (userId) => ({ row: rows.get(userId) ?? null, accountCreatedAt }),
    save: async (userId, prev, next) => {
      if (JSON.stringify(rows.get(userId) ?? null) !== JSON.stringify(prev)) return false;
      rows.set(userId, next);
      return true;
    },
  };
  return { rows, store };
}

test("taking a reply through the store: counted when allowed, and a refusal is written only when committed", async () => {
  const { rows, store } = memoryAllowanceStore();
  for (let i = 0; i < 2; i++) assert.deepEqual(await takeChatReply(store, "u1", LATER, 2), { allowed: true });
  assert.equal(rows.get("u1")?.used, 2);

  const refused = await takeChatReply(store, "u1", LATER, 2);
  assert.equal(refused.allowed, false);
  if (refused.allowed) return;
  assert.deepEqual(refused.allowance, { limit: 2, used: 2, remaining: 0, resetsAt: new Date(LATER.getTime() + WEEK_MS).toISOString() });
  assert.equal(rows.get("u1")?.gateHits, 0, "not written yet");
  await refused.commitRefusal();
  assert.equal(rows.get("u1")?.gateHits, 1);
  assert.deepEqual(await readAllowance(store, "u1", LATER, 2), refused.allowance);
});

test("two replies at once cannot both take the last one", async () => {
  const { rows, store } = memoryAllowanceStore();
  await takeChatReply(store, "u1", LATER, 2);
  const [a, b] = await Promise.all([takeChatReply(store, "u1", LATER, 2), takeChatReply(store, "u1", LATER, 2)]);
  assert.deepEqual([a.allowed, b.allowed].sort(), [false, true]);
  assert.equal(rows.get("u1")?.used, 2);
});
