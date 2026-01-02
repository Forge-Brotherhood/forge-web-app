import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { embedArtifact, getArtifact, hasEmbedding } from "@/lib/artifacts";

// POST /api/artifacts/:id/embed - Trigger embedding for an artifact
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify access
    const artifact = await getArtifact(id, authResult.userId);
    if (!artifact) {
      return NextResponse.json(
        { error: "Artifact not found or access denied" },
        { status: 404 }
      );
    }

    // Only owner can trigger embedding
    if (artifact.userId !== authResult.userId) {
      return NextResponse.json(
        { error: "Only artifact owner can trigger embedding" },
        { status: 403 }
      );
    }

    // Check if already embedded
    const alreadyEmbedded = await hasEmbedding(id);

    // Embed the artifact
    await embedArtifact(id);

    return NextResponse.json({
      success: true,
      wasAlreadyEmbedded: alreadyEmbedded,
      message: alreadyEmbedded ? "Embedding updated" : "Embedding created",
    });
  } catch (error) {
    console.error("Error embedding artifact:", error);
    return NextResponse.json(
      { error: "Failed to embed artifact" },
      { status: 500 }
    );
  }
}

// GET /api/artifacts/:id/embed - Check embedding status
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

    // Verify access
    const artifact = await getArtifact(id, authResult.userId);
    if (!artifact) {
      return NextResponse.json(
        { error: "Artifact not found or access denied" },
        { status: 404 }
      );
    }

    const embedded = await hasEmbedding(id);

    return NextResponse.json({
      success: true,
      embedded,
    });
  } catch (error) {
    console.error("Error checking embedding:", error);
    return NextResponse.json(
      { error: "Failed to check embedding status" },
      { status: 500 }
    );
  }
}
