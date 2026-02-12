/**
 * Build Suggestions Context
 *
 * Standalone context builder for the /api/guide/suggestions endpoint.
 * Replaces the old pipeline-based buildGuideStartContext with direct fetchers.
 */

import { prisma } from "@/lib/prisma";
import { getAiContextForUser } from "@/lib/ai/userContext";
import { compactContextCandidatesPayload } from "@/lib/guide/contextCompact";
import {
  compressContextBundle,
  getAllowedActionTypesFromContext,
  getAllowedEvidenceIdsFromContext,
} from "@/lib/guide/contextCompress";
import { contextGuideEventSchema } from "@/lib/guide/contextNdjson";
import {
  fetchLifeContext,
  fetchBibleReadingSessions,
  fetchVerseHighlights,
  fetchVerseNotes,
  fetchConversationSummaries,
  dedupeCandidates,
  groupBySource,
  type ContextCandidate,
} from "./fetchers";

export class SuggestionsContextError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "SuggestionsContextError";
  }
}

export type SuggestionsContext = {
  user: { id: string; firstName: string | null };
  contextPayload: unknown;
  allowedActionTypes: string[];
  allowedEvidenceIds: string[];
  validateEvent: ReturnType<typeof contextGuideEventSchema>;
};

/**
 * Build the context payload for guide suggestions.
 *
 * This function fetches all relevant context in parallel and returns
 * the same shape as the old buildGuideStartContext.
 */
export async function buildSuggestionsContext(options: {
  userId: string;
  enabledActions: string[];
}): Promise<SuggestionsContext> {
  // Fetch user
  const user = await prisma.user.findUnique({
    where: { id: options.userId },
    select: { id: true, firstName: true },
  });
  if (!user) throw new SuggestionsContextError("User not found", 404);

  // Load aiContext (best-effort)
  let aiContext: { userContext: Record<string, unknown> } | undefined;
  try {
    const userAiContext = await getAiContextForUser(user.id);
    aiContext = {
      userContext: userAiContext as unknown as Record<string, unknown>,
    };
  } catch (error) {
    console.warn("[buildSuggestionsContext] Failed to load aiContext:", error);
  }

  // Fetch all context in parallel with "last_week" temporal range
  const [
    lifeContext,
    bibleReadingSessions,
    verseHighlights,
    verseNotes,
    conversationSummaries,
  ] = await Promise.all([
    fetchLifeContext({ userId: user.id, aiContext }),
    fetchBibleReadingSessions({
      userId: user.id,
      temporalRange: "last_week",
      limit: 10,
    }),
    fetchVerseHighlights({
      userId: user.id,
      temporalRange: "last_week",
      limit: 20,
    }),
    fetchVerseNotes({
      userId: user.id,
      temporalRange: "last_week",
      limit: 20,
    }),
    fetchConversationSummaries({
      userId: user.id,
      temporalRange: "last_week",
      limit: 5,
    }),
  ]);

  // Combine all candidates
  const candidates: ContextCandidate[] = [
    ...lifeContext,
    ...bibleReadingSessions,
    ...verseHighlights,
    ...verseNotes,
    ...conversationSummaries,
  ];

  // Deduplicate
  const dedupedCandidates = dedupeCandidates(candidates);
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

  // Compact and compress
  const compactedRaw = compactContextCandidatesPayload(raw);
  const contextPayload = compressContextBundle({
    raw: compactedRaw as Parameters<typeof compressContextBundle>[0]["raw"],
    enabledActions: options.enabledActions,
  });

  // Build validation schema
  const allowedActionTypes =
    getAllowedActionTypesFromContext(contextPayload) ?? [];
  const allowedEvidenceIds = getAllowedEvidenceIdsFromContext(contextPayload);
  const validateEvent = contextGuideEventSchema({
    allowedEvidenceIds,
    allowedActionTypes: allowedActionTypes.length
      ? allowedActionTypes
      : undefined,
  });

  return {
    user: { id: user.id, firstName: user.firstName?.trim() ?? null },
    contextPayload,
    allowedActionTypes,
    allowedEvidenceIds,
    validateEvent,
  };
}
