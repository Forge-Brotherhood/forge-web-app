import assert from "node:assert/strict";
import { test } from "node:test";

import { usageCounts } from "./modelUsage";

test("a Responses usage report becomes input, cached and output counts", () => {
  const usage = { input_tokens: 10_200, input_tokens_details: { cached_tokens: 6_144 }, output_tokens: 640, output_tokens_details: { reasoning_tokens: 300 } };
  assert.deepEqual(usageCounts(usage), { inputTokens: 10_200, cachedTokens: 6_144, outputTokens: 640 });
});

test("no cached detail counts as none cached, and a report without counts is skipped", () => {
  assert.deepEqual(usageCounts({ input_tokens: 50, output_tokens: 5 }), { inputTokens: 50, cachedTokens: 0, outputTokens: 5 });
  assert.equal(usageCounts(undefined), null);
  assert.equal(usageCounts({ input_tokens: 50 }), null);
});
