import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateInternalApiKey } from "../_internalApiKey";
import { compactContextCandidatesPayload } from "@/lib/guide/contextCompact";
import { getAiContextForUser } from "@/lib/ai/userContext";
import { compressContextBundle } from "@/lib/guide/contextCompress";
import {
  fetchLifeContext,
  fetchBibleReadingSessions,
  fetchVerseHighlights,
  fetchVerseNotes,
  fetchConversationSummaries,
  dedupeCandidates,
  groupBySource,
  type ContextCandidate,
} from "@/lib/context/fetchers";

const requestSchema = z.object({
  userId: z.string().min(1),
  enabledActions: z.array(z.string().min(1).max(64)).max(32).optional(),
  debugMode: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Invalid or missing internal API key" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const input = requestSchema.parse(body);

    let aiContext: { userContext: Record<string, unknown> } | undefined;
    try {
      const userAiContext = await getAiContextForUser(input.userId);
      aiContext = { userContext: userAiContext as unknown as Record<string, unknown> };
    } catch (error) {
      // Best-effort: missing aiContext should not block rich-context debugging.
      console.warn("[suggestion-debugger/context-candidates] Failed to load aiContext:", error);
    }

    // Fetch all context in parallel with "last_week" temporal range
    const [
      lifeContext,
      bibleReadingSessions,
      verseHighlights,
      verseNotes,
      conversationSummaries,
    ] = await Promise.all([
      fetchLifeContext({ userId: input.userId, aiContext }),
      fetchBibleReadingSessions({
        userId: input.userId,
        temporalRange: "last_week",
        limit: 10,
      }),
      fetchVerseHighlights({
        userId: input.userId,
        temporalRange: "last_week",
        limit: 20,
      }),
      fetchVerseNotes({
        userId: input.userId,
        temporalRange: "last_week",
        limit: 20,
      }),
      fetchConversationSummaries({
        userId: input.userId,
        temporalRange: "last_week",
        limit: 5,
      }),
    ]);

    // Combine all candidates
    const allCandidates: ContextCandidate[] = [
      ...lifeContext,
      ...bibleReadingSessions,
      ...verseHighlights,
      ...verseNotes,
      ...conversationSummaries,
    ];

    // Deduplicate
    const dedupedCandidates = dedupeCandidates(allCandidates);
    const bySourceCounts = groupBySource(dedupedCandidates);

    // Build raw payload (mimics old pipeline structure)
    const raw = {
      plan: {
        response: {
          responseMode: "coach",
          lengthTarget: "short",
        },
        retrieval: {
          filters: {
            temporal: { range: "last_week" },
          },
        },
      },
      candidates: dedupedCandidates,
      bySourceCounts,
    };

    const compact = compressContextBundle({
      raw: raw as Parameters<typeof compressContextBundle>[0]["raw"],
      enabledActions: input.enabledActions,
    });
    const compactedRaw = compactContextCandidatesPayload(raw);

    return NextResponse.json({
      compact,
      ...(input.debugMode ? { raw: compactedRaw } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to build context candidates", details: message }, { status: 500 });
  }
}


