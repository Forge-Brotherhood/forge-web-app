/**
 * /api/internal/admin/artifacts/[id]
 *
 * Internal API for single artifact CRUD operations.
 * GET - Fetch single artifact with edges
 * PATCH - Update artifact
 * DELETE - Hard delete artifact
 * POST - Trigger embedding (action: "embed")
 *
 * Called by forge-admin-app. Protected by INTERNAL_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { embedArtifact, EMBEDDING_MODEL } from "@/lib/artifacts";

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

const updateSchema = z.object({
  title: z.string().optional(),
  content: z.string().min(1).optional(),
  scriptureRefs: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  status: z.enum(["active", "deleted"]).optional(),
});

const actionSchema = z.object({
  action: z.enum(["embed"]),
});

// =============================================================================
// GET Handler - Single Artifact with Edges
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    const artifact = await prisma.artifact.findUnique({
      where: { id },
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
          select: { id: true, model: true, dimension: true, createdAt: true },
        },
        edgesFrom: {
          include: {
            to: {
              select: {
                id: true,
                type: true,
                title: true,
                content: true,
              },
            },
          },
        },
        edgesTo: {
          include: {
            from: {
              select: {
                id: true,
                type: true,
                title: true,
                content: true,
              },
            },
          },
        },
      },
    });

    if (!artifact) {
      return NextResponse.json(
        { error: "Artifact not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      artifact: {
        id: artifact.id,
        userId: artifact.userId,
        conversationId: artifact.conversationId,
        sessionId: artifact.sessionId,
        type: artifact.type,
        scope: artifact.scope,
        title: artifact.title,
        content: artifact.content,
        scriptureRefs: artifact.scriptureRefs,
        tags: artifact.tags,
        metadata: artifact.metadata,
        status: artifact.status,
        deletedAt: artifact.deletedAt?.toISOString() ?? null,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
        user: artifact.user,
        hasEmbedding: artifact.embeddings.length > 0,
        embedding: artifact.embeddings[0] ? {
          model: artifact.embeddings[0].model,
          dimension: artifact.embeddings[0].dimension,
          createdAt: artifact.embeddings[0].createdAt.toISOString(),
        } : null,
        edgesFrom: artifact.edgesFrom.map((edge) => ({
          id: edge.id,
          relation: edge.relation,
          to: {
            id: edge.to.id,
            type: edge.to.type,
            title: edge.to.title,
            contentPreview: edge.to.content.substring(0, 100),
          },
        })),
        edgesTo: artifact.edgesTo.map((edge) => ({
          id: edge.id,
          relation: edge.relation,
          from: {
            id: edge.from.id,
            type: edge.from.type,
            title: edge.from.title,
            contentPreview: edge.from.content.substring(0, 100),
          },
        })),
      },
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error fetching artifact:", error);
    return NextResponse.json(
      { error: "Failed to fetch artifact" },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH Handler - Update Artifact
// =============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    // Check artifact exists
    const existing = await prisma.artifact.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Artifact not found" },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const updates = updateSchema.parse(body);

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (updates.title !== undefined) {
      updateData.title = updates.title;
    }
    if (updates.content !== undefined) {
      updateData.content = updates.content;
    }
    if (updates.scriptureRefs !== undefined) {
      updateData.scriptureRefs = updates.scriptureRefs;
    }
    if (updates.tags !== undefined) {
      updateData.tags = updates.tags;
    }
    if (updates.metadata !== undefined) {
      updateData.metadata = updates.metadata;
    }
    if (updates.status !== undefined) {
      updateData.status = updates.status;
      if (updates.status === "deleted") {
        updateData.deletedAt = new Date();
      } else {
        updateData.deletedAt = null;
      }
    }

    // Update artifact
    const updated = await prisma.artifact.update({
      where: { id },
      data: updateData,
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

    console.log(`[INTERNAL-API] Updated artifact ${id}`);

    return NextResponse.json({
      success: true,
      artifact: {
        id: updated.id,
        userId: updated.userId,
        type: updated.type,
        scope: updated.scope,
        title: updated.title,
        content: updated.content,
        scriptureRefs: updated.scriptureRefs,
        tags: updated.tags,
        metadata: updated.metadata,
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        user: updated.user,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("[INTERNAL-API] Error updating artifact:", error);
    return NextResponse.json(
      { error: "Failed to update artifact" },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE Handler - Hard Delete Artifact
// =============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    // Check artifact exists
    const existing = await prisma.artifact.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Artifact not found" },
        { status: 404 }
      );
    }

    // Delete edges first
    await prisma.artifactEdge.deleteMany({
      where: {
        OR: [{ fromId: id }, { toId: id }],
      },
    });

    // Delete embeddings (should cascade, but explicit)
    await prisma.artifactEmbedding.deleteMany({
      where: { artifactId: id },
    });

    // Delete artifact
    await prisma.artifact.delete({
      where: { id },
    });

    console.log(`[INTERNAL-API] Deleted artifact ${id}`);

    return NextResponse.json({
      success: true,
      deletedId: id,
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error deleting artifact:", error);
    return NextResponse.json(
      { error: "Failed to delete artifact" },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST Handler - Actions (embed)
// =============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { action } = actionSchema.parse(body);

    // Check artifact exists
    const existing = await prisma.artifact.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Artifact not found" },
        { status: 404 }
      );
    }

    if (existing.status !== "active") {
      return NextResponse.json(
        { error: "Cannot embed deleted artifact" },
        { status: 400 }
      );
    }

    if (action === "embed") {
      await embedArtifact(id);

      console.log(`[INTERNAL-API] Embedded artifact ${id}`);

      return NextResponse.json({
        success: true,
        action: "embed",
        artifactId: id,
      });
    }

    return NextResponse.json(
      { error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("[INTERNAL-API] Error performing action:", error);
    return NextResponse.json(
      { error: "Failed to perform action" },
      { status: 500 }
    );
  }
}
