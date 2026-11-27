// Runs offline: the mapping is pure, and a JWS that is not Apple's fails before any network check.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { JWSRenewalInfoDecodedPayload, JWSTransactionDecodedPayload } from "@apple/app-store-server-library";

import { acceptedEnvironments, isOlderThanStored, subscriptionFromApple, verifyTransaction } from "./apple";
import { hasPlus, subscriptionState } from "./entitlement";

const NOW = new Date("2026-12-01T12:00:00Z").getTime();
const DAY = 86_400_000;

const tx = (t: Partial<JWSTransactionDecodedPayload> = {}): JWSTransactionDecodedPayload => ({
  originalTransactionId: "2000000111111111",
  transactionId: "2000000111111111",
  bundleId: "forge.Forge",
  productId: "forge.Forge.plus.annual",
  purchaseDate: NOW - DAY,
  expiresDate: NOW + 13 * DAY,
  appAccountToken: "6f1c2a1e-0000-4000-8000-000000000001",
  environment: "Sandbox",
  ...t,
});

const renewal = (r: Partial<JWSRenewalInfoDecodedPayload> = {}): JWSRenewalInfoDecodedPayload => ({
  originalTransactionId: "2000000111111111",
  productId: "forge.Forge.plus.annual",
  autoRenewProductId: "forge.Forge.plus.annual",
  autoRenewStatus: 1,
  environment: "Sandbox",
  ...r,
});

/** The row a transaction makes, read back the way the Profile row reads it. */
const stateOf = (t: JWSTransactionDecodedPayload, r: JWSRenewalInfoDecodedPayload | null) => {
  const f = subscriptionFromApple(t, r);
  const row = { ...f, willRenew: f.willRenew ?? true, graceExpiresAt: f.graceExpiresAt ?? null };
  return { fields: f, plus: hasPlus(row, new Date(NOW)), state: subscriptionState(row, new Date(NOW)) };
};

test("trial start: the free introductory offer is a trial that renews", () => {
  const { fields, plus, state } = stateOf(tx({ offerType: 1, offerDiscountType: "FREE_TRIAL" }), renewal());
  assert.deepEqual(fields, {
    source: "app_store",
    productId: "forge.Forge.plus.annual",
    originalTransactionId: "2000000111111111",
    environment: "Sandbox",
    expiresAt: new Date(NOW + 13 * DAY),
    isTrial: true,
    revokedAt: null,
    willRenew: true,
    graceExpiresAt: null,
  });
  assert.deepEqual([plus, state], [true, "trial"]);
});

test("conversion to paid and a renewal: no offer, a later expiry, active", () => {
  const converted = stateOf(tx({ transactionId: "2000000222222222", purchaseDate: NOW, expiresDate: NOW + 365 * DAY }), renewal());
  assert.deepEqual([converted.fields.isTrial, converted.plus, converted.state], [false, true, "active"]);
  const renewed = stateOf(tx({ productId: "forge.Forge.plus.monthly", expiresDate: NOW + 30 * DAY }), renewal({ productId: "forge.Forge.plus.monthly" }));
  assert.deepEqual([renewed.fields.productId, renewed.state], ["forge.Forge.plus.monthly", "active"]);
});

test("auto-renew turned off: still Plus until expiry, cancelled", () => {
  const { fields, plus, state } = stateOf(tx(), renewal({ autoRenewStatus: 0 }));
  assert.deepEqual([fields.willRenew, plus, state], [false, true, "cancelled"]);
});

test("billing retry with grace: past expiry, Plus until the grace ends", () => {
  const { fields, plus, state } = stateOf(tx({ expiresDate: NOW - 2 * DAY }), renewal({ isInBillingRetryPeriod: true, gracePeriodExpiresDate: NOW + 14 * DAY }));
  assert.deepEqual([fields.graceExpiresAt, plus, state], [new Date(NOW + 14 * DAY), true, "grace"]);
});

test("grace expired, and plain expiry: Free", () => {
  const graceOver = stateOf(tx({ expiresDate: NOW - 20 * DAY }), renewal({ isInBillingRetryPeriod: true, gracePeriodExpiresDate: NOW - 4 * DAY }));
  assert.deepEqual([graceOver.plus, graceOver.state], [false, "expired"]);
  const expired = stateOf(tx({ expiresDate: NOW - DAY }), renewal({ autoRenewStatus: 0, expirationIntent: 1 }));
  assert.deepEqual([expired.plus, expired.state], [false, "expired"]);
});

test("refund or revocation: revoked at once, even before expiry; a reversed refund clears it", () => {
  const refunded = stateOf(tx({ revocationDate: NOW - 1000, revocationReason: 0 }), renewal({ autoRenewStatus: 0 }));
  assert.deepEqual([refunded.fields.revokedAt, refunded.plus, refunded.state], [new Date(NOW - 1000), false, "revoked"]);
  assert.equal(stateOf(tx(), renewal()).fields.revokedAt, null);
});

test("without renewal info (the app's sync), auto-renew and grace are left as they are", () => {
  const f = subscriptionFromApple(tx(), null);
  assert.equal(f.willRenew, undefined);
  assert.equal(f.graceExpiresAt, undefined);
});

test("an older transaction than the one stored is not applied", () => {
  const stored = { expiresAt: new Date(NOW + 30 * DAY) };
  assert.equal(isOlderThanStored(stored, subscriptionFromApple(tx({ expiresDate: NOW + 13 * DAY }), null)), true);
  assert.equal(isOlderThanStored(stored, subscriptionFromApple(tx({ expiresDate: NOW + 30 * DAY, revocationDate: NOW }), null)), false);
  assert.equal(isOlderThanStored(null, subscriptionFromApple(tx(), null)), false);
});

test("environments: production needs the app id; Xcode only when allowed and never on a production deploy", () => {
  assert.deepEqual(acceptedEnvironments({}), ["Sandbox"]);
  assert.deepEqual(acceptedEnvironments({ APP_STORE_APP_ID: "123" }), ["Production", "Sandbox"]);
  assert.deepEqual(acceptedEnvironments({ APP_STORE_ALLOW_XCODE: "true" }), ["Sandbox", "Xcode"]);
  assert.deepEqual(acceptedEnvironments({ APP_STORE_ALLOW_XCODE: "true", VERCEL_ENV: "production", APP_STORE_APP_ID: "123" }), ["Production", "Sandbox"]);
});

test("a transaction not signed by Apple does not verify", async () => {
  const fake = (payload: object) =>
    [{ alg: "ES256", x5c: ["a", "b", "c"] }, payload].map((p) => Buffer.from(JSON.stringify(p)).toString("base64url")).join(".") + ".sig";
  await assert.rejects(verifyTransaction(fake(tx())));
  await assert.rejects(verifyTransaction("not a jws"));
});
