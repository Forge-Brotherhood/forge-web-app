import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { ackOutboxSchema, putBrief, putBriefSchema, putGrant, putGrantSchema, putStateSchema } from "./deviceApi";
import { FakeKms, MemoryStore } from "./fixtures/fakes";

const NOW = new Date("2026-11-23T15:00:00.000Z");
const state = { enabled: true, timezone: "America/New_York", quietStart: "21:30", quietEnd: "07:00", pushEnabled: false };

test("a grant wraps the key for the user, lasts 14 days, and a repeat renews and rotates", async () => {
  const store = new MemoryStore();
  const kms = new FakeKms();
  await store.putState("u1", state, NOW);

  const key = randomBytes(32);
  const first = await putGrant({ store, kms }, "u1", { key: key.toString("base64"), keyId: "k1" }, NOW);
  assert.deepEqual(first, { ok: true, expiresAt: "2026-12-07T15:00:00.000Z" });
  assert.deepEqual(kms.wrapCalls, ["u1"]);
  const stored = store.grants.get("u1")!;
  assert.ok(!JSON.stringify(stored).includes(key.toString("base64")), "the plain key is not stored");
  assert.deepEqual(await kms.unwrap("u1", stored.wrappedKey), key);
  await assert.rejects(kms.unwrap("u2", stored.wrappedKey), "bound to the user it was wrapped for");

  const later = new Date(NOW.getTime() + 3 * 86_400_000);
  const key2 = randomBytes(32);
  const second = await putGrant({ store, kms }, "u1", { key: key2.toString("base64"), keyId: "k2" }, later);
  assert.equal(second.ok && second.expiresAt, "2026-12-10T15:00:00.000Z");
  assert.equal(store.grants.get("u1")!.keyId, "k2");
  assert.deepEqual(await kms.unwrap("u1", store.grants.get("u1")!.wrappedKey), key2);
});

test("a grant needs the state first", async () => {
  const result = await putGrant({ store: new MemoryStore(), kms: new FakeKms() }, "u1", { key: randomBytes(32).toString("base64"), keyId: "k1" }, NOW);
  assert.deepEqual(result, { ok: false, reason: "state_required" });
});

test("the brief is stored only under the grant's key, and a future device time is clamped to now", async () => {
  const store = new MemoryStore();
  const body = { ciphertext: "AAAA", keyId: "k1", writtenAt: "2026-11-23T16:00:00.000Z" };
  assert.equal(await putBrief(store, "u1", body, NOW), "no_grant");
  await store.putState("u1", state, NOW);
  await store.putGrant("u1", { wrappedKey: "w", keyId: "k1", expiresAt: NOW });
  assert.equal(await putBrief(store, "u1", { ...body, keyId: "other" }, NOW), "key_mismatch");
  assert.equal(await putBrief(store, "u1", body, NOW), "ok");
  assert.equal(store.briefs.get("u1")!.deviceWrittenAt.toISOString(), NOW.toISOString());
});

test("revoking deletes the wrapped key, the brief and the outbox together, and only that user's", async () => {
  const store = new MemoryStore();
  for (const id of ["u1", "u2"]) {
    await store.putState(id, state, NOW);
    await store.putGrant(id, { wrappedKey: "w", keyId: "k", expiresAt: NOW });
    await store.putBrief(id, { ciphertext: "c", keyId: "k", deviceWrittenAt: NOW }, NOW);
    store.outbox.push({ id: `o-${id}`, userId: id, keyId: "k", ciphertext: "c", createdAt: NOW });
  }
  await store.deleteGrantData("u1");
  assert.ok(!store.grants.has("u1") && !store.briefs.has("u1") && !store.outbox.some((o) => o.userId === "u1"));
  assert.ok(store.grants.has("u2") && store.briefs.has("u2") && store.outbox.length === 1);
  assert.ok(store.states.has("u1"), "the state is metadata and stays; the device turns it off itself");
});

test("the outbox is read without deleting, and acknowledged ids are deleted for that user only", async () => {
  const store = new MemoryStore();
  store.outbox.push(
    { id: "a", userId: "u1", keyId: "k", ciphertext: "c", createdAt: NOW },
    { id: "b", userId: "u1", keyId: "k", ciphertext: "c", createdAt: NOW },
    { id: "c", userId: "u2", keyId: "k", ciphertext: "c", createdAt: NOW }
  );
  assert.equal((await store.listOutbox("u1", 50)).length, 2);
  assert.equal((await store.listOutbox("u1", 50)).length, 2);
  assert.equal(await store.ackOutbox("u1", ["a", "c"]), 1);
  assert.deepEqual((await store.listOutbox("u1", 50)).map((o) => o.id), ["b"]);
  assert.equal((await store.listOutbox("u2", 50)).length, 1);
});

test("request shapes are checked", () => {
  const key = randomBytes(32).toString("base64");
  assert.ok(putGrantSchema.safeParse({ key, keyId: "k-1_A" }).success);
  assert.ok(!putGrantSchema.safeParse({ key: randomBytes(16).toString("base64"), keyId: "k1" }).success);
  assert.ok(!putGrantSchema.safeParse({ key: "not base64!", keyId: "k1" }).success);
  assert.ok(!putGrantSchema.safeParse({ key, keyId: "has space" }).success);
  assert.ok(!putGrantSchema.safeParse({ key }).success);

  const brief = { ciphertext: "AAAA", keyId: "k1", writtenAt: "2026-11-23T15:00:00Z" };
  assert.ok(putBriefSchema.safeParse(brief).success);
  assert.ok(!putBriefSchema.safeParse({ ...brief, ciphertext: "A".repeat(200_001) }).success, "size cap");
  assert.ok(!putBriefSchema.safeParse({ ...brief, writtenAt: "yesterday" }).success);

  const s = { enabled: true, timezone: "Europe/London", quietHours: { start: "22:00", end: "07:00" }, pushEnabled: true };
  assert.ok(putStateSchema.safeParse(s).success);
  assert.ok(!putStateSchema.safeParse({ ...s, timezone: "Mars/Base" }).success);
  assert.ok(!putStateSchema.safeParse({ ...s, quietHours: { start: "25:00", end: "07:00" } }).success);

  assert.ok(ackOutboxSchema.safeParse({ ids: ["a"] }).success);
  assert.ok(!ackOutboxSchema.safeParse({ ids: [] }).success);
});
