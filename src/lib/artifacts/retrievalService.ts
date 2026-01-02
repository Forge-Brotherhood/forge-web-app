/**
 * Retrieval Service
 *
 * Hybrid search combining filters and semantic search.
 * Provides formatted snippets for prompt injection.
 */

import { prisma } from "@/lib/prisma";
import type {
  Artifact,
  ArtifactFilters,
  ArtifactSnippet,
  ArtifactType,
  SearchResult,
} from "./types";
import { searchSimilar } from "./embeddingService";

// =============================================================================
// Types
// =============================================================================

export interface RetrievalParams {
  query: string;
  userId: string;
  groupIds?: string[];
  types?: ArtifactType[];
  limit?: number;
  includeGroupArtifacts?: boolean;
}

export interface RetrievalResult {
  artifacts: Artifact[];
  snippets: ArtifactSnippet[];
  formattedContext: string;
}

// =============================================================================
// Hybrid Retrieval
// =============================================================================

/**
 * Retrieve relevant artifacts using hybrid search.
 * Combines filter-based retrieval with semantic similarity.
 */
export async function retrieveForContext(
  params: RetrievalParams
): Promise<RetrievalResult> {
  const { query, userId, groupIds, types, limit = 5, includeGroupArtifacts = true } = params;

  // Build allowed scopes
  const allowedScopes: ("private" | "group" | "global")[] = ["private"];
  if (includeGroupArtifacts && groupIds && groupIds.length > 0) {
    allowedScopes.push("group");
  }

  // Build filters
  const filters: ArtifactFilters = {
    userId,
    types,
    scopes: allowedScopes,
    status: "active",
    limit: 100, // Fetch more for semantic reranking
  };

  // Get semantic search results
  const searchResults = await searchSimilar(query, filters, 20);

  // Filter by group membership for group-scoped artifacts
  const accessibleResults = await filterByAccess(searchResults, userId, groupIds);

  // Take top results
  const topResults = accessibleResults.slice(0, limit);

  // Extract artifacts
  const artifacts = topResults.map((r) => r.artifact);

  // Build snippets for prompt injection
  const snippets = artifacts.map((a) => formatSnippet(a));

  // Format context string
  const formattedContext = formatContextForPrompt(snippets);

  return {
    artifacts,
    snippets,
    formattedContext,
  };
}

/**
 * Retrieve artifacts by scripture reference.
 */
export async function retrieveByScripture(
  scriptureRef: string,
  userId: string,
  limit: number = 10
): Promise<Artifact[]> {
  // Search for artifacts with matching scripture reference
  const artifacts = await prisma.artifact.findMany({
    where: {
      userId,
      status: "active",
      scriptureRefs: {
        array_contains: [scriptureRef],
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return artifacts.map(mapPrismaArtifact);
}

/**
 * Retrieve recent artifacts for a user.
 */
export async function retrieveRecent(
  userId: string,
  types?: ArtifactType[],
  limit: number = 10
): Promise<Artifact[]> {
  const where: NonNullable<
    Parameters<typeof prisma.artifact.findMany>[0]
  >["where"] = {
    userId,
    status: "active",
  };

  if (types && types.length > 0) {
    where.type = { in: types };
  }

  const artifacts = await prisma.artifact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return artifacts.map(mapPrismaArtifact);
}

/**
 * Retrieve artifacts from a specific time range.
 */
export async function retrieveByTimeRange(
  userId: string,
  startDate: Date,
  endDate: Date,
  types?: ArtifactType[]
): Promise<Artifact[]> {
  const where: NonNullable<
    Parameters<typeof prisma.artifact.findMany>[0]
  >["where"] = {
    userId,
    status: "active",
    createdAt: {
      gte: startDate,
      lte: endDate,
    },
  };

  if (types && types.length > 0) {
    where.type = { in: types };
  }

  const artifacts = await prisma.artifact.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return artifacts.map(mapPrismaArtifact);
}

// =============================================================================
// Access Control
// =============================================================================

async function filterByAccess(
  results: SearchResult[],
  userId: string,
  groupIds?: string[]
): Promise<SearchResult[]> {
  const accessible: SearchResult[] = [];

  for (const result of results) {
    const artifact = result.artifact;

    // Private: must be owner
    if (artifact.scope === "private") {
      if (artifact.userId === userId) {
        accessible.push(result);
      }
      continue;
    }

    // Group: must be member
    if (artifact.scope === "group") {
      if (artifact.groupId && groupIds?.includes(artifact.groupId)) {
        accessible.push(result);
      }
      continue;
    }

    // Global: everyone can access
    if (artifact.scope === "global") {
      accessible.push(result);
    }
  }

  return accessible;
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format an artifact as a snippet for display.
 */
function formatSnippet(artifact: Artifact): ArtifactSnippet {
  // Format date as "Dec 20"
  const date = artifact.createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  // Get preview (first 100 chars)
  const preview =
    artifact.content.length > 100
      ? artifact.content.substring(0, 100) + "..."
      : artifact.content;

  // Get first scripture ref if available
  const scriptureRef =
    artifact.scriptureRefs && artifact.scriptureRefs.length > 0
      ? artifact.scriptureRefs[0]
      : undefined;

  return {
    type: artifact.type,
    date,
    preview,
    scriptureRef,
  };
}

/**
 * Format snippets for prompt injection.
 * Produces compact format like:
 * [Journal - Dec 20] "Reflecting on Romans 8..." (Romans 8:1-11)
 */
function formatContextForPrompt(snippets: ArtifactSnippet[]): string {
  if (snippets.length === 0) {
    return "";
  }

  const lines = snippets.map((s) => {
    const typeLabel = formatTypeLabel(s.type);
    const base = `[${typeLabel} - ${s.date}] "${s.preview}"`;
    return s.scriptureRef ? `${base} (${s.scriptureRef})` : base;
  });

  return `PAST CONTEXT:\n${lines.join("\n")}`;
}

/**
 * Format artifact type as human-readable label.
 */
function formatTypeLabel(type: ArtifactType): string {
  const labels: Record<ArtifactType, string> = {
    conversation_session_summary: "Session",
    journal_entry: "Journal",
    prayer_request: "Prayer",
    prayer_update: "Update",
    testimony: "Testimony",
    verse_highlight: "Highlight",
    verse_note: "Note",
    group_meeting_notes: "Meeting",
    bible_reading_session: "Reading",
  };

  return labels[type] || type;
}

// =============================================================================
// Helpers
// =============================================================================

function mapPrismaArtifact(
  artifact: Awaited<ReturnType<typeof prisma.artifact.findUnique>> & object
): Artifact {
  return {
    id: artifact.id,
    userId: artifact.userId,
    groupId: artifact.groupId,
    conversationId: artifact.conversationId,
    sessionId: artifact.sessionId,
    type: artifact.type as Artifact["type"],
    scope: artifact.scope as Artifact["scope"],
    title: artifact.title,
    content: artifact.content,
    scriptureRefs: artifact.scriptureRefs as string[] | null,
    tags: artifact.tags as string[] | null,
    metadata: artifact.metadata as Record<string, unknown> | null,
    status: artifact.status as Artifact["status"],
    deletedAt: artifact.deletedAt,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}
