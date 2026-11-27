import { GOAL_SETUP_START_MESSAGE, GOAL_THREAD_REFLECT_MESSAGE, GOAL_THREAD_START_MESSAGE } from "@/lib/chat/chatContextBundle";
import { appNow } from "@/lib/devClock";
import { takeChatReply, type AllowanceJson, type AllowanceStore } from "@/lib/subscription/allowance";
import { hasPlus, paywallEnforced, type SubscriptionRow } from "@/lib/subscription/entitlement";
import { isHardMoment, type GateCheckModel } from "@/lib/subscription/hardMoment";
import { loadSubscription, prismaAllowanceStore } from "@/lib/subscription/store";

/**
 * The gate on Lumen's replies for free accounts (pricing-plan.md §5.3, §14), run before any model
 * call or stream. Ids and counts are logged, never the message.
 */

export type GateDeps = {
  enforced: boolean;
  loadSubscription: (userId: string) => Promise<SubscriptionRow | null>;
  allowance: AllowanceStore;
  checkModel?: GateCheckModel;
  now: Date;
};

export type GateResult = { status: 402; body: { error: "allowance_used"; allowance: AllowanceJson } | { error: "plus_only" } } | null;

export type GateRequest = {
  userId: string;
  message: string;
  isContinuation: boolean;
  /** The reader's greeting, sent when the panel opens. */
  isGreeting: boolean;
  selectionState?: "selected" | "visible";
};

const gateLog = (event: string, fields: Record<string, unknown>) => console.info(JSON.stringify({ tag: "subscription.gate", event, ...fields }));

/** Null to go ahead; otherwise the 402 to answer with. A reply that goes ahead has been counted when it counts. */
export async function checkChatGate(req: GateRequest, deps: GateDeps): Promise<GateResult> {
  if (!deps.enforced || req.isContinuation) return null;
  if (hasPlus(await deps.loadSubscription(req.userId), deps.now)) return null;

  // A greeting nobody asked for; Explain on selected verses is the person asking, and is counted.
  if (req.isGreeting && req.selectionState === "visible") return { status: 402, body: { error: "plus_only" } };
  // Lumen opens these conversations itself.
  if (req.message === GOAL_THREAD_START_MESSAGE || req.message === GOAL_SETUP_START_MESSAGE) return null;

  const taken = await takeChatReply(deps.allowance, req.userId, deps.now);
  if (taken.allowed) return null;

  // Only the person's own words are checked: Explain and "Reflect on this reading" send a marker, not a message.
  const ownWords = !req.isGreeting && req.message !== GOAL_THREAD_REFLECT_MESSAGE;
  if (ownWords && (await isHardMoment(req.message, req.userId, deps.checkModel))) {
    gateLog("hard_moment_pass", { userId: req.userId });
    return null;
  }
  await taken.commitRefusal();
  gateLog("refused", { userId: req.userId, used: taken.allowance.used, limit: taken.allowance.limit });
  return { status: 402, body: { error: "allowance_used", allowance: taken.allowance } };
}

/**
 * The gate with the real database and model. If the database cannot be reached the reply goes
 * ahead: chat itself needs no database, and an outage should not silence Lumen for everyone.
 */
export const chatGate = (req: GateRequest): Promise<GateResult> =>
  checkChatGate(req, { enforced: paywallEnforced(), loadSubscription, allowance: prismaAllowanceStore, now: appNow() }).catch((error) => {
    console.error(JSON.stringify({ tag: "subscription.gate", event: "gate_failed", userId: req.userId, error: error instanceof Error ? error.name : "unknown" }));
    return null;
  });
