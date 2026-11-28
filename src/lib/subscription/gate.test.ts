// Runs without a database, the network or an API key: the stores and the gate's model are in memory.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AllowanceRow, AllowanceStore } from "./allowance";
import type { SubscriptionRow } from "./entitlement";
import { checkChatGate, type GateDeps, type GateRequest } from "./gate";
import { HARD_MOMENT_INSTRUCTIONS, isHardMoment, type GateCheckModel } from "./hardMoment";

const NOW = new Date("2026-12-01T12:00:00Z");
const OLD_ACCOUNT = new Date("2026-10-01T12:00:00Z");

function setup(opts: { used?: number; subscription?: SubscriptionRow | null; model?: GateCheckModel; enforced?: boolean } = {}) {
  const rows = new Map<string, AllowanceRow>();
  if (opts.used !== undefined) {
    rows.set("u1", { windowStart: new Date(NOW.getTime() - 86_400_000), used: opts.used, firstDayUsed: 0, gateHits: 0, lastGateAt: null });
  }
  const allowance: AllowanceStore = {
    load: async (userId) => ({ row: rows.get(userId) ?? null, accountCreatedAt: OLD_ACCOUNT }),
    save: async (userId, _prev, next) => (rows.set(userId, next), true),
  };
  const modelCalls: Array<{ message: string; instructions: string }> = [];
  const deps: GateDeps = {
    enforced: opts.enforced ?? true,
    loadSubscription: async () => opts.subscription ?? null,
    allowance,
    checkModel: async (input) => {
      modelCalls.push(input);
      return opts.model ? opts.model(input) : { hardMoment: false };
    },
    now: NOW,
  };
  return { rows, deps, modelCalls };
}

const req = (r: Partial<GateRequest> = {}): GateRequest => ({ userId: "u1", message: "Why did Lazarus die?", isContinuation: false, isGreeting: false, ...r });

test("while the paywall is off, nothing is looked up or counted", async () => {
  const { rows, deps } = setup({ enforced: false, used: 20 });
  deps.loadSubscription = async () => assert.fail("no lookup");
  assert.equal(await checkChatGate(req(), deps), null);
  assert.equal(rows.get("u1")?.used, 20);
});

test("Plus is never counted; a continuation is never counted", async () => {
  const plus: SubscriptionRow = { source: "comp", productId: "comp", isTrial: false, willRenew: false, expiresAt: null, graceExpiresAt: null, revokedAt: null };
  const a = setup({ used: 20, subscription: plus });
  assert.equal(await checkChatGate(req(), a.deps), null);
  const b = setup({ used: 3 });
  assert.equal(await checkChatGate(req({ isContinuation: true }), b.deps), null);
  assert.equal(b.rows.get("u1")?.used, 3);
});

test("a free reply is counted; Lumen's own goal openings are not; Explain is", async () => {
  const { rows, deps } = setup({ used: 3 });
  assert.equal(await checkChatGate(req(), deps), null);
  assert.equal(rows.get("u1")?.used, 4);
  assert.equal(await checkChatGate(req({ message: "GOAL_THREAD_START" }), deps), null);
  assert.equal(await checkChatGate(req({ message: "GOAL_SETUP_START" }), deps), null);
  assert.equal(rows.get("u1")?.used, 4);
  assert.equal(await checkChatGate(req({ message: "BIBLE_CHAT_START", isGreeting: true, selectionState: "selected" }), deps), null);
  assert.equal(rows.get("u1")?.used, 5);
});

test("the reader's greeting nobody asked for is Plus only, and not counted", async () => {
  const { rows, deps } = setup({ used: 3 });
  assert.deepEqual(await checkChatGate(req({ message: "BIBLE_CHAT_START", isGreeting: true, selectionState: "visible" }), deps), {
    status: 402,
    body: { error: "plus_only" },
  });
  assert.equal(rows.get("u1")?.used, 3);
});

test("with the week used, an ordinary message is refused with the allowance, and the gate hit is recorded", async () => {
  const { rows, deps, modelCalls } = setup({ used: 20 });
  const result = await checkChatGate(req(), deps);
  assert.deepEqual(result, {
    status: 402,
    body: { error: "allowance_used", allowance: { limit: 20, used: 20, remaining: 0, resetsAt: new Date(NOW.getTime() + 6 * 86_400_000).toISOString() } },
  });
  assert.deepEqual(modelCalls, [{ instructions: HARD_MOMENT_INSTRUCTIONS, message: "Why did Lazarus die?", userId: "u1" }]);
  assert.deepEqual([rows.get("u1")?.used, rows.get("u1")?.gateHits, rows.get("u1")?.lastGateAt?.getTime()], [20, 1, NOW.getTime()]);
});

test("with the week used, a hard moment goes through uncounted and leaves no gate hit", async () => {
  const { rows, deps } = setup({ used: 20, model: async () => ({ hardMoment: true }) });
  assert.equal(await checkChatGate(req({ message: "My mum died this morning." }), deps), null);
  assert.deepEqual([rows.get("u1")?.used, rows.get("u1")?.gateHits], [20, 0]);
});

test("if the hard-moment check fails, the reply goes through uncounted", async () => {
  const failing = setup({ used: 20, model: async () => Promise.reject(new Error("OpenAI API error: 500")) });
  assert.equal(await checkChatGate(req(), failing.deps), null);
  assert.deepEqual([failing.rows.get("u1")?.used, failing.rows.get("u1")?.gateHits], [20, 0]);

  const odd = setup({ used: 20, model: async () => ({ answer: "no" }) });
  assert.equal(await checkChatGate(req(), odd.deps), null);
});

test("the check is asked once per message and reads only its boolean", async () => {
  assert.equal(await isHardMoment("x", "u1", async () => ({ hardMoment: false })), false);
  assert.equal(await isHardMoment("x", "u1", async () => ({ hardMoment: true })), true);
  assert.equal(await isHardMoment("x", "u1", async () => ({ hardMoment: "yes" })), true, "an unexpected answer errs toward answering");
});

test("with the week used, Explain and a reflection start are refused without asking the model: they carry a marker, not the person's words", async () => {
  const explain = setup({ used: 20, model: async () => ({ hardMoment: true }) });
  assert.equal((await checkChatGate(req({ message: "BIBLE_CHAT_START", isGreeting: true, selectionState: "selected" }), explain.deps))?.status, 402);
  const reflect = setup({ used: 20, model: async () => ({ hardMoment: true }) });
  assert.equal((await checkChatGate(req({ message: "GOAL_THREAD_REFLECT" }), reflect.deps))?.status, 402);
  assert.equal(explain.modelCalls.length + reflect.modelCalls.length, 0);
});
