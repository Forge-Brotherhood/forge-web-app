/**
 * Conversation Summaries Fetcher
 *
 * Fetches user's conversation session summaries from the Artifact table.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { computeDateBounds } from "@/lib/memory/intentClassifier";
import type { ContextCandidate, FetcherOptions } from "./types";
import { calculateRecencyScore, createRedactedPreview } from "./helpers";

/**
 * Format a human-readable label for an artifact type.
 */
function formatArtifactLabel(type: string, title: string | null): string {
  const typeLabels: Record<string, string> = {
    conversation_session_summary: "Session Summary",
  };

  const typeLabel = typeLabels[type] || "Artifact";
  return title ? `${typeLabel}: ${title}` : typeLabel;
}

/**
 * Create a ContextCandidate from an artifact.
 */
function createArtifactCandidate(
  artifact: {
    id: string;
    type: string;
    title: string | null;
    content: string;
    scriptureRefs: unknown | null;
    createdAt: Date;
    metadata: unknown | null;
  },
  features?: ContextCandidate["features"]
): ContextCandidate {
  const scriptureRefs = artifact.scriptureRefs as string[] | null;

  const label = formatArtifactLabel(artifact.type, artifact.title);
  return {
    id: `artifact:${artifact.id}`,
    source: "artifact" as const,
    label,
    preview: createRedactedPreview(artifact.content),
    metadata: {
      artifactType: artifact.type,
      title: artifact.title,
      scriptureRefs,
      createdAt: artifact.createdAt.toISOString(),
      fullContent: artifact.content,
      ...(artifact.metadata ? { artifactMetadata: artifact.metadata } : {}),
    },
    ...(features ? { features } : {}),
  };
}

/**
 * Fetch conversation session summary candidates.
 */
export async function fetchConversationSummaries(
  options: FetcherOptions
): Promise<ContextCandidate[]> {
  const { userId, temporalRange = "last_week", limit = 5 } = options;

  let createdAfter: Date | undefined;
  let createdBefore: Date | undefined;
  if (temporalRange) {
    const bounds = computeDateBounds(temporalRange);
    createdAfter = bounds.after;
    createdBefore = bounds.before;
  }

  const where: Prisma.ArtifactWhereInput = {
    userId,
    type: "conversation_session_summary",
    status: "active",
    ...(createdAfter || createdBefore
      ? {
          createdAt: {
            ...(createdAfter ? { gte: createdAfter } : {}),
            ...(createdBefore ? { lte: createdBefore } : {}),
          },
        }
      : {}),
  };

  const results = await prisma.artifact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return results.map((a) =>
    createArtifactCandidate(a, {
      recencyScore: calculateRecencyScore(a.createdAt),
      createdAt: a.createdAt.toISOString(),
    })
  );
}
