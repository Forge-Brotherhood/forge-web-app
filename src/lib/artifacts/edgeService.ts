/**
 * Edge Service
 *
 * Relationship management between artifacts (threads, follow-ups, references).
 */

import { prisma } from "@/lib/prisma";
import type {
  Artifact,
  ArtifactEdge,
  ArtifactRelation,
  CreateEdgeInput,
  ThreadResult,
} from "./types";
import { isValidArtifactRelation } from "./types";

// =============================================================================
// Create
// =============================================================================

export async function createEdge(data: CreateEdgeInput): Promise<ArtifactEdge> {
  // Validate relation
  if (!isValidArtifactRelation(data.relation)) {
    throw new Error(`Invalid artifact relation: ${data.relation}`);
  }

  // Verify both artifacts exist
  const [from, to] = await Promise.all([
    prisma.artifact.findUnique({ where: { id: data.fromId } }),
    prisma.artifact.findUnique({ where: { id: data.toId } }),
  ]);

  if (!from) {
    throw new Error(`From artifact not found: ${data.fromId}`);
  }
  if (!to) {
    throw new Error(`To artifact not found: ${data.toId}`);
  }

  const edge = await prisma.artifactEdge.create({
    data: {
      fromId: data.fromId,
      toId: data.toId,
      relation: data.relation,
    },
  });

  return mapPrismaEdge(edge);
}

// =============================================================================
// Read
// =============================================================================

export async function getEdge(id: string): Promise<ArtifactEdge | null> {
  const edge = await prisma.artifactEdge.findUnique({
    where: { id },
  });

  return edge ? mapPrismaEdge(edge) : null;
}

export async function getEdgesFrom(
  artifactId: string,
  relation?: ArtifactRelation
): Promise<ArtifactEdge[]> {
  const where: NonNullable<
    Parameters<typeof prisma.artifactEdge.findMany>[0]
  >["where"] = {
    fromId: artifactId,
  };

  if (relation) {
    where.relation = relation;
  }

  const edges = await prisma.artifactEdge.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });

  return edges.map(mapPrismaEdge);
}

export async function getEdgesTo(
  artifactId: string,
  relation?: ArtifactRelation
): Promise<ArtifactEdge[]> {
  const where: NonNullable<
    Parameters<typeof prisma.artifactEdge.findMany>[0]
  >["where"] = {
    toId: artifactId,
  };

  if (relation) {
    where.relation = relation;
  }

  const edges = await prisma.artifactEdge.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });

  return edges.map(mapPrismaEdge);
}

// =============================================================================
// Thread Traversal
// =============================================================================

/**
 * Get a thread of artifacts starting from a seed artifact.
 * Follows edges in both directions to build the complete thread.
 */
export async function getThread(seedId: string): Promise<ThreadResult> {
  const visited = new Set<string>();
  const artifactIds = new Set<string>();
  const allEdges: ArtifactEdge[] = [];

  // BFS traversal
  const queue = [seedId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    artifactIds.add(currentId);

    // Get edges from this artifact
    const edgesFrom = await prisma.artifactEdge.findMany({
      where: { fromId: currentId },
    });

    // Get edges to this artifact
    const edgesTo = await prisma.artifactEdge.findMany({
      where: { toId: currentId },
    });

    for (const edge of edgesFrom) {
      allEdges.push(mapPrismaEdge(edge));
      if (!visited.has(edge.toId)) {
        queue.push(edge.toId);
      }
    }

    for (const edge of edgesTo) {
      // Avoid duplicates
      if (!allEdges.some((e) => e.id === edge.id)) {
        allEdges.push(mapPrismaEdge(edge));
      }
      if (!visited.has(edge.fromId)) {
        queue.push(edge.fromId);
      }
    }
  }

  // Fetch all artifacts in the thread
  const artifacts = await prisma.artifact.findMany({
    where: {
      id: { in: Array.from(artifactIds) },
      status: "active",
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    artifacts: artifacts.map(mapPrismaArtifact),
    edges: allEdges,
  };
}

/**
 * Get follow-up chain for an artifact.
 * Returns artifacts in chronological order.
 */
export async function getFollowUpChain(
  artifactId: string
): Promise<Artifact[]> {
  const chain: Artifact[] = [];
  const visited = new Set<string>();

  // Get the seed artifact
  const seed = await prisma.artifact.findUnique({
    where: { id: artifactId },
  });

  if (!seed || seed.status !== "active") {
    return [];
  }

  chain.push(mapPrismaArtifact(seed));
  visited.add(seed.id);

  // Follow "follows_up" edges forward
  let currentId = artifactId;

  while (true) {
    const nextEdge = await prisma.artifactEdge.findFirst({
      where: {
        fromId: currentId,
        relation: "follows_up",
      },
    });

    if (!nextEdge || visited.has(nextEdge.toId)) {
      break;
    }

    const nextArtifact = await prisma.artifact.findUnique({
      where: { id: nextEdge.toId },
    });

    if (!nextArtifact || nextArtifact.status !== "active") {
      break;
    }

    chain.push(mapPrismaArtifact(nextArtifact));
    visited.add(nextArtifact.id);
    currentId = nextArtifact.id;
  }

  return chain;
}

/**
 * Get artifacts that summarize a session.
 */
export async function getSummariesFor(sessionId: string): Promise<Artifact[]> {
  const artifacts = await prisma.artifact.findMany({
    where: {
      sessionId,
      type: "conversation_session_summary",
      status: "active",
    },
    orderBy: { createdAt: "desc" },
  });

  return artifacts.map(mapPrismaArtifact);
}

// =============================================================================
// Delete
// =============================================================================

export async function deleteEdge(id: string): Promise<void> {
  await prisma.artifactEdge.delete({
    where: { id },
  });
}

export async function deleteEdgesForArtifact(artifactId: string): Promise<void> {
  await prisma.artifactEdge.deleteMany({
    where: {
      OR: [{ fromId: artifactId }, { toId: artifactId }],
    },
  });
}

// =============================================================================
// Helpers
// =============================================================================

function mapPrismaEdge(
  edge: Awaited<ReturnType<typeof prisma.artifactEdge.findUnique>> & object
): ArtifactEdge {
  return {
    id: edge.id,
    fromId: edge.fromId,
    toId: edge.toId,
    relation: edge.relation as ArtifactRelation,
    createdAt: edge.createdAt,
  };
}

function mapPrismaArtifact(
  artifact: Awaited<ReturnType<typeof prisma.artifact.findUnique>> & object
): Artifact {
  return {
    id: artifact.id,
    userId: artifact.userId,
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
