import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { generateThreadSummary, threadSummaryRequestSchema } from "@/lib/chatSessions/threadSummary";

export const runtime = "nodejs";

// POST /api/goals/thread-summary
// Folds older turns of a goal's conversation into its rolling summary. Stateless: the app keeps the result.
// Logs carry sizes and ids only.
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const input = threadSummaryRequestSchema.parse(body);
    const summary = await generateThreadSummary(input);
    console.info(
      JSON.stringify({
        tag: "api.goals.thread-summary",
        event: "success",
        userId: authResult.userId,
        turns: input.turns.length,
        previousSummaryLen: input.previousSummary?.length ?? 0,
        summaryLen: summary.length,
        latencyMs: Date.now() - startedAt,
      })
    );
    return NextResponse.json({ summary });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request data", details: error.issues }, { status: 400 });
    }
    console.error(
      JSON.stringify({
        tag: "api.goals.thread-summary",
        event: "failed",
        error: error instanceof Error ? error.name : "unknown error",
        latencyMs: Date.now() - startedAt,
      })
    );
    return NextResponse.json({ error: "Failed to summarize" }, { status: 500 });
  }
}
