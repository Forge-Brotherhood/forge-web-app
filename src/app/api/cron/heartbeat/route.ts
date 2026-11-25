import { NextRequest, NextResponse } from "next/server";
import { cleanupInvalidTokens, sendPushNotification } from "@/lib/fcm";
import { takeModelCall } from "@/lib/heartbeat/dailyCap";
import { appNow } from "@/lib/devClock";
import { isHeartbeatEnabled } from "@/lib/heartbeat/config";
import { isCronAuthorized } from "@/lib/heartbeat/cronAuth";
import { getBriefKeyVault } from "@/lib/heartbeat/kms";
import { callBeatModel } from "@/lib/heartbeat/model";
import { prismaHeartbeatStore } from "@/lib/heartbeat/prismaStore";
import { runHeartbeat } from "@/lib/heartbeat/serverRun";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Stops short of the limit: the run stops starting new users after 45 seconds. 60 is within every plan.
export const maxDuration = 60;

// GET /api/cron/heartbeat
// The server heartbeat's clock. Protected by the cron secret (Vercel sends it as a bearer token); the
// middleware already lets /api/cron/* through without a Clerk session. Off unless HEARTBEAT_ENABLED=true.
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = isHeartbeatEnabled();
  try {
    const summary = await runHeartbeat({
      store: prismaHeartbeatStore,
      getKms: getBriefKeyVault,
      callModel: callBeatModel,
      push: {
        // The notification service extension that opens the sealed text is iOS only.
        tokensFor: async (userId) =>
          (await prisma.pushToken.findMany({ where: { userId, isActive: true, platform: "ios" }, select: { token: true }, orderBy: { updatedAt: "desc" }, take: 20 })).map((t) => t.token),
        send: sendPushNotification,
        cleanup: cleanupInvalidTokens,
      },
      allowModel: takeModelCall,
      log: (event) => console.info(JSON.stringify(event)),
      now: appNow,
      enabled,
    });
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ tag: "api.cron.heartbeat", event: "failed", error: error instanceof Error ? error.name : "unknown" }));
    return NextResponse.json({ error: "Heartbeat run failed" }, { status: 500 });
  }
}
