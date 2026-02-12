/**
 * Artifact Service
 *
 * CRUD operations for artifacts with access control.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type {
  Artifact,
  ArtifactFilters,
  CreateArtifactInput,
  UpdateArtifactInput,
  ArtifactStatus,
} from "./types";
import {
  isValidArtifactType,
  isValidArtifactScope,
  shouldEmbedArtifactType,
} from "./types";
import { embedArtifact, removeEmbedding } from "./embeddingService";

// =============================================================================
// Create
// =============================================================================

export async function createArtifact(
  data: CreateArtifactInput
): Promise<Artifact> {
  // Validate type and scope
  if (!isValidArtifactType(data.type)) {
    throw new Error(`Invalid artifact type: ${data.type}`);
  }
  if (!isValidArtifactScope(data.scope)) {
    throw new Error(`Invalid artifact scope: ${data.scope}`);
  }

  // Require userId
  if (!data.userId) {
    throw new Error("Artifact must have a userId");
  }

  const artifact = await prisma.artifact.create({
    data: {
      userId: data.userId,
      conversationId: data.conversationId ?? null,
      sessionId: data.sessionId ?? null,
      type: data.type,
      scope: data.scope,
      title: data.title ?? null,
      content: data.content,
      scriptureRefs: data.scriptureRefs
        ? (data.scriptureRefs as unknown as Prisma.InputJsonValue)
        : undefined,
      tags: data.tags ? (data.tags as unknown as Prisma.InputJsonValue) : undefined,
      metadata: data.metadata
        ? (data.metadata as unknown as Prisma.InputJsonValue)
        : undefined,
      status: "active",
    },
  });

  // Generate embedding for semantic search (fire and forget, don't block)
  if (shouldEmbedArtifactType(artifact.type as Artifact["type"])) {
    embedArtifact(artifact.id).catch((error) => {
      console.error("[ArtifactService] Failed to embed artifact:", error);
    });
  }

  return mapPrismaArtifact(artifact);
}

// =============================================================================
// Read
// =============================================================================

export async function getArtifact(
  id: string,
  requesterId: string
): Promise<Artifact | null> {
  const artifact = await prisma.artifact.findUnique({
    where: { id },
  });

  if (!artifact) {
    return null;
  }

  // Access control
  const canAccess = checkAccess(artifact, requesterId);
  if (!canAccess) {
    return null;
  }

  return mapPrismaArtifact(artifact);
}

export async function listArtifacts(
  filters: ArtifactFilters
): Promise<Artifact[]> {
  const where: NonNullable<Parameters<typeof prisma.artifact.findMany>[0]>["where"] =
    {};

  // User filters
  if (filters.userId) {
    where.userId = filters.userId;
  }
  if (filters.sessionId) {
    where.sessionId = filters.sessionId;
  }
  if (filters.conversationId) {
    where.conversationId = filters.conversationId;
  }

  // Type/Scope filters
  if (filters.types && filters.types.length > 0) {
    where.type = { in: filters.types };
  }
  if (filters.scopes && filters.scopes.length > 0) {
    where.scope = { in: filters.scopes };
  }

  // Status filter (default to active)
  where.status = filters.status ?? "active";

  // Date range
  if (filters.createdAfter || filters.createdBefore) {
    where.createdAt = {};
    if (filters.createdAfter) {
      where.createdAt.gte = filters.createdAfter;
    }
    if (filters.createdBefore) {
      where.createdAt.lte = filters.createdBefore;
    }
  }

  // Scripture reference filter (JSON contains)
  if (filters.scriptureRef) {
    where.scriptureRefs = {
      array_contains: [filters.scriptureRef],
    };
  }

  // Tag filter (JSON contains)
  if (filters.tag) {
    where.tags = {
      array_contains: [filters.tag],
    };
  }

  const artifacts = await prisma.artifact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 50,
    skip: filters.offset ?? 0,
  });

  return artifacts.map(mapPrismaArtifact);
}

// =============================================================================
// Update
// =============================================================================

export async function updateArtifact(
  id: string,
  requesterId: string,
  data: UpdateArtifactInput
): Promise<Artifact | null> {
  // Check ownership
  const existing = await prisma.artifact.findUnique({
    where: { id },
  });

  if (!existing) {
    return null;
  }

  // Only owner can update
  if (existing.userId !== requesterId) {
    throw new Error("Only artifact owner can update");
  }

  const artifact = await prisma.artifact.update({
    where: { id },
    data: {
      title: data.title,
      content: data.content,
      scriptureRefs: data.scriptureRefs
        ? (data.scriptureRefs as unknown as Prisma.InputJsonValue)
        : undefined,
      tags: data.tags ? (data.tags as unknown as Prisma.InputJsonValue) : undefined,
      metadata: data.metadata
        ? (data.metadata as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });

  // Re-embed if content changed (fire and forget)
  if (
    (data.content || data.title || data.scriptureRefs) &&
    shouldEmbedArtifactType(artifact.type as Artifact["type"])
  ) {
    embedArtifact(artifact.id).catch((error) => {
      console.error("[ArtifactService] Failed to re-embed artifact:", error);
    });
  }

  return mapPrismaArtifact(artifact);
}

// =============================================================================
// Delete (Soft)
// =============================================================================

export async function deleteArtifact(
  id: string,
  requesterId: string
): Promise<void> {
  // Check ownership
  const existing = await prisma.artifact.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error("Artifact not found");
  }

  // Only owner can delete
  if (existing.userId !== requesterId) {
    throw new Error("Only artifact owner can delete");
  }

  await prisma.artifact.update({
    where: { id },
    data: {
      status: "deleted",
      deletedAt: new Date(),
    },
  });

  // Embeddings should not exist for deleted artifacts (even for soft delete)
  try {
    await removeEmbedding(id);
  } catch (error) {
    console.error("[ArtifactService] Failed to remove embeddings:", error);
  }
}

// =============================================================================
// Bulk Operations
// =============================================================================

export async function getArtifactsBySession(
  sessionId: string,
  requesterId: string
): Promise<Artifact[]> {
  const artifacts = await prisma.artifact.findMany({
    where: {
      sessionId,
      status: "active",
      OR: [{ userId: requesterId }, { scope: "global" }],
    },
    orderBy: { createdAt: "asc" },
  });

  return artifacts.map(mapPrismaArtifact);
}

export async function countArtifacts(filters: ArtifactFilters): Promise<number> {
  const where: NonNullable<Parameters<typeof prisma.artifact.count>[0]>["where"] =
    {};

  if (filters.userId) {
    where.userId = filters.userId;
  }
  if (filters.types && filters.types.length > 0) {
    where.type = { in: filters.types };
  }
  where.status = filters.status ?? "active";

  return prisma.artifact.count({ where });
}

// =============================================================================
// Helpers
// =============================================================================

function checkAccess(
  artifact: {
    userId: string | null;
    scope: string;
  },
  requesterId: string
): boolean {
  // Owner always has access
  if (artifact.userId === requesterId) {
    return true;
  }

  // Check scope
  switch (artifact.scope) {
    case "private":
      return artifact.userId === requesterId;

    case "global":
      return true;

    default:
      return false;
  }
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
    status: artifact.status as ArtifactStatus,
    deletedAt: artifact.deletedAt,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}
