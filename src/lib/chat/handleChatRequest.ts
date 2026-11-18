import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import {
  buildContextToolsForUser,
  executeContextToolCall,
  type ContextToolCall as AppContextToolCall,
} from "@/lib/chat/tools/contextTools";
import { createOpenAIConversation, type ContextToolCall } from "@/lib/openai/responsesClient";
import { validateInternalApiKey } from "@/app/api/internal/suggestion-debugger/_internalApiKey";
import { extractUiActionsDeterministic, type AIAction } from "@/lib/openai/structuredActions";
import { buildChatContextBundle, type ChatEntrypoint, type ChatMode } from "@/lib/chat/chatContextBundle";
import { runMainChatResponse } from "@/lib/chat/runMainChatResponse";
import { runSuggestedQuestions } from "@/lib/chat/runSuggestedQuestions";
import {
  SHOW_BLOCK_TOOL_NAME,
  blockReferences,
  buildShowBlockTool,
  buildUiBlocksSystemPrompt,
  parseClientBlockKinds,
  resolveShowBlockCall,
  type GuideBlock,
} from "@/lib/guide/uiBlocks";
import { buildChapterGreetingMap, getPassagePlaces } from "@/lib/guide/places";

type SSEEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; callId: string; name: string; argumentsJson: string }
  | { type: "tool_result"; callId: string; name: string; output: string }
  | { type: "injection"; blockText: string; globalCount: number; sessionCount: number }
  | { type: "actions"; actions: AIAction[] }
  | { type: "block"; block: GuideBlock }
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

/** OpenAI rejects every request on a conversation that holds a tool call without a result. */
const isDanglingToolCallError = (err: unknown) =>
  err instanceof Error && err.message.includes("No tool output found for function call");

const isBibleReaderStart = (args: {
  entrypoint: ChatEntrypoint;
  mode: ChatMode;
  isNewConversation: boolean;
}) => args.entrypoint === "bible_reader" && args.mode === "bible" && args.isNewConversation;

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
}): Promise<{ openaiConversationId: string | null }> => {
  const conversation = await prisma.chatConversation.upsert({
    where: { conversationId: args.conversationId },
    create: {
      conversationId: args.conversationId,
      userId: args.userId,
      entrypoint: args.entrypoint,
      mode: args.mode,
    },
    update: {
      entrypoint: args.entrypoint,
      mode: args.mode,
      updatedAt: new Date(),
    },
    select: { userId: true, openaiConversationId: true },
  });

  if (conversation.userId !== args.userId) throw new Error("Conversation belongs to a different user");
  return { openaiConversationId: conversation.openaiConversationId ?? null };
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
  /** Inline UI block kinds the client can render. Only honored when streaming. */
  uiBlocks?: string[];
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
  let openaiConversationId: string | null = null;
  let isNewConversation = false;
  try {
    const res = await upsertConversation({
      conversationId,
      userId: resolvedUserId,
      entrypoint,
      mode,
    });
    openaiConversationId = res.openaiConversationId;

    // If no openaiConversationId in ChatConversation, check if there's a saved ChatSession with one
    // This handles the case where a user restores a past conversation
    if (!openaiConversationId) {
      const existingSession = await prisma.chatSession.findFirst({
        where: {
          userId: resolvedUserId,
          sessionId: conversationId,
        },
        select: { openaiConversationId: true },
      });
      if (existingSession?.openaiConversationId) {
        openaiConversationId = existingSession.openaiConversationId;
        await prisma.chatConversation.update({
          where: { conversationId },
          data: { openaiConversationId },
        });
      }
    }

    // Create OpenAI conversation on first message if still none exists
    if (!openaiConversationId) {
      isNewConversation = true;
      openaiConversationId = await createOpenAIConversation(openaiApiKey);
      await prisma.chatConversation.update({
        where: { conversationId },
        data: { openaiConversationId },
      });
    }
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

  /** Runs a response; if the OpenAI thread is broken, starts a fresh thread and tries once more. */
  const runWithFreshThreadOnDanglingCall = async <T>(
    run: (openaiConversationId: string | null) => Promise<T>,
    canRetry: () => boolean = () => true
  ): Promise<T> => {
    try {
      return await run(openaiConversationId);
    } catch (err) {
      if (!isDanglingToolCallError(err) || !canRetry()) throw err;
      chatLog("warn", "openai_conversation_reset", { correlationId, conversationId });
      openaiConversationId = await createOpenAIConversation(openaiApiKey);
      await prisma.chatConversation.update({ where: { conversationId }, data: { openaiConversationId } });
      return await run(openaiConversationId);
    }
  };

  if (!wantsStream) {
    try {
      stage = "build_context_bundle";
      const bundle = await buildChatContextBundle({
        userId: resolvedUserId,
        conversationId,
        entrypoint,
        mode,
        previousResponseId: null,
        isNewConversation,
        message: args.input.message,
        verseReference: args.input.verseReference,
        verseText: args.input.verseText,
        selectionState: args.input.selectionState,
      });

      const tools = buildContextToolsForUser();
      const toolResults: Array<{ name: string; output: string }> = [];

      const shouldGenerateQuestions =
        Boolean(args.input.includeSuggestedQuestions) &&
        entrypoint === "bible_reader" &&
        mode === "bible" &&
        typeof args.input.selectionState === "string" &&
        args.input.selectionState.length > 0;

      stage = "run_main_response";
      const mainPromise = runWithFreshThreadOnDanglingCall((threadId) => runMainChatResponse({
        openaiApiKey,
        model: "gpt-5.5",
        openaiConversationId: threadId,
        messages: bundle.messages,
        tools,
        maxToolIterations: 3,
        signal: args.request.signal,
        onToolResult: (call, output) => {
          toolResults.push({ name: call.name, output });
        },
        executeToolCall: async (call: ContextToolCall) => {
          return await executeContextToolCall({
            userId: resolvedUserId,
            conversationId,
            toolCall: call as unknown as AppContextToolCall,
          });
        },
      }));

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
          data: { updatedAt: new Date() },
          select: { id: true },
        })
        .catch(() => {});

      const actions: AIAction[] = extractUiActionsDeterministic({
        answerText: finalText,
        verseReference: args.input.verseReference,
      });

      // Extract reading plan actions from tool results (only plans referenced in response)
      const lowerText = finalText.toLowerCase();
      for (const result of toolResults) {
        if (result.name === "search_reading_plans") {
          try {
            const parsed = JSON.parse(result.output);
            for (const plan of parsed.plans ?? []) {
              if (lowerText.includes(plan.title.toLowerCase())) {
                actions.push({
                  id: `NAVIGATE_TO_READING_PLAN:${plan.shortId}`,
                  type: "NAVIGATE_TO_READING_PLAN",
                  version: 1,
                  params: {
                    planId: plan.shortId,
                    planTitle: plan.title,
                    planDescription: plan.description ?? undefined,
                    planTotalDays: String(plan.totalDays),
                  },
                  resolved: null,
                  confidence: plan.relevanceScore ?? 0.8,
                  priority: "secondary",
                  icon: "book.closed.fill",
                  color: "blue",
                });
              }
            }
          } catch { /* ignore parse errors */ }
        }
      }

      // Sort actions by order of first mention in response
      actions.sort((a, b) => {
        const aKey = a.params.reference ?? a.params.planTitle ?? "";
        const bKey = b.params.reference ?? b.params.planTitle ?? "";
        const aPos = lowerText.indexOf(aKey.toLowerCase());
        const bPos = lowerText.indexOf(bKey.toLowerCase());
        return (aPos === -1 ? Infinity : aPos) - (bPos === -1 ? Infinity : bPos);
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
        openaiConversationId: openaiConversationId ? redactId(openaiConversationId) : null,
      });

      try {
        stage = "build_context_bundle";
        const bundle = await buildChatContextBundle({
          userId: resolvedUserId,
          conversationId,
          entrypoint,
          mode,
          previousResponseId: null,
          isNewConversation,
          message: args.input.message,
          verseReference: args.input.verseReference,
          verseText: args.input.verseText,
          selectionState: args.input.selectionState,
        });

        const shouldGenerateQuestions =
          Boolean(args.input.includeSuggestedQuestions) &&
          entrypoint === "bible_reader" &&
          mode === "bible" &&
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

        const blockKinds = parseClientBlockKinds(args.input.uiBlocks);
        // The greeting gets no model-chosen cards; at most a rule-based chapter map after its text.
        // A reopened guide reuses its conversation, so detect the greeting by its start message.
        const isGreeting = entrypoint === "bible_reader" && args.input.message.trim() === "BIBLE_CHAT_START";
        const modelBlockKinds = isGreeting ? [] : blockKinds;
        const passagePlaces =
          blockKinds.includes("map_card") && entrypoint === "bible_reader"
            ? await getPassagePlaces(args.input.verseReference, args.input.selectionState).catch(() => null)
            : null;
        const blocks: GuideBlock[] = [];
        let blockCount = 0;
        // Keep prose first: a block requested before any answer text is held and emitted
        // after the text that follows it, never above the lead-in.
        let answerTextStarted = false;
        const heldBlocks: GuideBlock[] = [];
        const flushHeldBlocks = () => {
          for (const block of heldBlocks.splice(0)) write({ type: "block", block });
        };

        const tools = modelBlockKinds.length
          ? [...buildContextToolsForUser(), buildShowBlockTool(modelBlockKinds)]
          : buildContextToolsForUser();
        const messages = modelBlockKinds.length
          ? [
              bundle.messages[0],
              { role: "system" as const, content: buildUiBlocksSystemPrompt(modelBlockKinds, passagePlaces) },
              ...bundle.messages.slice(1),
            ]
          : bundle.messages;

        const toolResults: Array<{ name: string; output: string }> = [];

        stage = "run_main_response";
        // Retry on a fresh thread only before anything was streamed, so the answer isn't duplicated.
        const { finalText, responseId } = await runWithFreshThreadOnDanglingCall((threadId) => runMainChatResponse({
          openaiApiKey,
          model: "gpt-5.5",
          openaiConversationId: threadId,
          messages,
          tools,
          // A shown block costs one tool round trip, so allow one more when blocks are on.
          maxToolIterations: modelBlockKinds.length ? 4 : 3,
          signal: args.request.signal,
          onTextDelta: (delta) => {
            if (delta.trim()) answerTextStarted = true;
            write({ type: "delta", text: delta });
          },
          onToolCall: (call) =>
            write({
              type: "tool_call",
              callId: call.callId,
              name: call.name,
              argumentsJson: truncateForSse(call.argumentsJson, 20_000),
            }),
          onToolResult: (call, output) => {
            toolResults.push({ name: call.name, output });
            write({
              type: "tool_result",
              callId: call.callId,
              name: call.name,
              output: truncateForSse(output, 40_000),
            });
          },
          executeToolCall: async (call: ContextToolCall) => {
            if (call.name === SHOW_BLOCK_TOOL_NAME) {
              // A card that fails to build is dropped; it must never fail the whole answer.
              const result = await resolveShowBlockCall({
                argumentsJson: call.argumentsJson,
                allowedKinds: modelBlockKinds,
                userId: resolvedUserId,
                blockId: `block-${++blockCount}`,
                passage: passagePlaces,
              }).catch((err): Awaited<ReturnType<typeof resolveShowBlockCall>> => {
                chatLog("error", "ui_block_failed", { correlationId, conversationId, error: safeErrorDetails(err) });
                return { ok: false, reason: "the card could not be built" };
              });
              const unresolvedPlaces = result.ok ? result.unresolvedPlaces : result.unresolved;
              if (unresolvedPlaces?.length) {
                chatLog("warn", "map_place_unresolved", {
                  correlationId,
                  conversationId,
                  names: unresolvedPlaces,
                  passage: passagePlaces?.chapterReference ?? null,
                });
              }
              if (!result.ok) {
                chatLog("warn", "ui_block_rejected", { correlationId, conversationId, reason: result.reason });
                return `Rejected: ${result.reason}`;
              }
              blocks.push(result.block);
              if (answerTextStarted) {
                flushHeldBlocks();
                write({ type: "block", block: result.block });
              } else {
                heldBlocks.push(result.block);
              }
              return "Shown to the user. Continue your reply without repeating the card's content.";
            }
            return await executeContextToolCall({
              userId: resolvedUserId,
              conversationId,
              toolCall: call as unknown as AppContextToolCall,
            });
          },
        }), () => !answerTextStarted && blocks.length === 0);

        stage = "persist_previous_response";
        await prisma.chatConversation
          .update({
            where: { conversationId },
            data: { updatedAt: new Date() },
            select: { id: true },
          })
          .catch(() => {});

        // Drop verse chips for references a block already shows.
        const shownReferences = blockReferences(blocks);
        const actions: AIAction[] = extractUiActionsDeterministic({
          answerText: finalText,
          verseReference: args.input.verseReference,
        }).filter((a) => !(a.params.reference && shownReferences.has(a.params.reference)));

        // Extract reading plan actions from tool results (only plans referenced in response)
        const lowerText = finalText.toLowerCase();
        for (const result of toolResults) {
          if (result.name === "search_reading_plans") {
            try {
              const parsed = JSON.parse(result.output);
              for (const plan of parsed.plans ?? []) {
                if (lowerText.includes(plan.title.toLowerCase())) {
                  actions.push({
                    id: `NAVIGATE_TO_READING_PLAN:${plan.shortId}`,
                    type: "NAVIGATE_TO_READING_PLAN",
                    version: 1,
                    params: {
                      planId: plan.shortId,
                      planTitle: plan.title,
                      planDescription: plan.description ?? undefined,
                      planTotalDays: String(plan.totalDays),
                    },
                    resolved: null,
                    confidence: plan.relevanceScore ?? 0.8,
                    priority: "secondary",
                    icon: "book.closed.fill",
                    color: "blue",
                  });
                }
              }
            } catch { /* ignore parse errors */ }
          }
        }

        // Sort actions by order of first mention in response
        actions.sort((a, b) => {
          const aKey = a.params.reference ?? a.params.planTitle ?? "";
          const bKey = b.params.reference ?? b.params.planTitle ?? "";
          const aPos = lowerText.indexOf(aKey.toLowerCase());
          const bPos = lowerText.indexOf(bKey.toLowerCase());
          return (aPos === -1 ? Infinity : aPos) - (bPos === -1 ? Infinity : bPos);
        });

        flushHeldBlocks();

        if (isGreeting && blockKinds.includes("map_card") && args.input.selectionState === "visible") {
          const greetingMap = buildChapterGreetingMap(passagePlaces, `block-${++blockCount}`);
          if (greetingMap) {
            blocks.push(greetingMap);
            write({ type: "block", block: greetingMap });
          }
        }

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
          uiBlocks: blocks.length,
          mapPlaces: blocks.reduce((n, b) => n + (b.kind === "map_card" ? b.places.length : 0), 0),
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

