import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateChatSessionTitle } from "@/lib/chatSessions/titleService";

export const chatSessionKindSchema = z.enum(["guide", "bible"]);
export type ChatSessionKind = z.infer<typeof chatSessionKindSchema>;

export const chatSessionMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  actions: z.unknown().optional(),
  timestamp: z.string().optional(),
});

export const chatSessionTranscriptSchema = z.object({
  sessionId: z.string().min(1).max(128),
  startedAtISO: z.string().datetime().optional(),
  endedAtISO: z.string().datetime(),
  messages: z.array(chatSessionMessageSchema).max(500),
});

export type ChatSessionTranscriptInput = z.infer<typeof chatSessionTranscriptSchema>;

const hasConversationSubstance = (messages: Array<{ role: string; content: string }>): boolean => {
  if (messages.length < 2) return false;
  return messages.some((m) => m.role === "user" && m.content.trim().length > 0);
};

export type SaveChatSessionResult =
  | { saved: true; session: { sessionId: string; title: string } }
  | { saved: false; reason: "too_short" };

export const saveChatSessionTranscript = async (args: {
  userId: string;
  kind: ChatSessionKind;
  transcript: ChatSessionTranscriptInput;
}): Promise<SaveChatSessionResult> => {
  const normalizedMessages = args.transcript.messages
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? ""),
      actions: m.actions,
      timestamp: m.timestamp,
    }))
    .filter((m) => m.content.trim().length > 0);

  if (!hasConversationSubstance(normalizedMessages)) return { saved: false, reason: "too_short" };

  const startedAt = args.transcript.startedAtISO
    ? new Date(args.transcript.startedAtISO)
    : new Date(args.transcript.endedAtISO);
  const endedAt = new Date(args.transcript.endedAtISO);

  const title = await generateChatSessionTitle({
    kind: args.kind,
    turns: normalizedMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const saved = await prisma.$transaction(async (tx) => {
    const session = await tx.chatSession.upsert({
      where: {
        userId_kind_sessionId: {
          userId: args.userId,
          kind: args.kind,
          sessionId: args.transcript.sessionId,
        },
      },
      update: {
        title,
        endedAt,
      },
      create: {
        userId: args.userId,
        kind: args.kind,
        sessionId: args.transcript.sessionId,
        title,
        startedAt,
        endedAt,
      },
      select: { id: true },
    });

    await tx.chatMessage.deleteMany({ where: { chatSessionId: session.id } });

    if (normalizedMessages.length > 0) {
      await tx.chatMessage.createMany({
        data: normalizedMessages.map((m) => ({
          chatSessionId: session.id,
          role: m.role,
          content: m.content,
          actions: m.actions ?? undefined,
          clientTimestamp: m.timestamp ?? undefined,
        })),
      });
    }

    return { sessionId: args.transcript.sessionId, title };
  });

  return { saved: true, session: saved };
};


