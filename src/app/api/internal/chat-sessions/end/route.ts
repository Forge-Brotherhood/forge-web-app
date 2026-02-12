import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/app/api/internal/suggestion-debugger/_internalApiKey";
import { saveChatSessionTranscript, chatSessionMessageSchema } from "@/lib/chatSessions/saveChatSession";
import { consolidateUserMemoryOnChatEnd } from "@/lib/memory/userMemoryConsolidator";

export const runtime = "nodejs";

const requestSchema = z.object({
  impersonatedUserId: z.string().min(1),
  conversationId: z.string().min(1).max(128),
  startedAtISO: z.string().datetime().optional(),
  endedAtISO: z.string().datetime().optional(),
  messages: z.array(chatSessionMessageSchema).max(500),
});

type ConsolidationResult = {
  savedTranscript: boolean;
  consolidated: {
    sessionNotesIn: number;
    sessionNotesInUnexpired: number;
    globalNotesIn: number;
    globalNotesOut: number;
    usedFallback: boolean;
  };
  sessionNotesUsed: Array<{ text: string; keywords: string[]; expiresAtISO?: string }>;
};

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Invalid or missing internal API key" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const input = requestSchema.parse(body);

    // Verify impersonated user exists
    const user = await prisma.user.findUnique({
      where: { id: input.impersonatedUserId },
      select: { id: true },
    });
    if (!user) return NextResponse.json({ error: "Impersonated user not found" }, { status: 404 });

    // Retrieve the OpenAI conversation ID before cleanup so we can preserve it in ChatSession
    const chatConversation = await prisma.chatConversation.findUnique({
      where: { conversationId: input.conversationId },
      select: { openaiConversationId: true },
    });

    // Save transcript (as a "guide" session)
    const endedAtISO = input.endedAtISO ?? new Date().toISOString();
    const saved = await saveChatSessionTranscript({
      userId: user.id,
      kind: "guide",
      openaiConversationId: chatConversation?.openaiConversationId ?? null,
      transcript: {
        sessionId: input.conversationId,
        startedAtISO: input.startedAtISO,
        endedAtISO,
        messages: input.messages,
      },
    });

    const sessionNotesRaw = await prisma.chatSessionMemoryNote.findMany({
      where: { conversationId: input.conversationId, userId: user.id },
      orderBy: [{ createdAt: "desc" }],
      take: 50,
      select: { text: true, keywords: true, expiresAt: true },
    });
    const sessionNotes: Array<{ text: string; keywords?: string[]; expiresAtISO?: string }> = sessionNotesRaw
      .map((n) => ({
        text: typeof n.text === "string" ? n.text : "",
        keywords: Array.isArray(n.keywords) ? n.keywords.slice(0, 8) : [],
        ...(n.expiresAt ? { expiresAtISO: n.expiresAt.toISOString() } : {}),
      }))
      .filter((n) => n.text.trim().length > 0);

    const consolidation = await consolidateUserMemoryOnChatEnd({
      userId: user.id,
      conversationId: input.conversationId,
    });

    const result: ConsolidationResult = {
      savedTranscript: saved.saved,
      consolidated: {
        sessionNotesIn: consolidation.stats.sessionNotesIn,
        sessionNotesInUnexpired: consolidation.stats.sessionNotesInUnexpired,
        globalNotesIn: consolidation.stats.globalNotesIn,
        globalNotesOut: consolidation.stats.globalNotesOut,
        usedFallback: consolidation.stats.usedFallback,
      },
      sessionNotesUsed: sessionNotes.map((n) => ({
        text: n.text,
        keywords: Array.isArray(n.keywords) ? n.keywords.slice(0, 8) : [],
        ...(typeof n.expiresAtISO === "string" && n.expiresAtISO ? { expiresAtISO: n.expiresAtISO } : {}),
      })),
    };

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request data", details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to end chat session", details: message }, { status: 500 });
  }
}


