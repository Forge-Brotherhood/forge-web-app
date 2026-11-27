import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { appNow } from "@/lib/devClock";
import { heartbeatModelAllowed } from "@/lib/heartbeat/dailyCap";
import { callBeatModel } from "@/lib/heartbeat/model";
import { runBeat } from "@/lib/heartbeat/runBeat";
import { localParts } from "@/lib/heartbeat/rules";
import { beatRequestSchema } from "@/lib/heartbeat/schemas";
import { isPlusAccount } from "@/lib/subscription/status";

export const runtime = "nodejs";

// POST /api/heartbeat/beat
// One beat of the heartbeat, run on the brief the app sends. Stateless: the brief and the result are
// never stored. The app applies the result to its own records. Logs carry ids, sizes and counts only.
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const text = await request.text();
    const input = beatRequestSchema.parse(JSON.parse(text || "{}"));
    const now = appNow();
    const day = localParts(now, input.brief.person.timezone).date;

    const output = await runBeat(input.brief, now, {
      trigger: input.trigger,
      callModel: callBeatModel,
      userId: authResult.userId,
      allowModel: () => heartbeatModelAllowed(isPlusAccount)(authResult.userId, day),
    });

    console.info(
      JSON.stringify({
        tag: "api.heartbeat.beat",
        event: "success",
        userId: authResult.userId,
        trigger: input.trigger,
        briefChars: text.length,
        goals: input.brief.goals.length,
        staleness: output.meta.staleness,
        careMode: output.meta.careMode,
        modelCalled: output.meta.modelCalled,
        posts: output.posts.length,
        activities: output.activities.length,
        dropped: output.meta.dropped.map((d) => d.code),
        latencyMs: Date.now() - startedAt,
      })
    );
    return NextResponse.json(output, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid request data", ...(error instanceof z.ZodError ? { details: error.issues.map((i) => ({ path: i.path, message: i.message })) } : {}) },
        { status: 400 }
      );
    }
    console.error(
      JSON.stringify({
        tag: "api.heartbeat.beat",
        event: "failed",
        error: error instanceof Error ? error.name : "unknown error",
        latencyMs: Date.now() - startedAt,
      })
    );
    return NextResponse.json({ error: "Failed to run the beat" }, { status: 500 });
  }
}
