// Runs with or without a Redis: when the cache cannot be reached the count is kept in the process.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.KV_SILENT = "1";

import { takeModelCall } from "./dailyCap";

test("a user gets a fixed number of model calls a day, and each day starts again", async () => {
  const user = `test-user-${Date.now()}`;
  assert.deepEqual([await takeModelCall(user, "2026-11-23", 2), await takeModelCall(user, "2026-11-23", 2), await takeModelCall(user, "2026-11-23", 2)], [true, true, false]);
  assert.equal(await takeModelCall(user, "2026-11-24", 2), true);
  assert.equal(await takeModelCall(`${user}-other`, "2026-11-23", 2), true);
});
