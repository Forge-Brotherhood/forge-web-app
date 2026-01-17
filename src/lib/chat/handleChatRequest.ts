import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  buildContextToolsForUser,
  executeContextToolCall,
  type ContextToolCall as AppContextToolCall,
} from "@/lib/chat/tools/contextTools";
import type { ContextToolCall } from "@/lib/openai/responsesClient";
import { validateInternalApiKey } from "@/app/api/internal/suggestion-debugger/_internalApiKey";
import { extractUiActionsDeterministic, type AIAction } from "@/lib/openai/structuredActions";
import { buildChatContextBundle, type ChatEntrypoint, type ChatMode } from "@/lib/chat/chatContextBundle";
import { runMainChatResponse } from "@/lib/chat/runMainChatResponse";
import { runSuggestedQuestions } from "@/lib/chat/runSuggestedQuestions";

type SSEEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; callId: string; name: string; argumentsJson: string }
  | { type: "tool_result"; callId: string; name: string; output: string }
  | { type: "injection"; blockText: string; globalCount: number; sessionCount: number }
  | { type: "actions"; actions: AIAction[] }
  | { type: "suggested_questions"; questions: string[] }
  | { type: "done"; conversationId: string }
  | { type: "error"; message: string };

const sseEncode = (evt: SSEEvent) => `data: ${JSON.stringify(evt)}\n\n`;

const truncateForSse = (text: string, maxLen: number) =>
  text.length > maxLen ? `${text.slice(0, Math.max(0, maxLen - 1))}…` : text;

const isBibleReaderStart = (args: {
  entrypoint: ChatEntrypoint;
  mode: ChatMode;
  previousResponseId: string | null;
}) => args.entrypoint === "bible_reader" && args.mode === "bible" && !args.previousResponseId;

const resolveUserId = async (args: {
  isInternalBypass: boolean;
  impersonateUserId: string | null;
  clerkUserId: string | null;
}): Promise<string | null> => {
  const user = args.isInternalBypass
    ? await prisma.user.findUnique({
        where: { id: args.impersonateUserId!.trim() },
        select: { id: true },
      })
    : await prisma.user.findUnique({
        where: { clerkId: args.clerkUserId as string },
        select: { id: true },
      });
  return user?.id ?? null;
};

const upsertConversation = async (args: {
  conversationId: string;
  userId: string;
  entrypoint: ChatEntrypoint;
  mode: ChatMode;
}): Promise<{ previousResponseId: string | null }> => {
  const conversation = await prisma.chatConversation.upsert({
    where: { conversationId: args.conversationId },
    create: {
      conversationId: args.conversationId,
      userId: args.userId,
      entrypoint: args.entrypoint,
      mode: args.mode,
      previousResponseId: null,
    },
    update: {
      entrypoint: args.entrypoint,
      mode: args.mode,
      updatedAt: new Date(),
    },
    select: { userId: true, previousResponseId: true },
  });

  if (conversation.userId !== args.userId) throw new Error("Conversation belongs to a different user");
  return { previousResponseId: conversation.previousResponseId ?? null };
};

export type ChatSurface = "general" | "bible";

export type HandleChatInput = {
  conversationId?: string;
  message: string;
  entrypoint?: ChatEntrypoint;
  mode?: ChatMode;
  verseReference?: string;
  verseText?: string;
  selectionState?: "selected" | "visible";
  includeSuggestedQuestions?: boolean;
};

export async function handleChatRequest(args: {
  request: NextRequest;
  surface: ChatSurface;
  input: HandleChatInput;
  force?: { entrypoint?: ChatEntrypoint; mode?: ChatMode };
}): Promise<Response> {
  const requestStartTime = Date.now();

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return new Response(JSON.stringify({ error: "AI service not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const wantsStream =
    (args.request.headers.get("accept") ?? "").includes("text/event-stream") ||
    new URL(args.request.url).searchParams.get("stream") === "1";

  const impersonateUserId = args.request.headers.get("x-impersonate-user-id");
  const isInternalBypass =
    validateInternalApiKey(args.request) &&
    typeof impersonateUserId === "string" &&
    impersonateUserId.trim().length > 0;

  const { userId: clerkUserId } = isInternalBypass ? { userId: null } : await auth();
  if (!isInternalBypass && !clerkUserId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const resolvedUserId = await resolveUserId({
    isInternalBypass,
    impersonateUserId: impersonateUserId?.trim() ?? null,
    clerkUserId: (clerkUserId as string | null) ?? null,
  });
  if (!resolvedUserId) {
    const payload = JSON.stringify({ error: "User not found" });
    return new Response(payload, {
      status: wantsStream ? 200 : 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const conversationId =
    typeof args.input.conversationId === "string" && args.input.conversationId.trim()
      ? args.input.conversationId.trim()
      : crypto.randomUUID();

  const entrypoint = (args.force?.entrypoint ?? args.input.entrypoint ?? "other") as ChatEntrypoint;
  const mode = (args.force?.mode ?? args.input.mode ?? (args.input.verseReference ? "bible" : "general")) as ChatMode;

  const { previousResponseId } = await upsertConversation({
    conversationId,
    userId: resolvedUserId,
    entrypoint,
    mode,
  });

  if (!wantsStream) {
    try {
      const bundle = await buildChatContextBundle({
        userId: resolvedUserId,
        conversationId,
        entrypoint,
        mode,
        previousResponseId,
        message: args.input.message,
        verseReference: args.input.verseReference,
        verseText: args.input.verseText,
        selectionState: args.input.selectionState,
      });

      const tools = buildContextToolsForUser();

      const shouldGenerateQuestions =
        Boolean(args.input.includeSuggestedQuestions) &&
        isBibleReaderStart({ entrypoint, mode, previousResponseId }) &&
        typeof args.input.selectionState === "string" &&
        args.input.selectionState.length > 0;

      const mainPromise = runMainChatResponse({
        openaiApiKey,
        model: "gpt-5.1-chat-latest",
        previousResponseId,
        messages: bundle.messages,
        tools,
        maxToolIterations: 3,
        signal: args.request.signal,
        executeToolCall: async (call: ContextToolCall) => {
          return await executeContextToolCall({
            userId: resolvedUserId,
            conversationId,
            toolCall: call as unknown as AppContextToolCall,
          });
        },
      });

      const questionsPromise = shouldGenerateQuestions
        ? runSuggestedQuestions({
            openaiApiKey,
            mode,
            selectionState: args.input.selectionState as "selected" | "visible",
            verseReference: args.input.verseReference,
            verseText: args.input.verseText,
            injectedInstructions: bundle.injectedInstructions,
          })
        : Promise.resolve([] as string[]);

      const [{ finalText, responseId }, suggestedQuestions] = await Promise.all([mainPromise, questionsPromise]);

      await prisma.chatConversation
        .update({
          where: { conversationId },
          data: { previousResponseId: responseId ?? undefined, updatedAt: new Date() },
          select: { id: true },
        })
        .catch(() => {});

      const actions: AIAction[] = extractUiActionsDeterministic({
        answerText: finalText,
        verseReference: args.input.verseReference,
      });

      const safeSuggestedQuestions = Array.isArray(suggestedQuestions) ? suggestedQuestions : [];

      return new Response(
        JSON.stringify({ conversationId, answer: finalText, actions, suggestedQuestions: safeSuggestedQuestions }),
        { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: "Failed to chat", details: message }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const write = (evt: SSEEvent) => controller.enqueue(encoder.encode(sseEncode(evt)));

      try {
        const bundle = await buildChatContextBundle({
          userId: resolvedUserId,
          conversationId,
          entrypoint,
          mode,
          previousResponseId,
          message: args.input.message,
          verseReference: args.input.verseReference,
          verseText: args.input.verseText,
          selectionState: args.input.selectionState,
        });

        const shouldGenerateQuestions =
          Boolean(args.input.includeSuggestedQuestions) &&
          isBibleReaderStart({ entrypoint, mode, previousResponseId }) &&
          typeof args.input.selectionState === "string" &&
          args.input.selectionState.length > 0;

        const questionsPromise = shouldGenerateQuestions
          ? runSuggestedQuestions({
              openaiApiKey,
              mode,
              selectionState: args.input.selectionState as "selected" | "visible",
              verseReference: args.input.verseReference,
              verseText: args.input.verseText,
              injectedInstructions: bundle.injectedInstructions,
            }).catch(() => [])
          : Promise.resolve([] as string[]);

        if (isInternalBypass) {
          write({
            type: "injection",
            blockText: truncateForSse(bundle.injection.blockText, 60_000),
            globalCount: bundle.injection.globalCount,
            sessionCount: bundle.injection.sessionCount,
          });
        }

        const tools = buildContextToolsForUser();

        const { finalText, responseId } = await runMainChatResponse({
          openaiApiKey,
          model: "gpt-5.1-chat-latest",
          previousResponseId,
          messages: bundle.messages,
          tools,
          maxToolIterations: 3,
          signal: args.request.signal,
          onTextDelta: (delta) => write({ type: "delta", text: delta }),
          onToolCall: (call) =>
            write({
              type: "tool_call",
              callId: call.callId,
              name: call.name,
              argumentsJson: truncateForSse(call.argumentsJson, 20_000),
            }),
          onToolResult: (call, output) =>
            write({
              type: "tool_result",
              callId: call.callId,
              name: call.name,
              output: truncateForSse(output, 40_000),
            }),
          executeToolCall: async (call: ContextToolCall) => {
            return await executeContextToolCall({
              userId: resolvedUserId,
              conversationId,
              toolCall: call as unknown as AppContextToolCall,
            });
          },
        });

        await prisma.chatConversation
          .update({
            where: { conversationId },
            data: { previousResponseId: responseId ?? undefined, updatedAt: new Date() },
            select: { id: true },
          })
          .catch(() => {});

        const actions: AIAction[] = extractUiActionsDeterministic({
          answerText: finalText,
          verseReference: args.input.verseReference,
        });

        const suggestedQuestions = await questionsPromise;
        if (Array.isArray(suggestedQuestions) && suggestedQuestions.length) {
          write({ type: "suggested_questions", questions: suggestedQuestions });
        }

        write({ type: "actions", actions });
        write({ type: "done", conversationId });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        write({ type: "error", message });
        controller.close();
      } finally {
        const _latencyMs = Date.now() - requestStartTime;
        void _latencyMs;
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

