// Runs without a database, AWS, Firebase or network: an in-memory store, a fake KMS, a scripted model and a fake sender.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { apnsBody, type PushPayload, type PushResult } from "@/lib/apns";
import { BRIEF_COLLECTION, OUTBOX_COLLECTION, PUSH_COLLECTION, open, openJson, sealJson } from "./crypto";
import { FIXTURE_NOW, fixture } from "./fixtures";
import { FakeKms, MemoryStore, seedUser } from "./fixtures/fakes";
import { MAX_SEALED_PLAINTEXT_BYTES, PUSH_TYPE, buildHeartbeatPush, fitTarget, type SealedTarget } from "./push";
import type { Brief } from "./schemas";
import { runHeartbeat, type LogEvent, type RunDeps } from "./serverRun";
import { NEUTRAL_NOTIFICATION_TEXT, NEUTRAL_NOTIFICATION_TITLE } from "./terms";

const NOW = FIXTURE_NOW;
const brief = (): Brief => structuredClone(fixture("finish-due").brief);
const TEXT = "A reading is ready for you";

const SCRIPT = {
  posts: [{ goalId: "g-bible", reason: "due", type: "reading", payload: { ref: "NUM:14" }, message: "Today's is Numbers 14.", notify: { text: TEXT } }],
  plan: [{ action: "create", goalId: "g-bible", type: "reading", date: "2026-11-24" }],
  workingNotes: [{ goalId: "g-bible", notes: "Offered Numbers 14. Keep the readings short." }],
};

type Sent = { tokens: string[]; payload: PushPayload };

function setup(options: { tokens?: string[]; result?: (tokens: string[]) => PushResult | Promise<PushResult>; script?: object; deps?: Partial<RunDeps> } = {}) {
  const store = new MemoryStore();
  const kms = new FakeKms();
  const logs: LogEvent[] = [];
  const sent: Sent[] = [];
  const cleaned: string[][] = [];
  const tokens = options.tokens ?? ["tok-a", "tok-b"];
  const deps: RunDeps = {
    store,
    getKms: () => kms,
    callModel: async () => options.script ?? SCRIPT,
    allowModel: async () => true,
    log: (event) => logs.push(event),
    now: () => NOW,
    enabled: true,
    push: {
      tokensFor: async () => tokens,
      send: async (t, payload) => {
        sent.push({ tokens: t, payload });
        return options.result ? options.result(t) : { successCount: t.length, failedTokens: [] };
      },
      cleanup: async (t) => void cleaned.push(t),
    },
    ...options.deps,
  };
  return { store, kms, logs, sent, cleaned, deps };
}

const seed = (s: ReturnType<typeof setup>, b: Brief = brief(), extra: { pushEnabled?: boolean } = { pushEnabled: true }) =>
  seedUser(s.store, s.kms, { userId: "u1", brief: b, now: NOW, ...extra });

test("the visible text is always the fixed neutral one, and the real text opens only with the right key, user and collection", async () => {
  const s = setup();
  const { key, keyId } = await seed(s);
  await runHeartbeat(s.deps);

  assert.equal(s.sent.length, 1, "one push");
  assert.deepEqual(s.sent[0].tokens, ["tok-a", "tok-b"]);
  const { payload } = s.sent[0];
  assert.equal(payload.title, NEUTRAL_NOTIFICATION_TITLE);
  assert.equal(payload.body, NEUTRAL_NOTIFICATION_TEXT);
  assert.equal(payload.body, "Lumen has something for you");
  assert.equal(payload.imageUrl, undefined);
  assert.deepEqual(Object.keys(payload.data!).sort(), ["keyId", "sealed", "type", "v"]);
  assert.equal(payload.data!.type, PUSH_TYPE);
  assert.equal(payload.data!.v, "1");
  assert.equal(payload.data!.keyId, keyId);

  // Round trip with the documented binding: AES-GCM, base64(nonce || ct || tag), AAD "heartbeat_push/<userId>".
  const sealed = payload.data!.sealed;
  assert.deepEqual(openJson(key, "u1", PUSH_COLLECTION, sealed), { goalId: "g-bible", activityId: "g-bible:reading:2026-11-23", text: TEXT });
  const raw = Buffer.from(sealed, "base64");
  assert.ok(raw.length > 12 + 16);
  assert.equal(open(key, "u1", PUSH_COLLECTION, sealed).toString("utf8").length, raw.length - 28, "no padding or framing beyond nonce and tag");

  assert.throws(() => openJson(randomBytes(32), "u1", PUSH_COLLECTION, sealed), "another key");
  assert.throws(() => openJson(key, "u2", PUSH_COLLECTION, sealed), "another user");
  assert.throws(() => openJson(key, "u1", OUTBOX_COLLECTION, sealed), "another collection");
  assert.throws(() => openJson(key, "u1", BRIEF_COLLECTION, sealed), "another collection");

  // Nothing readable in what Apple and Google see: no text, goal title, goal id or activity id outside the sealed field.
  const visible = JSON.stringify({ ...payload, data: { ...payload.data, sealed: undefined } });
  for (const secret of [TEXT, "Read the Bible", "g-bible", "Numbers", "reading"]) assert.ok(!visible.includes(secret), `${secret} must not be readable`);
  const inTransit = Buffer.from(sealed, "base64").toString("latin1");
  assert.ok(!inTransit.includes("g-bible") && !inTransit.includes(TEXT), "and the sealed field is not readable either");
});

test("a discreet goal carries no text: the device keeps the neutral one", async () => {
  const b = brief();
  b.goals[0].discreet = true;
  const s = setup();
  const { key } = await seed(s, b);
  await runHeartbeat(s.deps);

  assert.equal(s.sent.length, 1);
  const target: any = openJson(key, "u1", PUSH_COLLECTION, s.sent[0].payload.data!.sealed);
  assert.equal(target.text, undefined);
  assert.equal(target.goalId, "g-bible");
  assert.ok(!JSON.stringify(s.sent[0].payload).includes("Read the Bible"));
  assert.equal(s.sent[0].payload.body, NEUTRAL_NOTIFICATION_TEXT);
});

test("buildHeartbeatPush decides discreet from the brief, not from the text it is handed", () => {
  const key = randomBytes(32);
  const output = { posts: [{ id: "p", goalId: "g-bible", message: "m", reason: "due" as const, notify: { at: NOW.toISOString(), text: "SECRET words about a struggle" } }] };
  const plain = brief();
  const grow = brief();
  grow.goals[0].shape = "grow"; // Grow is discreet when `discreet` is unset
  const explicit = brief();
  explicit.goals[0].discreet = true;
  const shown = brief();
  shown.goals[0].shape = "grow";
  shown.goals[0].discreet = false;

  const open_ = (b: Brief) => openJson(key, "u1", PUSH_COLLECTION, buildHeartbeatPush({ key, userId: "u1", keyId: "k1", brief: b, output })!.data!.sealed) as SealedTarget;
  assert.equal(open_(plain).text, "SECRET words about a struggle");
  assert.equal(open_(grow).text, undefined);
  assert.equal(open_(explicit).text, undefined);
  assert.equal(open_(shown).text, "SECRET words about a struggle");
  // The neutral line the rules put in is never sealed as if it were real text.
  const neutral = { posts: [{ ...output.posts[0], notify: { at: NOW.toISOString(), text: NEUTRAL_NOTIFICATION_TEXT } }] };
  assert.equal((openJson(key, "u1", PUSH_COLLECTION, buildHeartbeatPush({ key, userId: "u1", keyId: "k1", brief: plain, output: neutral })!.data!.sealed) as SealedTarget).text, undefined);
  // Nothing to send without a notify, or for a goal the brief does not hold.
  assert.equal(buildHeartbeatPush({ key, userId: "u1", keyId: "k1", brief: plain, output: { posts: [{ ...output.posts[0], notify: undefined }] } }), null);
  assert.equal(buildHeartbeatPush({ key, userId: "u1", keyId: "k1", brief: plain, output: { posts: [{ ...output.posts[0], goalId: "nope" }] } }), null);
});

test("size cap: the text is cut on a character boundary with an ellipsis, and the whole payload stays far under 4 KB", () => {
  const huge = "\u{1F64F}".repeat(2000); // 4 bytes each, a surrogate pair in UTF-16
  const fitted = fitTarget({ goalId: "g".repeat(128), activityId: "a".repeat(160), text: huge });
  assert.ok(Buffer.byteLength(JSON.stringify(fitted), "utf8") <= MAX_SEALED_PLAINTEXT_BYTES);
  assert.ok(fitted.text!.endsWith("…"));
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(fitted.text!), "no split surrogate pair");
  assert.deepEqual(fitTarget({ goalId: "g", text: "short" }), { goalId: "g", text: "short" }, "short text is untouched");

  const key = randomBytes(32);
  const output = { posts: [{ id: "p", goalId: "g-bible", activityId: "a".repeat(160), message: "m", reason: "due" as const, notify: { at: NOW.toISOString(), text: huge } }] };
  const payload = buildHeartbeatPush({ key, userId: "u1", keyId: "k".repeat(64), brief: brief(), output })!;
  // The exact body APNs receives.
  const whole = Buffer.byteLength(apnsBody(payload), "utf8");
  assert.ok(whole < 3000, `payload is ${whole} bytes`);
  assert.ok(whole <= 4096);
});

test("tokens APNs reports invalid are cleaned up", async () => {
  const s = setup({ tokens: ["good", "dead-1", "dead-2"], result: () => ({ successCount: 1, failedTokens: ["dead-1", "dead-2"] }) });
  await seed(s);
  await runHeartbeat(s.deps);
  assert.deepEqual(s.cleaned, [["dead-1", "dead-2"]]);
  assert.equal(s.store.runs[0].pushed, 1);

  const none = setup({ result: () => ({ successCount: 2, failedTokens: [] }) });
  await seed(none);
  await runHeartbeat(none.deps);
  assert.deepEqual(none.cleaned, [], "cleanup is not called when nothing failed");
});

test("a push failure never fails the run or loses the outbox item", async () => {
  for (const failure of ["throws", "zero", "cleanup throws"] as const) {
    const s = setup({
      tokens: ["a"],
      result: () => {
        if (failure === "throws") throw new Error("SECRETMARK network down");
        return failure === "zero" ? { successCount: 0, failedTokens: [] } : { successCount: 1, failedTokens: ["a"] };
      },
    });
    s.deps.push!.cleanup = async () => {
      if (failure === "cleanup throws") throw new Error("SECRETMARK db down");
    };
    const { key } = await seed(s);
    const summary = await runHeartbeat(s.deps);

    assert.deepEqual(summary.outcomes, { ok: 1 }, failure);
    assert.equal(s.store.outbox.length, 1, `${failure}: the outbox item is stored`);
    const item: any = openJson(key, "u1", OUTBOX_COLLECTION, s.store.outbox[0].ciphertext);
    assert.equal(item.posts[0].message, "Today's is Numbers 14.");
    assert.equal(s.store.briefs.get("u1")!.revision, 2, "the brief is updated");
    assert.equal(s.store.runs[0].outcome, "ok");
    assert.equal(s.store.runs[0].pushed, failure === "cleanup throws" ? 1 : 0);
    assert.ok(!JSON.stringify(s.logs).includes("SECRETMARK"), "an error message is never logged");
    assert.ok(s.kms.unwrapped.every((k) => k.every((b) => b === 0)), "the key is still zeroed");
  }

  // A sender that never answers is a code in the log, not a crash.
  const s = setup();
  s.deps.push!.tokensFor = async () => {
    throw new Error("db down");
  };
  await seed(s);
  assert.deepEqual((await runHeartbeat(s.deps)).outcomes, { ok: 1 });
  assert.equal(s.logs.find((l) => l.tag === "heartbeat.run")!.push, "error");
});

test("no plaintext in any log line, run row or stored value; only counts and codes", async () => {
  const b = brief();
  b.goals[0].workingNotes = "SECRETMARK private note";
  const s = setup();
  const { key } = await seed(s, b);
  await runHeartbeat(s.deps);

  const everything = JSON.stringify({ logs: s.logs, runs: s.store.runs });
  for (const secret of [TEXT, "Numbers", "SECRETMARK", "Read the Bible", "Sam", "g-bible", "tok-a", key.toString("base64"), key.toString("hex"), s.sent[0].payload.data!.sealed]) {
    assert.ok(!everything.includes(secret), `${secret} must not be logged or recorded`);
  }
  const line = s.logs.find((l) => l.tag === "heartbeat.run")!;
  assert.equal(line.pushed, 1);
  assert.equal(line.push, "sent");
  assert.deepEqual({ ...s.store.runs[0], durationMs: 0 }, {
    userId: "u1", trigger: "heartbeat", outcome: "ok", staleness: "fresh", modelCalled: true, posts: 1, activities: 2, dropped: 0, pushed: 1, durationMs: 0,
  });
  for (const stored of [s.store.briefs.get("u1")!.ciphertext, s.store.outbox[0].ciphertext]) {
    assert.ok(!Buffer.from(stored, "base64").toString("latin1").includes(TEXT));
  }
});

test("no push when pushEnabled is off, there are no tokens, the switch is off, or the beat had nothing to notify", async () => {
  const off = setup();
  await seed(off, brief(), { pushEnabled: false });
  await runHeartbeat(off.deps);
  assert.equal(off.sent.length, 0);
  assert.equal(off.store.outbox.length, 1, "the post still goes to the outbox");
  assert.equal(off.logs.find((l) => l.tag === "heartbeat.run")!.push, "off");

  const noTokens = setup({ tokens: [] });
  await seed(noTokens);
  await runHeartbeat(noTokens.deps);
  assert.equal(noTokens.sent.length, 0);
  assert.equal(noTokens.logs.find((l) => l.tag === "heartbeat.run")!.push, "no_tokens");
  assert.equal(noTokens.store.runs[0].pushed, 0);

  const killed = setup({ deps: { enabled: false } });
  await seed(killed);
  await runHeartbeat(killed.deps);
  assert.equal(killed.sent.length + killed.kms.unwrapCalls.length, 0);

  const noDeps = setup({ deps: { push: undefined } });
  await seed(noDeps);
  await runHeartbeat(noDeps.deps);
  assert.equal(noDeps.store.outbox.length, 1);

  // A post with no notify: nothing earned a push, and the token list is not even read.
  const quiet = setup({ script: { ...SCRIPT, posts: [{ ...SCRIPT.posts[0], notify: undefined }] } });
  let tokenReads = 0;
  quiet.deps.push!.tokensFor = async () => (tokenReads++, ["t"]);
  await seed(quiet);
  await runHeartbeat(quiet.deps);
  assert.equal(quiet.sent.length + tokenReads, 0);
  assert.equal(quiet.store.outbox.length, 1);

  // A beat that decided nothing at all.
  const nothing = setup({ script: {} });
  await seed(nothing, fixture("nothing-due").brief);
  await runHeartbeat(nothing.deps);
  assert.equal(nothing.sent.length, 0);
  assert.equal(nothing.store.outbox.length, 0);
});

test("no push for a lapsed grant, a grant revoked or rotated during the run, or a notification the rules dropped", async () => {
  const lapsed = setup();
  await seed(lapsed);
  lapsed.store.grants.get("u1")!.expiresAt = new Date(NOW.getTime() - 1000);
  await runHeartbeat(lapsed.deps);
  assert.equal(lapsed.sent.length, 0);

  const revoked = setup();
  await seed(revoked);
  revoked.deps.callModel = async () => {
    await revoked.store.deleteGrantData("u1");
    return SCRIPT;
  };
  await runHeartbeat(revoked.deps);
  assert.equal(revoked.sent.length, 0);

  const rotated = setup();
  await seed(rotated);
  rotated.deps.callModel = async () => {
    rotated.store.grants.set("u1", { ...rotated.store.grants.get("u1")!, keyId: "k2" }); // a new object, as a real renewal would be
    return SCRIPT;
  };
  await runHeartbeat(rotated.deps);
  assert.equal(rotated.sent.length, 0);

  // One notification a day: a notification already sent today means the rules drop this one, so nothing is pushed.
  const spent = brief();
  spent.outreach = { recent: [{ at: new Date(NOW.getTime() - 3_600_000).toISOString(), goalId: "g-bible", text: "x", opened: null }] };
  const budget = setup();
  await seed(budget, spent);
  await runHeartbeat(budget.deps);
  assert.equal(budget.sent.length, 0);
  assert.equal(budget.store.outbox.length, 1, "the post itself still arrives");
});

test("a post inside quiet hours keeps its place in the thread but earns no push", async () => {
  const s = setup();
  const b = brief();
  b.person.quietHours = { start: "09:00", end: "11:00" }; // 10:00 local at the fixture's clock
  await seed(s, b);
  s.store.states.get("u1")!.quietStart = "00:00";
  s.store.states.get("u1")!.quietEnd = "00:00"; // the server's own gate would defer the user, so test the beat's gate alone
  await runHeartbeat(s.deps);
  assert.equal(s.sent.length, 0);
  assert.equal(s.store.outbox.length, 1, "the post is there");
});

test("sealJson stays the one way in: the push uses the brief key and nothing else", async () => {
  const s = setup();
  const { key } = await seed(s);
  await runHeartbeat(s.deps);
  assert.ok(s.kms.unwrapCalls.every((u) => u === "u1"));
  assert.ok(openJson(key, "u1", PUSH_COLLECTION, s.sent[0].payload.data!.sealed));
  assert.throws(() => openJson(key, "u1", PUSH_COLLECTION, sealJson(key, "u1", OUTBOX_COLLECTION, { goalId: "x" })), "sealed for another collection does not open as a push");
});
