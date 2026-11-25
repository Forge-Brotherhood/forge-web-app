import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appNow, devClockOffsetMs, isDevClockEnabled, MAX_DEV_CLOCK_OFFSET_MS, setDevClockOffsetMs } from "@/lib/devClock";
import { isCronAuthorized } from "@/lib/heartbeat/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const state = () => ({ now: appNow().toISOString(), offsetMs: devClockOffsetMs() });
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

// GET /api/dev/clock
// The dev clock, for the Debug app and the admin. 404 unless it is on (see lib/devClock).
export async function GET() {
  if (!isDevClockEnabled()) return notFound();
  return NextResponse.json(state(), { headers: { "Cache-Control": "no-store" } });
}

const bodySchema = z.object({
  offsetMs: z.number().int().min(0).max(MAX_DEV_CLOCK_OFFSET_MS),
});

// POST /api/dev/clock
// Sets how far ahead the dev clock is (0 is the real time). Needs the cron secret, as the admin sends it.
export async function POST(request: NextRequest) {
  if (!isDevClockEnabled()) return notFound();
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  setDevClockOffsetMs(parsed.data.offsetMs);
  return NextResponse.json(state(), { headers: { "Cache-Control": "no-store" } });
}
