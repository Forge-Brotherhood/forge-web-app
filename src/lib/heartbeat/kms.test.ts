import assert from "node:assert/strict";
import { DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { createAwsBriefKeyVault, type KmsSender } from "./kms";

/** Stands in for AWS: records the commands, and wraps by reversing the bytes. No network. */
function fakeAws() {
  const sent: Array<EncryptCommand | DecryptCommand> = [];
  const plaintexts: Uint8Array[] = [];
  const client: KmsSender = {
    async send(command) {
      sent.push(command);
      if (command instanceof EncryptCommand) return { CiphertextBlob: Buffer.from(command.input.Plaintext as Uint8Array).reverse() };
      const plaintext = new Uint8Array(Buffer.from(command.input.CiphertextBlob as Uint8Array).reverse());
      plaintexts.push(plaintext);
      return { Plaintext: plaintext };
    },
  };
  return { client, sent, plaintexts };
}

test("wrap and unwrap round trip, and both carry the key id and the user as encryption context", async () => {
  const { client, sent } = fakeAws();
  const vault = createAwsBriefKeyVault({ keyId: "alias/heartbeat", client });
  const key = randomBytes(32);

  const wrapped = await vault.wrap("user-1", key);
  assert.notEqual(wrapped, key.toString("base64"));
  const back = await vault.unwrap("user-1", wrapped);
  assert.deepEqual(back, key);

  assert.equal(sent.length, 2);
  for (const command of sent) {
    assert.equal(command.input.KeyId, "alias/heartbeat");
    assert.deepEqual(command.input.EncryptionContext, { userId: "user-1" });
  }
  assert.ok(sent[0] instanceof EncryptCommand && sent[1] instanceof DecryptCommand);
});

test("the plain key AWS hands back is zeroed once copied", async () => {
  const { client, plaintexts } = fakeAws();
  const vault = createAwsBriefKeyVault({ keyId: "k", client });
  const key = randomBytes(32);
  const back = await vault.unwrap("u", await vault.wrap("u", key));
  assert.deepEqual(back, key);
  assert.ok(plaintexts.every((p) => p.every((b) => b === 0)));
});

test("a key of the wrong size is refused both ways", async () => {
  const vault = createAwsBriefKeyVault({ keyId: "k", client: fakeAws().client });
  await assert.rejects(vault.wrap("u", randomBytes(16)));
  const short = createAwsBriefKeyVault({ keyId: "k", client: { send: async () => ({ Plaintext: new Uint8Array(16).fill(7) }) } });
  await assert.rejects(short.unwrap("u", "AAAA"));
});

test("an AWS failure rejects without the key in the message", async () => {
  const vault = createAwsBriefKeyVault({ keyId: "k", client: { send: async () => { throw new Error("AccessDenied"); } } });
  await assert.rejects(vault.unwrap("u", "AAAA"), /AccessDenied/);
  await assert.rejects(createAwsBriefKeyVault({ keyId: "k", client: { send: async () => ({}) } }).unwrap("u", "AAAA"), /no plaintext/);
});
