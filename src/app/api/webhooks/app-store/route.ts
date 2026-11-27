import { NextRequest, NextResponse } from "next/server";
import { appNow } from "@/lib/devClock";
import { PRODUCT_IDS, subscriptionFromApple, verifyNotification, verifyRenewalInfo, verifyTransaction } from "@/lib/subscription/apple";
import { findSubscriber, saveAppleSubscription } from "@/lib/subscription/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = (event: string, fields: Record<string, unknown> = {}) => console.info(JSON.stringify({ tag: "api.webhooks.app-store", event, ...fields }));

// POST /api/webhooks/app-store
// App Store Server Notifications V2 (pricing-plan.md §7, §14). Public; the signature is checked with
// Apple's library. Once it verifies the answer is 200, so Apple does not retry forever. Every type is
// handled the same way: the notification's latest transaction and renewal info become the row.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { signedPayload?: unknown } | null;
  if (typeof body?.signedPayload !== "string") {
    return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
  }

  let notification;
  try {
    notification = await verifyNotification(body.signedPayload);
  } catch (error) {
    log("unverified", { error: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Notification did not verify" }, { status: 400 });
  }

  const ids = { notificationUUID: notification.notificationUUID ?? null, type: notification.notificationType ?? null, subtype: notification.subtype ?? null };
  try {
    const data = notification.data;
    if (!data?.signedTransactionInfo) {
      log("no_transaction", ids);
      return NextResponse.json({ ok: true });
    }
    const transaction = await verifyTransaction(data.signedTransactionInfo);
    const renewal = data.signedRenewalInfo ? await verifyRenewalInfo(data.signedRenewalInfo) : null;
    const txIds = { ...ids, originalTransactionId: transaction.originalTransactionId ?? null, environment: transaction.environment ?? null };
    if (!transaction.productId || !PRODUCT_IDS.includes(transaction.productId) || !transaction.originalTransactionId) {
      log("other_product", txIds);
      return NextResponse.json({ ok: true });
    }

    const userId = await findSubscriber(transaction.appAccountToken, transaction.originalTransactionId);
    if (!userId) {
      log("no_user", txIds);
      return NextResponse.json({ ok: true });
    }
    const outcome = await saveAppleSubscription(userId, subscriptionFromApple(transaction, renewal), null, appNow());
    log("applied", { ...txIds, userId, outcome });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // A failure after the signature verified (the database, say): Apple retries a non-200, which is what is wanted here.
    log("failed", { ...ids, error: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Failed to apply the notification" }, { status: 500 });
  }
}
