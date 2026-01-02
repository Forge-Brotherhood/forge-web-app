import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { z } from "zod";
import {
  getArtifact,
  updateArtifact,
  deleteArtifact,
} from "@/lib/artifacts";

// Validation schema
const updateArtifactSchema = z.object({
  title: z.string().optional(),
  content: z.string().min(1).optional(),
  scriptureRefs: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// GET /api/artifacts/:id - Get single artifact
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const artifact = await getArtifact(id, authResult.userId);

    if (!artifact) {
      return NextResponse.json(
        { error: "Artifact not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      artifact: {
        id: artifact.id,
        type: artifact.type,
        scope: artifact.scope,
        title: artifact.title,
        content: artifact.content,
        scriptureRefs: artifact.scriptureRefs,
        tags: artifact.tags,
        metadata: artifact.metadata,
        userId: artifact.userId,
        groupId: artifact.groupId,
        conversationId: artifact.conversationId,
        sessionId: artifact.sessionId,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching artifact:", error);
    return NextResponse.json(
      { error: "Failed to fetch artifact" },
      { status: 500 }
    );
  }
}

// PATCH /api/artifacts/:id - Update artifact
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const validated = updateArtifactSchema.parse(body);

    const artifact = await updateArtifact(id, authResult.userId, validated);

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
        type: artifact.type,
        scope: artifact.scope,
        title: artifact.title,
        content: artifact.content,
        scriptureRefs: artifact.scriptureRefs,
        tags: artifact.tags,
        metadata: artifact.metadata,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message.includes("Only artifact owner")) {
      return NextResponse.json(
        { error: "Only artifact owner can update" },
        { status: 403 }
      );
    }
    console.error("Error updating artifact:", error);
    return NextResponse.json(
      { error: "Failed to update artifact" },
      { status: 500 }
    );
  }
}

// DELETE /api/artifacts/:id - Soft delete artifact
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    await deleteArtifact(id, authResult.userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Artifact not found")) {
      return NextResponse.json(
        { error: "Artifact not found" },
        { status: 404 }
      );
    }
    if (error instanceof Error && error.message.includes("Only artifact owner")) {
      return NextResponse.json(
        { error: "Only artifact owner can delete" },
        { status: 403 }
      );
    }
    console.error("Error deleting artifact:", error);
    return NextResponse.json(
      { error: "Failed to delete artifact" },
      { status: 500 }
    );
  }
}
