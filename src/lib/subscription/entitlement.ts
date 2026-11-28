/**
 * Who has the paid plan (pricing-plan.md §7, §14). The server decides; the app never grants itself
 * the plan. While PAYWALL_ENFORCED is off, everyone is treated as having it.
 */

export type SubscriptionSource = "app_store" | "comp";

export type SubscriptionState = "trial" | "active" | "cancelled" | "grace" | "expired" | "revoked";

/** The fields of a `Subscription` row the rule reads. */
export type SubscriptionRow = {
  source: string;
  productId: string;
  isTrial: boolean;
  willRenew: boolean;
  expiresAt: Date | null;
  graceExpiresAt: Date | null;
  revokedAt: Date | null;
};

export const paywallEnforced = (): boolean => process.env.PAYWALL_ENFORCED === "true";

/** The plan is on when the row is not revoked and its expiry (or grace expiry) is ahead, or it has no expiry. */
export function hasPlus(row: SubscriptionRow | null, now: Date): boolean {
  if (!row || row.revokedAt) return false;
  if (!row.expiresAt) return true;
  const until = Math.max(row.expiresAt.getTime(), row.graceExpiresAt?.getTime() ?? 0);
  return until > now.getTime();
}

/** What the Profile row shows. A trial that will not renew is "cancelled": it ends, and Free follows. */
export function subscriptionState(row: SubscriptionRow, now: Date): SubscriptionState {
  if (row.revokedAt) return "revoked";
  if (!hasPlus(row, now)) return "expired";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "grace";
  if (row.source === "comp") return "active";
  if (!row.willRenew) return "cancelled";
  return row.isTrial ? "trial" : "active";
}

/** The `subscription` object of GET /api/subscription. */
export const subscriptionJson = (row: SubscriptionRow, now: Date) => ({
  source: row.source as SubscriptionSource,
  productId: row.productId,
  state: subscriptionState(row, now),
  isTrial: row.isTrial,
  willRenew: row.willRenew,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  graceExpiresAt: row.graceExpiresAt?.toISOString() ?? null,
});
