import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  retrieveForContext,
  ARTIFACT_TYPES,
} from "@/lib/artifacts";

// Validation schema
const searchSchema = z.object({
  query: z.string().min(1),
  types: z.array(z.enum(ARTIFACT_TYPES as unknown as [string, ...string[]])).optional(),
  limit: z.number().min(1).max(20).optional(),
  includeGroupArtifacts: z.boolean().optional(),
});

// POST /api/artifacts/search - Semantic search
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = searchSchema.parse(body);

    // Get user's group memberships for access control
    const memberships = await prisma.groupMember.findMany({
      where: { userId: authResult.userId, status: "active" },
      select: { groupId: true },
    });
    const groupIds = memberships.map((m) => m.groupId);

    // Perform semantic search
    const result = await retrieveForContext({
      query: validated.query,
      userId: authResult.userId,
      groupIds,
      types: validated.types as typeof ARTIFACT_TYPES[number][] | undefined,
      limit: validated.limit ?? 5,
      includeGroupArtifacts: validated.includeGroupArtifacts ?? true,
    });

    return NextResponse.json({
      success: true,
      artifacts: result.artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        scope: a.scope,
        title: a.title,
        content: a.content,
        scriptureRefs: a.scriptureRefs,
        tags: a.tags,
        createdAt: a.createdAt.toISOString(),
      })),
      snippets: result.snippets,
      formattedContext: result.formattedContext,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error searching artifacts:", error);
    return NextResponse.json(
      { error: "Failed to search artifacts" },
      { status: 500 }
    );
  }
}
