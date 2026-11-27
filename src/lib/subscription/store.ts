import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AllowanceRow, AllowanceStore } from "@/lib/subscription/allowance";
import { isOlderThanStored, type AppleFields } from "@/lib/subscription/apple";
import { hasPlus, type SubscriptionRow } from "@/lib/subscription/entitlement";

/** Database access for subscriptions and the allowance. Ids, states, dates and counts only. */

const subscriptionSelect = {
  source: true,
  productId: true,
  isTrial: true,
  willRenew: true,
  expiresAt: true,
  graceExpiresAt: true,
  revokedAt: true,
} as const;

export const loadSubscription = (userId: string): Promise<SubscriptionRow | null> =>
  prisma.subscription.findUnique({ where: { userId }, select: subscriptionSelect });

export type SaveOutcome = "saved" | "older" | "comp_kept";

/**
 * Applies Apple's fields to the person's row. `startedFrom` is kept only when the row is made. A
 * complimentary plan that is still on is left alone, so a test purchase (and its refund) cannot end it.
 */
export async function saveAppleSubscription(userId: string, fields: AppleFields, startedFrom: string | null, now: Date): Promise<SaveOutcome> {
  const stored = await prisma.subscription.findUnique({ where: { userId }, select: subscriptionSelect });
  if (stored?.source === "comp" && hasPlus(stored, now)) return "comp_kept";
  if (stored?.source === "app_store" && isOlderThanStored(stored, fields)) return "older";
  // A restore on another account moves the purchase there: the account that held it gives it up.
  await prisma.$transaction([
    prisma.subscription.updateMany({
      where: { originalTransactionId: fields.originalTransactionId, NOT: { userId } },
      data: { originalTransactionId: null, revokedAt: now },
    }),
    prisma.subscription.upsert({
      where: { userId },
      create: { userId, ...fields, willRenew: fields.willRenew ?? true, graceExpiresAt: fields.graceExpiresAt ?? null, startedFrom },
      update: fields,
    }),
  ]);
  return "saved";
}

/**
 * Whose purchase this is: the row that already holds it (a restore can have moved it to another
 * account), else the account token the app set at purchase, which is the user's id.
 */
export async function findSubscriber(appAccountToken: string | undefined, originalTransactionId: string | undefined): Promise<string | null> {
  if (originalTransactionId) {
    const row = await prisma.subscription.findUnique({ where: { originalTransactionId }, select: { userId: true } });
    if (row) return row.userId;
  }
  if (appAccountToken) {
    const user = await prisma.user.findUnique({ where: { id: appAccountToken.toLowerCase() }, select: { id: true } });
    if (user) return user.id;
  }
  return null;
}

const allowanceSelect = { windowStart: true, used: true, firstDayUsed: true, gateHits: true, lastGateAt: true } as const;

export const prismaAllowanceStore: AllowanceStore = {
  load: async (userId) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true, chatAllowance: { select: allowanceSelect } } });
    return { row: user.chatAllowance, accountCreatedAt: user.createdAt };
  },
  save: async (userId, prev: AllowanceRow | null, next: AllowanceRow) => {
    if (!prev) {
      try {
        await prisma.chatAllowance.create({ data: { userId, ...next } });
        return true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
        throw error;
      }
    }
    const { count } = await prisma.chatAllowance.updateMany({
      where: { userId, windowStart: prev.windowStart, used: prev.used, firstDayUsed: prev.firstDayUsed, gateHits: prev.gateHits },
      data: next,
    });
    return count === 1;
  },
};
