import assert from "node:assert/strict";
import { test } from "node:test";

import { isCronAuthorized } from "./cronAuth";

test("the cron secret check", () => {
  assert.equal(isCronAuthorized("Bearer s3cret", "s3cret"), true);
  assert.equal(isCronAuthorized("Bearer s3cret!", "s3cret"), false);
  assert.equal(isCronAuthorized("s3cret", "s3cret"), false, "needs the Bearer prefix");
  assert.equal(isCronAuthorized("bearer s3cret", "s3cret"), false);
  assert.equal(isCronAuthorized(null, "s3cret"), false);
  assert.equal(isCronAuthorized("", "s3cret"), false);
});

test("it refuses everything when the secret is not set", () => {
  assert.equal(isCronAuthorized("Bearer undefined", undefined), false);
  assert.equal(isCronAuthorized("Bearer ", ""), false);
  assert.equal(isCronAuthorized(null, undefined), false);
  assert.equal(isCronAuthorized("Bearer ", undefined), false);
});
