// Runs with or without a Redis: when the cache cannot be reached the count is kept in the process.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.KV_SILENT = "1";

import { heartbeatModelAllowed, takeModelCall } from "./dailyCap";

test("a user gets a fixed number of model calls a day, and each day starts again", async () => {
  const user = `test-user-${Date.now()}`;
  assert.deepEqual([await takeModelCall(user, "2026-11-23", 2), await takeModelCall(user, "2026-11-23", 2), await takeModelCall(user, "2026-11-23", 2)], [true, true, false]);
  assert.equal(await takeModelCall(user, "2026-11-24", 2), true);
  assert.equal(await takeModelCall(`${user}-other`, "2026-11-23", 2), true);
});

test("a free account gets no heartbeat model calls and takes none from the day; Plus takes one", async () => {
  const taken: string[] = [];
  const take = async (userId: string) => (taken.push(userId), true);
  const allowed = heartbeatModelAllowed(async (userId) => userId === "plus", take);
  assert.equal(await allowed("free", "2026-11-23"), false);
  assert.equal(await allowed("plus", "2026-11-23"), true);
  assert.deepEqual(taken, ["plus"]);
  const lookupFails = heartbeatModelAllowed(async () => Promise.reject(new Error("db")), take);
  assert.equal(await lookupFails("plus", "2026-11-23"), false);
});
