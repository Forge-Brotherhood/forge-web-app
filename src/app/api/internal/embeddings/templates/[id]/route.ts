import { NextRequest, NextResponse } from "next/server";
import {
  embedTemplate,
  removeTemplateEmbedding,
} from "@/lib/readingPlan/templateEmbeddingService";

/**
 * Internal API for managing reading plan template embeddings.
 * Called by the admin app when templates are published/unpublished.
 *
 * Security: Protected by INTERNAL_API_KEY shared between apps.
 */

function validateInternalApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get("x-internal-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.error("[embeddings/templates] INTERNAL_API_KEY not configured");
    return false;
  }

  return apiKey === expectedKey;
}

// POST /api/internal/embeddings/templates/[id]
// Generate or update embedding for a template
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await embedTemplate(id);
    return NextResponse.json({ success: true, action: "embedded" });
  } catch (error) {
    console.error(`[embeddings/templates] Error embedding ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to embed template", details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/internal/embeddings/templates/[id]
// Remove embedding for a template
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await removeTemplateEmbedding(id);
    return NextResponse.json({ success: true, action: "removed" });
  } catch (error) {
    console.error(`[embeddings/templates] Error removing embedding ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to remove embedding", details: String(error) },
      { status: 500 }
    );
  }
}
