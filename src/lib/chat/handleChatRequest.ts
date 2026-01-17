import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
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

type ChatLogLevel = "info" | "warn" | "error";

const redactId = (id: string | null | undefined): string | null => {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}…${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
};

const safeErrorDetails = (err: unknown): { name: string; message: string; stack?: string; code?: unknown } => {
  if (err instanceof Error) {
    const anyErr = err as any;
    const stack = typeof err.stack === "string" ? err.stack.slice(0, 4000) : undefined;
    return {
      name: err.name,
      message: err.message,
      ...(stack ? { stack } : {}),
      ...(typeof anyErr?.code !== "undefined" ? { code: anyErr.code } : {}),
    };
  }
  const anyErr = err as any;
  return {
    name: typeof anyErr?.name === "string" ? anyErr.name : "UnknownError",
    message: typeof anyErr?.message === "string" ? anyErr.message : String(err),
    ...(typeof anyErr?.code !== "undefined" ? { code: anyErr.code } : {}),
  };
};

const sha256Short = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12);

const chatLog = (level: ChatLogLevel, event: string, fields: Record<string, unknown>) => {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const payload = {
    ts: new Date().toISOString(),
    level,
    tag: "api.chat",
    env,
    event,
    ...fields,
  };
  if (level === "error") console.error(JSON.stringify(payload));
  else if (level === "warn") console.warn(JSON.stringify(payload));
  else console.info(JSON.stringify(payload));
};

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
  let stage:
    | "init"
    | "auth"
    | "resolve_user"
    | "upsert_conversation"
    | "build_context_bundle"
    | "run_main_response"
    | "run_suggested_questions"
    | "persist_previous_response"
    | "stream_start"
    | "done" = "init";

  const url = new URL(args.request.url);
  const correlationId =
    args.request.headers.get("x-request-id") ??
    args.request.headers.get("x-vercel-id") ??
    args.request.headers.get("cf-ray") ??
    crypto.randomUUID();

  const messageTrimmed = typeof args.input.message === "string" ? args.input.message.trim() : "";
  const messageHash = messageTrimmed ? sha256Short(messageTrimmed) : "empty";

  chatLog("info", "request_start", {
    correlationId,
    path: url.pathname,
    surface: args.surface,
    wantsStream:
      (args.request.headers.get("accept") ?? "").includes("text/event-stream") ||
      url.searchParams.get("stream") === "1",
    messageLen: messageTrimmed.length,
    messageHash,
    hasConversationId: Boolean(args.input.conversationId?.trim()),
    entrypoint: args.force?.entrypoint ?? args.input.entrypoint ?? null,
    mode: args.force?.mode ?? args.input.mode ?? null,
    hasVerseReference: Boolean(args.input.verseReference?.trim()),
    hasVerseText: Boolean(args.input.verseText?.trim()),
    selectionState: args.input.selectionState ?? null,
    includeSuggestedQuestions: Boolean(args.input.includeSuggestedQuestions),
  });

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    chatLog("error", "config_missing", {
      correlationId,
      stage,
      missingEnv: ["OPENAI_API_KEY"],
    });
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

  stage = "auth";
  const { userId: clerkUserId } = isInternalBypass ? { userId: null } : await auth();
  if (!isInternalBypass && !clerkUserId) {
    chatLog("warn", "unauthorized", {
      correlationId,
      stage,
      isInternalBypass,
      hasClerkUserId: Boolean(clerkUserId),
    });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  stage = "resolve_user";
  const resolvedUserId = await resolveUserId({
    isInternalBypass,
    impersonateUserId: impersonateUserId?.trim() ?? null,
    clerkUserId: (clerkUserId as string | null) ?? null,
  });
  if (!resolvedUserId) {
    chatLog("warn", "user_not_found", {
      correlationId,
      stage,
      isInternalBypass,
      impersonateUserId: redactId(impersonateUserId?.trim() ?? null),
      clerkUserId: redactId((clerkUserId as string | null) ?? null),
    });
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

  stage = "upsert_conversation";
  let previousResponseId: string | null = null;
  try {
    const res = await upsertConversation({
      conversationId,
      userId: resolvedUserId,
      entrypoint,
      mode,
    });
    previousResponseId = res.previousResponseId;
  } catch (err) {
    chatLog("error", "conversation_upsert_failed", {
      correlationId,
      stage,
      conversationId,
      userId: redactId(resolvedUserId),
      entrypoint,
      mode,
      error: safeErrorDetails(err),
    });
    throw err;
  }

  if (!wantsStream) {
    try {
      stage = "build_context_bundle";
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

      stage = "run_main_response";
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

      stage = "run_suggested_questions";
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

      stage = "persist_previous_response";
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

      stage = "done";
      chatLog("info", "request_success", {
        correlationId,
        conversationId,
        userId: redactId(resolvedUserId),
        entrypoint,
        mode,
        responseId: responseId ? redactId(responseId) : null,
        answerLen: finalText.length,
        suggestedQuestionsCount: safeSuggestedQuestions.length,
        latencyMs: Date.now() - requestStartTime,
      });

      return new Response(
        JSON.stringify({ conversationId, answer: finalText, actions, suggestedQuestions: safeSuggestedQuestions }),
        { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    } catch (err) {
      const error = safeErrorDetails(err);
      chatLog("error", "request_failed", {
        correlationId,
        stage,
        conversationId,
        userId: redactId(resolvedUserId),
        entrypoint,
        mode,
        latencyMs: Date.now() - requestStartTime,
        error,
      });
      const message = error.message;
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

      stage = "stream_start";
      chatLog("info", "stream_start", {
        correlationId,
        conversationId,
        userId: redactId(resolvedUserId),
        entrypoint,
        mode,
        previousResponseId: previousResponseId ? redactId(previousResponseId) : null,
      });

      try {
        stage = "build_context_bundle";
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

        stage = "run_main_response";
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

        stage = "persist_previous_response";
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
        stage = "done";
        chatLog("info", "stream_success", {
          correlationId,
          conversationId,
          userId: redactId(resolvedUserId),
          entrypoint,
          mode,
          responseId: responseId ? redactId(responseId) : null,
          answerLen: finalText.length,
          latencyMs: Date.now() - requestStartTime,
        });
        controller.close();
      } catch (err) {
        const error = safeErrorDetails(err);
        chatLog("error", "stream_failed", {
          correlationId,
          stage,
          conversationId,
          userId: redactId(resolvedUserId),
          entrypoint,
          mode,
          latencyMs: Date.now() - requestStartTime,
          error,
        });
        write({ type: "error", message: error.message });
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

