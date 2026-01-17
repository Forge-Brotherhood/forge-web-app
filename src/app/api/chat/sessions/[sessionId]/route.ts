import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";

const paramsSchema = z.object({
  sessionId: z.string().min(1).max(128),
});

// GET /api/chat/sessions/:sessionId
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = paramsSchema.parse(await params);

    // Legacy storage includes `kind`; we intentionally ignore it and fetch the most recent matching sessionId.
    const session = await prisma.chatSession.findFirst({
      where: { userId: authResult.userId, sessionId },
      orderBy: [{ endedAt: "desc" }],
      include: {
        messages: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            role: true,
            content: true,
            actions: true,
            clientTimestamp: true,
            createdAt: true,
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      transcript: {
        sessionId: session.sessionId,
        title: session.title,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        messages: session.messages.map((m) => ({
          role: m.role,
          content: m.content,
          actions: m.actions ?? null,
          timestamp: m.clientTimestamp ?? m.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request parameters", details: error.issues }, { status: 400 });
    }
    console.error("[ChatSessionsV2] Error fetching transcript:", error);
    return NextResponse.json({ error: "Failed to fetch transcript" }, { status: 500 });
  }
}


