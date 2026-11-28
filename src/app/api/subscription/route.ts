import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { subscriptionStatus } from "@/lib/subscription/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/subscription
// The plan and the free allowance, for the Profile row, the caption and the gate (pricing-plan.md §14).
export async function GET() {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(await subscriptionStatus(authResult.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ tag: "api.subscription", event: "failed", error: error instanceof Error ? error.name : "unknown" }));
    return NextResponse.json({ error: "Failed to load the subscription" }, { status: 500 });
  }
}
