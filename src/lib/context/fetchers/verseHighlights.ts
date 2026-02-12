/**
 * Verse Highlights Fetcher
 *
 * Fetches user's verse highlights from the Artifact table.
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
    verse_highlight: "Highlight",
    verse_note: "Note",
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

  // Extract noteSummary and noteTags from artifact metadata
  const artifactMeta = artifact.metadata as {
    noteSummary?: string;
    noteTags?: string[];
  } | null;
  const noteSummary = artifactMeta?.noteSummary;
  const noteTags = artifactMeta?.noteTags;

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
      ...(noteSummary ? { noteSummary } : {}),
      ...(noteTags && noteTags.length > 0 ? { noteTags } : {}),
      ...(artifact.metadata ? { artifactMetadata: artifact.metadata } : {}),
    },
    ...(features ? { features } : {}),
  };
}

/**
 * Fetch verse highlight candidates.
 */
export async function fetchVerseHighlights(
  options: FetcherOptions
): Promise<ContextCandidate[]> {
  const { userId, temporalRange = "last_week", limit = 20 } = options;

  let createdAfter: Date | undefined;
  let createdBefore: Date | undefined;
  if (temporalRange) {
    const bounds = computeDateBounds(temporalRange);
    createdAfter = bounds.after;
    createdBefore = bounds.before;
  }

  const where: Prisma.ArtifactWhereInput = {
    userId,
    type: "verse_highlight",
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
