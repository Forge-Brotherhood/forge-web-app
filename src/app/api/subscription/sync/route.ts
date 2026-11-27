import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { appNow } from "@/lib/devClock";
import { PRODUCT_IDS, subscriptionFromApple, verifyTransaction } from "@/lib/subscription/apple";
import { subscriptionStatus } from "@/lib/subscription/status";
import { saveAppleSubscription } from "@/lib/subscription/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  signedTransaction: z.string().min(1).max(20_000),
  startedFrom: z.enum(["first_session", "gate", "profile"]).nullable().optional(),
});

// POST /api/subscription/sync
// The app sends Apple's signed transaction right after a purchase or restore, so the plan is on at once
// (pricing-plan.md §14). Logs carry ids and error names only.
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 });
    }

    let transaction;
    try {
      transaction = await verifyTransaction(parsed.data.signedTransaction);
    } catch (error) {
      console.warn(JSON.stringify({ tag: "api.subscription.sync", event: "unverified", userId: authResult.userId, error: error instanceof Error ? error.name : "unknown" }));
      return NextResponse.json({ error: "Transaction did not verify" }, { status: 400 });
    }
    if (!transaction.productId || !PRODUCT_IDS.includes(transaction.productId) || !transaction.originalTransactionId) {
      return NextResponse.json({ error: "Not a Forge Plus transaction" }, { status: 400 });
    }

    const outcome = await saveAppleSubscription(authResult.userId, subscriptionFromApple(transaction, null), parsed.data.startedFrom ?? null, appNow());
    console.info(
      JSON.stringify({
        tag: "api.subscription.sync",
        event: "synced",
        userId: authResult.userId,
        originalTransactionId: transaction.originalTransactionId,
        environment: transaction.environment ?? null,
        outcome,
      })
    );
    return NextResponse.json(await subscriptionStatus(authResult.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ tag: "api.subscription.sync", event: "failed", error: error instanceof Error ? error.name : "unknown" }));
    return NextResponse.json({ error: "Failed to sync the subscription" }, { status: 500 });
  }
}
