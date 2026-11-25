// Runs against two local HTTP/2 servers standing in for Apple's production and sandbox hosts.
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { createServer, type Http2Server, type IncomingHttpHeaders } from "node:http2";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

import { sendPushWith, type ApnsConfig } from "./apns";

const prodKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const sandboxKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = (key: typeof prodKey) => key.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PROD_TOKEN = "aa".repeat(32);
const SANDBOX_TOKEN = "bb".repeat(32);
const GONE_TOKEN = "cc".repeat(32);
const NOWHERE_TOKEN = "dd".repeat(32);
const BROKEN_TOKEN = "ee".repeat(32);

type Seen = { headers: IncomingHttpHeaders; body: string };

/** A fake APNs host: answers each token from `replies`, anything else is a bad device token. */
async function fakeHost(replies: Record<string, { status: number; reason?: string }>) {
  const seen: Seen[] = [];
  const server: Http2Server = createServer();
  server.on("stream", (stream, headers) => {
    let body = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => (body += chunk));
    stream.on("end", () => {
      seen.push({ headers, body });
      const token = String(headers[":path"]).replace("/3/device/", "");
      const reply = replies[token] ?? { status: 400, reason: "BadDeviceToken" };
      stream.respond({ ":status": reply.status });
      stream.end(reply.reason ? JSON.stringify({ reason: reply.reason }) : "");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => server.close());
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

async function hosts() {
  const production = await fakeHost({
    [PROD_TOKEN]: { status: 200 },
    [GONE_TOKEN]: { status: 410, reason: "Unregistered" },
    [BROKEN_TOKEN]: { status: 500, reason: "InternalServerError" },
  });
  const sandbox = await fakeHost({ [SANDBOX_TOKEN]: { status: 200 } });
  const config: ApnsConfig = {
    teamId: "TEAM123456",
    bundleId: "forge.Forge",
    hosts: [
      { url: production.url, keyId: "PROD123456", privateKey: pem(prodKey) },
      { url: sandbox.url, keyId: "SAND123456", privateKey: pem(sandboxKey) },
    ],
  };
  return { production, sandbox, config };
}

/** The request carries a provider token for this key id, made by the team and signed with this key. */
function assertSignedBy(headers: IncomingHttpHeaders, keyId: string, key: typeof prodKey) {
  const jwt = String(headers.authorization).replace("bearer ", "");
  const [head, claims, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(head, "base64url").toString()), { alg: "ES256", kid: keyId });
  assert.equal(JSON.parse(Buffer.from(claims, "base64url").toString()).iss, "TEAM123456");
  assert.ok(verify("sha256", Buffer.from(`${head}.${claims}`), { key: key.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
}

const PAYLOAD = { title: "Lumen", body: "Lumen has something for you", data: { type: "heartbeat_push", v: "1", keyId: "k1", sealed: "c2VhbGVk" } };

test("a production token is sent once, with Apple's headers, a valid provider token and the data at the top level", async () => {
  const { production, sandbox, config } = await hosts();
  const result = await sendPushWith(config, [PROD_TOKEN], PAYLOAD);

  assert.deepEqual(result, { successCount: 1, failedTokens: [] });
  assert.equal(production.seen.length, 1);
  assert.equal(sandbox.seen.length, 0);

  const { headers, body } = production.seen[0];
  assert.equal(headers[":method"], "POST");
  assert.equal(headers[":path"], `/3/device/${PROD_TOKEN}`);
  assert.equal(headers["apns-topic"], "forge.Forge");
  assert.equal(headers["apns-push-type"], "alert");
  assert.equal(headers["apns-priority"], "10");

  assertSignedBy(headers, "PROD123456", prodKey);

  assert.deepEqual(JSON.parse(body), {
    type: "heartbeat_push",
    v: "1",
    keyId: "k1",
    sealed: "c2VhbGVk",
    aps: { alert: { title: "Lumen", body: "Lumen has something for you" }, sound: "default", badge: 1, "mutable-content": 1 },
  });
});

test("an expiry and a collapse id go as Apple's headers, never in the body; without them neither header is sent", async () => {
  const { production, config } = await hosts();
  await sendPushWith(config, [PROD_TOKEN], PAYLOAD);
  await sendPushWith(config, [PROD_TOKEN], { ...PAYLOAD, expiresAt: new Date("2026-11-26T12:20:00.900Z"), collapseId: "headsup-2026-11-26" });

  const [plain, headsUp] = production.seen;
  assert.equal(plain.headers["apns-expiration"], undefined);
  assert.equal(plain.headers["apns-collapse-id"], undefined);
  assert.equal(headsUp.headers["apns-expiration"], String(Date.parse("2026-11-26T12:20:00Z") / 1000));
  assert.equal(headsUp.headers["apns-collapse-id"], "headsup-2026-11-26");
  assert.equal(headsUp.body, plain.body);
});

test("a sandbox token production refuses is delivered through the sandbox, signed with the sandbox key", async () => {
  const { production, sandbox, config } = await hosts();
  const result = await sendPushWith(config, [SANDBOX_TOKEN, PROD_TOKEN], PAYLOAD);

  assert.deepEqual(result, { successCount: 2, failedTokens: [] });
  assert.equal(production.seen.length, 2);
  assert.deepEqual(sandbox.seen.map((s) => s.headers[":path"]), [`/3/device/${SANDBOX_TOKEN}`]);
  assertSignedBy(sandbox.seen[0].headers, "SAND123456", sandboxKey);
});

test("gone tokens, tokens bad on every host and non-APNs tokens are reported; a server error is not", async () => {
  const { production, sandbox, config } = await hosts();
  const fcmToken = "fGx1:APA91bH_example-fcm-token";
  const result = await sendPushWith(config, [GONE_TOKEN, NOWHERE_TOKEN, fcmToken, BROKEN_TOKEN], PAYLOAD);

  assert.equal(result.successCount, 0);
  assert.deepEqual(result.failedTokens.sort(), [GONE_TOKEN, NOWHERE_TOKEN, fcmToken].sort());
  assert.ok(!production.seen.some((s) => String(s.headers[":path"]).includes("APA91")), "a non-APNs token is never sent");
  assert.deepEqual(sandbox.seen.map((s) => s.headers[":path"]), [`/3/device/${NOWHERE_TOKEN}`]);
});

test("an unreachable host sends nothing and does not throw", async () => {
  const { config } = await hosts();
  const result = await sendPushWith({ ...config, hosts: [{ ...config.hosts[0], url: "http://127.0.0.1:1" }] }, [PROD_TOKEN], PAYLOAD);
  assert.deepEqual(result, { successCount: 0, failedTokens: [] });
});
