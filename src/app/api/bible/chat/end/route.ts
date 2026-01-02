import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  deleteConversationState,
  getConversationState,
  type ConversationMessage,
} from "@/lib/conversation";
import { generateAndCreateSessionSummaryArtifact } from "@/lib/artifacts/sessionSummaryService";

const requestSchema = z.object({
  conversationId: z.string().min(1).max(128),
  verseReference: z.string().min(1).max(200).optional(),
  verseText: z.string().min(1).max(5000).optional(),
});

type EndChatResponse =
  | { saved: true; reason: "created" | "already_exists" }
  | { saved: false; reason: "no_state" | "too_short" };

function hasConversationSubstance(turns: Array<{ role: string; content: string }>): boolean {
  if (turns.length < 2) return false;
  return turns.some((t) => t.role === "user" && t.content.trim().length > 0);
}

export async function POST(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const input = requestSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Idempotency: if artifact already exists for this sessionId, don't create another.
    const existing = await prisma.artifact.findFirst({
      where: {
        userId: user.id,
        sessionId: input.conversationId,
        type: "conversation_session_summary",
        status: "active",
      },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json<EndChatResponse>({
        saved: true,
        reason: "already_exists",
      });
    }

    const state = await getConversationState(input.conversationId, user.id);
    if (!state) {
      return NextResponse.json<EndChatResponse>({
        saved: false,
        reason: "no_state",
      });
    }

    const turns: Array<{ role: string; content: string }> = [];

    if (state.summary?.trim()) {
      turns.push({
        role: "assistant",
        content: `[Previous conversation context: ${state.summary}]`,
      });
    }

    const recent = (state.recentMessages || []) as ConversationMessage[];
    for (const msg of recent) {
      // Safety: only keep user/assistant roles
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const content = String(msg.content ?? "");
      if (!content.trim()) continue;
      turns.push({ role: msg.role, content });
    }

    if (!hasConversationSubstance(turns)) {
      return NextResponse.json<EndChatResponse>({
        saved: false,
        reason: "too_short",
      });
    }

    await generateAndCreateSessionSummaryArtifact({
      userId: user.id,
      sessionId: input.conversationId,
      turns,
      metadata: {
        source: "ios",
        verseReference: input.verseReference,
        turnCount: state.turnCount,
        generatedAt: new Date().toISOString(),
      },
    });

    // Cleanup stored state after artifact creation.
    await deleteConversationState(input.conversationId);

    return NextResponse.json<EndChatResponse>({
      saved: true,
      reason: "created",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    console.error("[ChatEnd] Failed to end chat:", error);
    return NextResponse.json({ error: "Failed to end chat" }, { status: 500 });
  }
}


