import assert from "node:assert/strict";
import { test } from "node:test";

import { hasPlus, subscriptionJson, subscriptionState, type SubscriptionRow } from "./entitlement";

const NOW = new Date("2026-12-01T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

const row = (r: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  source: "app_store",
  productId: "forge.Forge.plus.annual",
  isTrial: false,
  willRenew: true,
  expiresAt: at(30),
  graceExpiresAt: null,
  revokedAt: null,
  ...r,
});

test("no row is Free; a row ahead of its expiry is Plus; a comp with no end is Plus", () => {
  assert.equal(hasPlus(null, NOW), false);
  assert.equal(hasPlus(row(), NOW), true);
  assert.equal(hasPlus(row({ source: "comp", expiresAt: null }), NOW), true);
  assert.equal(hasPlus(row({ expiresAt: at(-1) }), NOW), false);
  assert.equal(hasPlus(row({ expiresAt: NOW }), NOW), false, "expiry is exclusive");
});

test("grace keeps Plus on past expiry until the grace ends; a revoked row is never Plus", () => {
  assert.equal(hasPlus(row({ expiresAt: at(-2), graceExpiresAt: at(3) }), NOW), true);
  assert.equal(hasPlus(row({ expiresAt: at(-2), graceExpiresAt: at(-1) }), NOW), false);
  assert.equal(hasPlus(row({ revokedAt: at(-1) }), NOW), false);
  assert.equal(hasPlus(row({ source: "comp", expiresAt: null, revokedAt: at(-1) }), NOW), false);
});

test("each state the Profile row shows", () => {
  assert.equal(subscriptionState(row({ isTrial: true }), NOW), "trial");
  assert.equal(subscriptionState(row(), NOW), "active");
  assert.equal(subscriptionState(row({ willRenew: false }), NOW), "cancelled");
  assert.equal(subscriptionState(row({ isTrial: true, willRenew: false }), NOW), "cancelled", "a cancelled trial ends, then Free");
  assert.equal(subscriptionState(row({ expiresAt: at(-1), graceExpiresAt: at(10) }), NOW), "grace");
  assert.equal(subscriptionState(row({ expiresAt: at(-1), graceExpiresAt: at(-0.5) }), NOW), "expired");
  assert.equal(subscriptionState(row({ expiresAt: at(-1) }), NOW), "expired");
  assert.equal(subscriptionState(row({ revokedAt: at(-1) }), NOW), "revoked");
  assert.equal(subscriptionState(row({ source: "comp", expiresAt: null, willRenew: false }), NOW), "active");
  assert.equal(subscriptionState(row({ source: "comp", expiresAt: at(-1) }), NOW), "expired");
});

test("the subscription object has the fields of the contract, dates as ISO strings", () => {
  assert.deepEqual(subscriptionJson(row({ isTrial: true }), NOW), {
    source: "app_store",
    productId: "forge.Forge.plus.annual",
    state: "trial",
    isTrial: true,
    willRenew: true,
    expiresAt: at(30).toISOString(),
    graceExpiresAt: null,
  });
});
