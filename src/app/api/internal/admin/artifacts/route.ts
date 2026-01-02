/**
 * /api/internal/admin/artifacts
 *
 * Internal API for listing, creating, and bulk deleting artifacts.
 * Called by forge-admin-app. Protected by INTERNAL_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  ARTIFACT_TYPES,
  ARTIFACT_SCOPES,
  EMBEDDING_MODEL,
} from "@/lib/artifacts";

// =============================================================================
// Internal API Key Validation
// =============================================================================

function validateInternalApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get("x-internal-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.error("[INTERNAL-API] INTERNAL_API_KEY not configured");
    return false;
  }

  return apiKey === expectedKey;
}

// =============================================================================
// Validation Schemas
// =============================================================================

const createArtifactSchema = z.object({
  userId: z.string().min(1),
  groupId: z.string().optional(),
  type: z.enum(ARTIFACT_TYPES as unknown as [string, ...string[]]),
  scope: z.enum(ARTIFACT_SCOPES as unknown as [string, ...string[]]),
  title: z.string().optional(),
  content: z.string().min(1),
  scriptureRefs: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// =============================================================================
// GET Handler - List Artifacts
// =============================================================================

export async function GET(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);

    // Parse query params
    const userId = searchParams.get("userId") || "";
    const type = searchParams.get("type") || "";
    const scope = searchParams.get("scope") || "";
    const status = searchParams.get("status") || "active";
    const search = searchParams.get("search") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

    // Build where clause
    const where: Prisma.ArtifactWhereInput = {};

    if (userId) {
      where.userId = userId;
    }

    if (type && type !== "all") {
      where.type = type;
    }

    if (scope && scope !== "all") {
      where.scope = scope;
    }

    if (status && status !== "all") {
      where.status = status;
    }

    // Search in title and content
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Get total count
    const total = await prisma.artifact.count({ where });

    // Get artifacts with user info and embedding status
    const artifacts = await prisma.artifact.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
        embeddings: {
          where: { model: EMBEDDING_MODEL },
          select: { id: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Transform response
    const transformedArtifacts = artifacts.map((artifact) => ({
      id: artifact.id,
      userId: artifact.userId,
      groupId: artifact.groupId,
      type: artifact.type,
      scope: artifact.scope,
      title: artifact.title,
      contentPreview: artifact.content.substring(0, 200) + (artifact.content.length > 200 ? "..." : ""),
      scriptureRefs: artifact.scriptureRefs,
      tags: artifact.tags,
      status: artifact.status,
      hasEmbedding: artifact.embeddings.length > 0,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
      user: artifact.user ? {
        id: artifact.user.id,
        email: artifact.user.email,
        displayName: artifact.user.displayName,
      } : null,
    }));

    // Get type breakdown for stats
    const typeStats = await prisma.artifact.groupBy({
      by: ["type"],
      where: { status: "active" },
      _count: { type: true },
    });

    return NextResponse.json({
      success: true,
      artifacts: transformedArtifacts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        byType: Object.fromEntries(
          typeStats.map((s) => [s.type, s._count.type])
        ),
      },
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error listing artifacts:", error);
    return NextResponse.json(
      { error: "Failed to list artifacts" },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST Handler - Create Artifact
// =============================================================================

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const validated = createArtifactSchema.parse(body);

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: validated.userId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Create artifact
    const artifact = await prisma.artifact.create({
      data: {
        userId: validated.userId,
        groupId: validated.groupId ?? null,
        type: validated.type,
        scope: validated.scope,
        title: validated.title ?? null,
        content: validated.content,
        scriptureRefs: validated.scriptureRefs ?? Prisma.JsonNull,
        tags: validated.tags ?? Prisma.JsonNull,
        metadata: validated.metadata ?? Prisma.JsonNull,
        status: "active",
      },
    });

    // Fetch artifact with user for response
    const artifactWithUser = await prisma.artifact.findUnique({
      where: { id: artifact.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });

    console.log(`[INTERNAL-API] Created artifact ${artifact.id} for user ${artifactWithUser?.user?.email}`);

    // Embedding is handled by artifactService; keep request fast and avoid double-embedding.
    // (If you later want synchronous embedding here, gate it via shouldEmbedArtifactType.)

    return NextResponse.json({
      success: true,
      artifact: {
        id: artifact.id,
        userId: artifact.userId,
        groupId: artifact.groupId,
        type: artifact.type,
        scope: artifact.scope,
        title: artifact.title,
        content: artifact.content,
        scriptureRefs: artifact.scriptureRefs,
        tags: artifact.tags,
        status: artifact.status,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
        user: artifactWithUser?.user,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("[INTERNAL-API] Error creating artifact:", error);
    return NextResponse.json(
      { error: "Failed to create artifact" },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE Handler - Bulk Delete Artifacts by User
// =============================================================================

export async function DELETE(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required for bulk delete" },
        { status: 400 }
      );
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Get artifact IDs for cascade delete of embeddings and edges
    const artifactIds = await prisma.artifact.findMany({
      where: { userId },
      select: { id: true },
    });

    const ids = artifactIds.map((a) => a.id);

    // Delete edges first
    await prisma.artifactEdge.deleteMany({
      where: {
        OR: [
          { fromId: { in: ids } },
          { toId: { in: ids } },
        ],
      },
    });

    // Delete embeddings (should cascade, but explicit for safety)
    await prisma.artifactEmbedding.deleteMany({
      where: { artifactId: { in: ids } },
    });

    // Delete artifacts
    const result = await prisma.artifact.deleteMany({
      where: { userId },
    });

    console.log(`[INTERNAL-API] Deleted ${result.count} artifacts for user ${user.email}`);

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
      userId,
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error bulk deleting artifacts:", error);
    return NextResponse.json(
      { error: "Failed to delete artifacts" },
      { status: 500 }
    );
  }
}
