import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { test } from "node:test";

import { BRIEF_COLLECTION, OUTBOX_COLLECTION, associatedData, open, openJson, seal, sealJson } from "./crypto";

const key = randomBytes(32);

test("the format is base64 of nonce (12) + ciphertext + tag (16), and it round trips", () => {
  const sealed = seal(key, "u1", BRIEF_COLLECTION, Buffer.from("hello"));
  const raw = Buffer.from(sealed, "base64");
  assert.equal(raw.length, 12 + 5 + 16);
  assert.equal(open(key, "u1", BRIEF_COLLECTION, sealed).toString(), "hello");
  assert.deepEqual(openJson(key, "u1", OUTBOX_COLLECTION, sealJson(key, "u1", OUTBOX_COLLECTION, { a: [1, "é"] })), { a: [1, "é"] });
  assert.notEqual(seal(key, "u1", BRIEF_COLLECTION, Buffer.from("hello")), sealed, "a fresh nonce each time");
});

test("the associated data is <collection>/<userId>, so a device can follow the spec exactly", () => {
  assert.equal(associatedData("u1", BRIEF_COLLECTION).toString(), "heartbeat_brief/u1");
  // What an independent implementation (the app) would produce, opened here.
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("heartbeat_outbox/u1", "utf8"));
  const body = Buffer.concat([cipher.update('{"v":1}'), cipher.final()]);
  const combined = Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64");
  assert.deepEqual(openJson(key, "u1", OUTBOX_COLLECTION, combined), { v: 1 });
});

test("it opens only for the same key, user and collection, and not if altered", () => {
  const sealed = seal(key, "u1", BRIEF_COLLECTION, Buffer.from("secret"));
  assert.throws(() => open(randomBytes(32), "u1", BRIEF_COLLECTION, sealed));
  assert.throws(() => open(key, "u2", BRIEF_COLLECTION, sealed));
  assert.throws(() => open(key, "u1", OUTBOX_COLLECTION, sealed));
  const raw = Buffer.from(sealed, "base64");
  raw[14] ^= 1;
  assert.throws(() => open(key, "u1", BRIEF_COLLECTION, raw.toString("base64")));
  assert.throws(() => open(key, "u1", BRIEF_COLLECTION, "AAAA"));
});
