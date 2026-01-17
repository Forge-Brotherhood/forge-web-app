import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatSessionMessageSchema, saveChatSessionTranscript } from "@/lib/chatSessions/saveChatSession";
import { generateAndCreateSessionSummaryArtifact } from "@/lib/artifacts/sessionSummaryService";
import { consolidateUserMemoryOnChatEnd } from "@/lib/memory/userMemoryConsolidator";

export const runtime = "nodejs";

const requestSchema = z.object({
  conversationId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128).optional(),
  startedAtISO: z.string().datetime().optional(),
  endedAtISO: z.string().datetime().optional(),
  messages: z.array(chatSessionMessageSchema).min(2).max(500),
});

const hasConversationSubstance = (turns: Array<{ role: string; content: string }>): boolean => {
  if (turns.length < 2) return false;
  return turns.some((t) => t.role === "user" && t.content.trim().length > 0);
};

// POST /api/chat/end
// Persist transcript + generate session summary + consolidate session notes + cleanup.
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const input = requestSchema.parse(body);

    const endedAtISO = input.endedAtISO ?? new Date().toISOString();
    const transcriptSave = await saveChatSessionTranscript({
      userId: authResult.userId,
      // Legacy storage still has `kind`; assistant is always Guide, so we store a constant.
      kind: "guide",
      transcript: {
        sessionId: input.sessionId ?? input.conversationId,
        startedAtISO: input.startedAtISO,
        endedAtISO,
        messages: input.messages,
      },
    });

    const turns: Array<{ role: string; content: string }> = input.messages
      .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
      .filter((t) => t.content.trim().length > 0);

    let sessionSummaryCreated = false;
    if (hasConversationSubstance(turns)) {
      // Idempotency: if artifact already exists for this session, don't create another.
      const existing = await prisma.artifact.findFirst({
        where: {
          userId: authResult.userId,
          sessionId: input.conversationId,
          type: "conversation_session_summary",
          status: "active",
        },
        select: { id: true },
      });

      if (!existing) {
        await generateAndCreateSessionSummaryArtifact({
          userId: authResult.userId,
          sessionId: input.conversationId,
          turns,
          metadata: {
            source: "api_chat_end",
            turnCount: turns.length,
            generatedAt: new Date().toISOString(),
          },
        });
        sessionSummaryCreated = true;
      }
    }

    const consolidation = await consolidateUserMemoryOnChatEnd({
      userId: authResult.userId,
      conversationId: input.conversationId,
    });

    // Cleanup managed conversation pointer (best-effort). Session notes already deleted in consolidator.
    await prisma.chatConversation.delete({ where: { conversationId: input.conversationId } }).catch(() => {});

    return NextResponse.json({
      success: true,
      savedTranscript: transcriptSave.saved,
      sessionSummaryCreated,
      consolidated: consolidation.stats,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request data", details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to end chat", details: message }, { status: 500 });
  }
}


