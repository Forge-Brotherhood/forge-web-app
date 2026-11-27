import { appNow } from "@/lib/devClock";
import { readAllowance } from "@/lib/subscription/allowance";
import { hasPlus, paywallEnforced, subscriptionJson } from "@/lib/subscription/entitlement";
import { loadSubscription, prismaAllowanceStore } from "@/lib/subscription/store";

/** The body of GET /api/subscription (pricing-plan.md §14), also returned by the sync. */
export async function subscriptionStatus(userId: string) {
  const now = appNow();
  const enforced = paywallEnforced();
  const row = await loadSubscription(userId);
  const plus = !enforced || hasPlus(row, now);
  return {
    enforced,
    plan: plus ? ("plus" as const) : ("free" as const),
    appAccountToken: userId,
    subscription: row ? subscriptionJson(row, now) : null,
    allowance: plus ? null : await readAllowance(prismaAllowanceStore, userId, now),
  };
}

/** Whether the account has the plan now. Everyone does while the paywall is off. */
export async function isPlusAccount(userId: string): Promise<boolean> {
  return !paywallEnforced() || hasPlus(await loadSubscription(userId), appNow());
}
