import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";

const listSchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

// GET /api/chat/sessions?limit=50&offset=0
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = listSchema.parse({
      limit: searchParams.get("limit") ?? undefined,
      offset: searchParams.get("offset") ?? undefined,
    });

    const limit = parsed.limit ? Math.min(100, parseInt(parsed.limit, 10)) : 50;
    const offset = parsed.offset ? parseInt(parsed.offset, 10) : 0;

    const sessions = await prisma.chatSession.findMany({
      where: { userId: authResult.userId },
      orderBy: [{ endedAt: "desc" }],
      take: limit,
      skip: offset,
      select: {
        sessionId: true,
        title: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request parameters", details: error.issues }, { status: 400 });
    }
    console.error("[ChatSessionsV2] Error listing chat sessions:", error);
    return NextResponse.json({ error: "Failed to list chat sessions" }, { status: 500 });
  }
}


