// Needs a database: run with DATABASE_URL pointing at a scratch database that has the schema.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { prisma } from "@/lib/prisma";
import { deleteRecords, getKeyCheck, listRecords, putRecords, registerKeyCheck, wipeVault } from "./vaultStore";

const users = { a: "", b: "" };

before(async () => {
  for (const name of ["a", "b"] as const) {
    const tag = `vault-test-${name}-${crypto.randomUUID()}`;
    const user = await prisma.user.create({ data: { clerkId: tag, email: `${tag}@example.test` } });
    users[name] = user.id;
  }
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [users.a, users.b] } } });
});

const list = (userId: string, query: { collection: string; id?: string; indexToken?: string }) =>
  listRecords(userId, { limit: 200, offset: 0, ...query });

test("an account's first key check is kept; a different one is refused", async () => {
  assert.equal(await getKeyCheck(users.a), null);
  assert.deepEqual(await registerKeyCheck(users.a, "a".repeat(32)), { registered: true, keyCheck: "a".repeat(32) });
  assert.deepEqual(await registerKeyCheck(users.a, "a".repeat(32)), { registered: true, keyCheck: "a".repeat(32) });
  assert.deepEqual(await registerKeyCheck(users.a, "b".repeat(32)), { registered: false, keyCheck: "a".repeat(32) });
  assert.equal(await getKeyCheck(users.a), "a".repeat(32));
});

test("records are stored as given, replaced by collection and id, and found by index token", async () => {
  await putRecords(users.a, {
    records: [
      { collection: "note", id: "n1", ciphertext: "c1", indexToken: "chapter-x" },
      { collection: "note", id: "n2", ciphertext: "c2", indexToken: "chapter-y" },
      { collection: "highlight", id: "n1", ciphertext: "h1" },
    ],
  });
  await putRecords(users.a, { records: [{ collection: "note", id: "n1", ciphertext: "c1-new", indexToken: "chapter-x" }] });

  const notes = await list(users.a, { collection: "note" });
  assert.deepEqual(notes.map((r) => [r.id, r.ciphertext, r.indexToken]).sort(), [
    ["n1", "c1-new", "chapter-x"],
    ["n2", "c2", "chapter-y"],
  ]);
  assert.equal(notes[0].id, "n1", "most recently updated comes first");
  assert.deepEqual((await list(users.a, { collection: "note", indexToken: "chapter-y" })).map((r) => r.id), ["n2"]);
  assert.deepEqual((await list(users.a, { collection: "note", id: "n2" })).map((r) => r.ciphertext), ["c2"]);
  assert.deepEqual((await list(users.a, { collection: "highlight" })).map((r) => r.ciphertext), ["h1"]);
});

test("one account never sees or changes another's records", async () => {
  await putRecords(users.b, { records: [{ collection: "note", id: "n1", ciphertext: "b-secret" }] });

  assert.deepEqual((await list(users.b, { collection: "note" })).map((r) => r.ciphertext), ["b-secret"]);
  assert.ok(!(await list(users.a, { collection: "note" })).some((r) => r.ciphertext === "b-secret"));

  assert.equal(await deleteRecords(users.a, { collection: "note", ids: ["n1"] }), 1);
  assert.deepEqual((await list(users.b, { collection: "note" })).map((r) => r.ciphertext), ["b-secret"]);
});

test("deleting without ids clears the collection; wiping removes everything and the key", async () => {
  assert.equal(await deleteRecords(users.a, { collection: "note" }), 1);
  assert.deepEqual(await list(users.a, { collection: "note" }), []);
  assert.equal((await list(users.a, { collection: "highlight" })).length, 1);

  await wipeVault(users.a);
  assert.deepEqual(await list(users.a, { collection: "highlight" }), []);
  assert.equal(await getKeyCheck(users.a), null);
  assert.equal((await list(users.b, { collection: "note" })).length, 1, "another account is untouched");
});
