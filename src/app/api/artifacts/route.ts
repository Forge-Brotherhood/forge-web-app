import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { z } from "zod";
import {
  createArtifact,
  listArtifacts,
  ARTIFACT_TYPES,
  ARTIFACT_SCOPES,
} from "@/lib/artifacts";

// Validation schemas
const listArtifactsSchema = z.object({
  types: z.string().optional(), // comma-separated
  scopes: z.string().optional(), // comma-separated
  sessionId: z.string().optional(),
  conversationId: z.string().optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  scriptureRef: z.string().optional(),
  tag: z.string().optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

const createArtifactSchema = z.object({
  type: z.enum(ARTIFACT_TYPES as unknown as [string, ...string[]]),
  scope: z.enum(ARTIFACT_SCOPES as unknown as [string, ...string[]]),
  title: z.string().optional(),
  // Allow metadata-only artifacts (e.g. highlights) to use an empty string
  content: z.string(),
  conversationId: z.string().optional(),
  sessionId: z.string().optional(),
  scriptureRefs: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// GET /api/artifacts - List artifacts with filters
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const params = {
      types: searchParams.get("types") || undefined,
      scopes: searchParams.get("scopes") || undefined,
      sessionId: searchParams.get("sessionId") || undefined,
      conversationId: searchParams.get("conversationId") || undefined,
      createdAfter: searchParams.get("createdAfter") || undefined,
      createdBefore: searchParams.get("createdBefore") || undefined,
      scriptureRef: searchParams.get("scriptureRef") || undefined,
      tag: searchParams.get("tag") || undefined,
      limit: searchParams.get("limit") || undefined,
      offset: searchParams.get("offset") || undefined,
    };

    const validated = listArtifactsSchema.parse(params);

    const artifacts = await listArtifacts({
      userId: authResult.userId,
      types: validated.types?.split(",") as typeof ARTIFACT_TYPES[number][] | undefined,
      scopes: validated.scopes?.split(",") as typeof ARTIFACT_SCOPES[number][] | undefined,
      sessionId: validated.sessionId,
      conversationId: validated.conversationId,
      createdAfter: validated.createdAfter ? new Date(validated.createdAfter) : undefined,
      createdBefore: validated.createdBefore ? new Date(validated.createdBefore) : undefined,
      scriptureRef: validated.scriptureRef,
      tag: validated.tag,
      limit: validated.limit ? parseInt(validated.limit, 10) : undefined,
      offset: validated.offset ? parseInt(validated.offset, 10) : undefined,
    });

    return NextResponse.json({
      success: true,
      artifacts: artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        scope: a.scope,
        title: a.title,
        content: a.content,
        scriptureRefs: a.scriptureRefs,
        tags: a.tags,
        metadata: a.metadata,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request parameters", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error listing artifacts:", error);
    return NextResponse.json(
      { error: "Failed to list artifacts" },
      { status: 500 }
    );
  }
}

// POST /api/artifacts - Create artifact
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createArtifactSchema.parse(body);

    const artifact = await createArtifact({
      userId: authResult.userId,
      type: validated.type as typeof ARTIFACT_TYPES[number],
      scope: validated.scope as typeof ARTIFACT_SCOPES[number],
      title: validated.title,
      content: validated.content,
      conversationId: validated.conversationId,
      sessionId: validated.sessionId,
      scriptureRefs: validated.scriptureRefs,
      tags: validated.tags,
      metadata: validated.metadata,
    });

    return NextResponse.json(
      {
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
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating artifact:", error);
    return NextResponse.json(
      { error: "Failed to create artifact" },
      { status: 500 }
    );
  }
}
