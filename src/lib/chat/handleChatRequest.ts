import { z } from "zod";
import { NextRequest } from "next/server";
import {
  CLIENT_TOOL_NAMES,
  buildContextToolsForUser,
  executeServerToolCall,
  type SessionNote,
} from "@/lib/chat/tools/contextTools";
import { ACTIVITY_TOOL_NAMES, buildActivityTools, createActivityToolRunner, type ActivityEvent } from "@/lib/chat/tools/activityTools";
import { GOAL_TOOL_NAMES, buildGoalTools, createGoalToolRunner, type GoalEvent, type GoalToolResult } from "@/lib/chat/tools/goalTools";
import {
  NOTIFICATION_TOOL_NAMES,
  buildNotificationTools,
  createNotificationToolRunner,
  type NotificationSettingsEvent,
} from "@/lib/chat/tools/notificationTools";
import type { ContextToolCall } from "@/lib/openai/responsesClient";
import { extractUiActionsDeterministic, type AIAction } from "@/lib/openai/structuredActions";
import {
  GOAL_THREAD_REFLECT_MESSAGE,
  buildChatContextBundle,
  chatContextSchema,
  goalSetupSchema,
  goalThreadSchema,
  type ChatEntrypoint,
  type ChatMode,
} from "@/lib/chat/chatContextBundle";
import { runMainChatResponse } from "@/lib/chat/runMainChatResponse";
import { runSuggestedQuestions } from "@/lib/chat/runSuggestedQuestions";
import {
  SHOW_BLOCK_TOOL_NAME,
  blockReferences,
  buildShowBlockTool,
  buildUiBlocksSystemPrompt,
  HEARTBEAT_ONLY_BLOCK_KINDS,
  closingChoiceOptions,
  isQuickRepliesCall,
  parseClientBlockKinds,
  pendingBlockLabel,
  requestedCardRule,
  resolveShowBlockCall,
  type GuideBlock,
} from "@/lib/guide/uiBlocks";
import { buildChapterGreetingMap, getPassagePlaces } from "@/lib/guide/places";

/**
 * The Guide chat. Nothing about a conversation is stored, here or at the model provider: each
 * request carries the conversation so far and what the Guide should know about the user, both
 * kept (encrypted) by the app. The request is answered from memory and forgotten.
 */

type SSEEvent =
  | { type: "delta"; text: string }
  | { type: "actions"; actions: AIAction[] }
  | { type: "block"; block: GuideBlock }
  /** A card the model has started: the app shows it forging until its block (or a cancel) arrives. */
  | { type: "block_pending"; kind: string; reference: string | null }
  | { type: "block_pending_cancel" }
  | { type: "suggested_questions"; questions: string[] }
  /** The Guide chose to remember something for this conversation; the app keeps it. */
  | { type: "memory_note"; note: SessionNote }
  /** The Guide started, changed or logged progress on a goal; the app applies it. Nothing is stored here. */
  | ({ type: "goal" } & GoalEvent)
  /** The Guide put something on the calendar for a goal; the app keeps the activity. Nothing is stored here. */
  | ({ type: "activity" } & ActivityEvent)
  /** The user asked to change their notifications; the app applies it. Nothing is stored here. */
  | { type: "notification_settings"; changes: NotificationSettingsEvent }
  /**
   * `items` is what this request added to the conversation; the app appends them to its history.
   * With `pendingToolCalls` the reply is unfinished: the app answers the calls from the user's
   * own data and sends the outputs in a follow-up request.
   */
  | { type: "done"; conversationId: string; items: unknown[]; pendingToolCalls?: ContextToolCall[] }
  | { type: "error"; message: string };

const sseEncode = (evt: SSEEvent) => `data: ${JSON.stringify(evt)}\n\n`;

/** Fields both chat routes accept. `message` starts a turn; `toolOutputs` continues one. */
export const chatRequestFields = {
  conversationId: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(4000).optional(),
  toolOutputs: z
    .array(z.object({ callId: z.string().min(1).max(128), output: z.string().max(40_000) }))
    .min(1)
    .max(20)
    .optional(),
  history: z.array(z.unknown()).max(2000).default([]),
  context: chatContextSchema.optional(),
  /** Set when the request belongs to a goal's own conversation. */
  goalThread: goalThreadSchema.optional(),
  /** Set while the conversation is setting up a new goal, until the goal is made. */
  goalSetup: goalSetupSchema.optional(),
  verseText: z.string().min(1).max(8000).optional(),
  selectionState: z.enum(["selected", "visible"]).optional(),
  includeSuggestedQuestions: z.boolean().optional(),
  // Inline UI block kinds the client can render.
  uiBlocks: z.array(z.string().max(40)).max(20).optional(),
  /** The card the user asked to see, by tapping its example in Lumen's menu. */
  requestedBlock: z.string().max(40).optional(),
};

/** A request either starts a turn with a message or continues one with tool outputs, never both. */
export const refineChatRequest = (
  val: { message?: string; toolOutputs?: unknown[] },
  ctx: z.RefinementCtx
) => {
  if (Boolean(val.message) === Boolean(val.toolOutputs)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["message"], message: "Send either message or toolOutputs." });
  }
};

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

/** Logs carry sizes, ids and timings only; never anything the user or the Guide wrote. */
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

/**
 * A refused goal call is logged by its reason code alone: anything after the first ':' can echo what
 * the model sent (a book id, a field name), so it never reaches a log. An accepted call logs its action.
 */
const logGoalToolResult = (args: { correlationId: string; conversationId: string; tool: string; result: GoalToolResult }) => {
  const { correlationId, conversationId, tool, result } = args;
  let parsed: { ok?: unknown; reason?: unknown } = {};
  try {
    parsed = JSON.parse(result.output);
  } catch {
    // An output that is not JSON is logged as an unknown reason below.
  }
  if (parsed.ok === false) {
    const reason = typeof parsed.reason === "string" ? parsed.reason.split(":")[0].trim() : "unknown";
    chatLog("warn", "goal_tool_refused", { correlationId, conversationId, tool, reason });
  } else {
    chatLog("info", "goal_tool_ok", { correlationId, conversationId, tool, action: result.event?.action });
    if (result.statusIgnored) chatLog("info", "goal_tool_status_ignored", { correlationId, conversationId, tool });
  }
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** What the Guide already wrote this turn in earlier requests, before a tool continuation. */
const earlierTurnText = (history: unknown[]): string => {
  let text = "";
  for (const item of history) {
    if (!isRecord(item)) continue;
    if (item.role === "user") text = "";
    if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") text += `${part.text} `;
    }
  }
  return text;
};

export type ChatSurface = "general" | "bible";

export type HandleChatInput = {
  conversationId?: string;
  message?: string;
  toolOutputs?: Array<{ callId: string; output: string }>;
  history: unknown[];
  context?: z.infer<typeof chatContextSchema>;
  entrypoint?: ChatEntrypoint;
  mode?: ChatMode;
  verseReference?: string;
  verseText?: string;
  selectionState?: "selected" | "visible";
  includeSuggestedQuestions?: boolean;
  goalThread?: z.infer<typeof goalThreadSchema>;
  goalSetup?: z.infer<typeof goalSetupSchema>;
  /** Inline UI block kinds the client can render. */
  uiBlocks?: string[];
  /** The card the user asked to see, by tapping its example in Lumen's menu. */
  requestedBlock?: string;
};

export async function handleChatRequest(args: {
  request: NextRequest;
  /** The signed-in user. Used for their reader settings and in logs; no conversation data is stored against it. */
  userId: string;
  surface: ChatSurface;
  input: HandleChatInput;
  force?: { entrypoint?: ChatEntrypoint; mode?: ChatMode };
}): Promise<Response> {
  const requestStartTime = Date.now();
  let stage: "init" | "build_context_bundle" | "run_main_response" | "stream_start" | "done" = "init";

  const url = new URL(args.request.url);
  const correlationId =
    args.request.headers.get("x-request-id") ??
    args.request.headers.get("x-vercel-id") ??
    args.request.headers.get("cf-ray") ??
    crypto.randomUUID();

  const message = args.input.message?.trim() ?? "";
  const isContinuation = Boolean(args.input.toolOutputs);
  const entrypoint = (
    args.input.goalThread ? "goal_thread" : (args.force?.entrypoint ?? args.input.entrypoint ?? "other")
  ) as ChatEntrypoint;
  const mode = (args.force?.mode ?? args.input.mode ?? (args.input.verseReference ? "bible" : "general")) as ChatMode;

  chatLog("info", "request_start", {
    correlationId,
    path: url.pathname,
    surface: args.surface,
    messageLen: message.length,
    isContinuation,
    historyItems: args.input.history.length,
    entrypoint,
    mode,
    hasVerseReference: Boolean(args.input.verseReference?.trim()),
    hasVerseText: Boolean(args.input.verseText?.trim()),
    selectionState: args.input.selectionState ?? null,
    includeSuggestedQuestions: Boolean(args.input.includeSuggestedQuestions),
    goals: args.input.context?.goals?.length ?? 0,
    requestedBlock: args.input.requestedBlock ?? null,
  });

  const jsonResponse = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    chatLog("error", "config_missing", { correlationId, stage, missingEnv: ["OPENAI_API_KEY"] });
    return jsonResponse({ error: "AI service not configured" }, 500);
  }

  const userId = args.userId;

  // The app's own id for the conversation. It is echoed back and used in logs; nothing is stored.
  const conversationId = args.input.conversationId?.trim() || crypto.randomUUID();
  const isNewConversation = args.input.history.length === 0 && !isContinuation;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const write = (evt: SSEEvent) => controller.enqueue(encoder.encode(sseEncode(evt)));
      // "label@ms since request start" for each stage, logged with stream_success.
      const stageMarks: string[] = [];
      const markStage = (label: string) => stageMarks.push(`${label}@${Date.now() - requestStartTime}`);
      // True until the first text of each model round (the first round, and each round after a tool).
      let awaitingRoundText = true;

      stage = "stream_start";
      markStage("stream_start");
      chatLog("info", "stream_start", { correlationId, conversationId, userId: redactId(userId), entrypoint, mode });

      try {
        stage = "build_context_bundle";
        const bundle = buildChatContextBundle({
          context: args.input.context,
          entrypoint,
          mode,
          isNewConversation,
          message,
          verseReference: args.input.verseReference,
          verseText: args.input.verseText,
          selectionState: args.input.selectionState,
          goalThread: args.input.goalThread,
          goalSetup: args.input.goalSetup,
        });
        // A continuation adds only the answers to the calls left pending by the previous request.
        const input = args.input.toolOutputs
          ? args.input.toolOutputs.map((o) => ({ type: "function_call_output", call_id: o.callId, output: o.output }))
          : bundle.input;

        const shouldGenerateQuestions =
          !isContinuation &&
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
            })
              .catch(() => [])
              .finally(() => markStage("questions"))
          : Promise.resolve([] as string[]);

        const blockKinds = parseClientBlockKinds(args.input.uiBlocks);
        // The greeting gets no model-chosen cards; at most a rule-based chapter map after its text.
        // A reopened guide reuses its conversation, so detect the greeting by its start message.
        const isGreeting = entrypoint === "bible_reader" && message === "BIBLE_CHAT_START";
        // The start of a reflection is Lumen's own words and one question: no card, and verses are links in the text.
        const isReflecting = Boolean(args.input.goalThread) && message === GOAL_THREAD_REFLECT_MESSAGE;
        // Verses in an answer are links in its text, so the model never shows them as a passage card
        // (the heartbeat's verse to carry still uses one).
        const modelBlockKinds =
          isGreeting || isReflecting ? [] : blockKinds.filter((k) => !HEARTBEAT_ONLY_BLOCK_KINDS.includes(k) && k !== "passage_card");
        // Honored only when it is a card the model may show in this reply.
        const requestedKind = modelBlockKinds.find((k) => k === args.input.requestedBlock);
        const passagePlaces =
          blockKinds.includes("map_card") && entrypoint === "bible_reader"
            ? await getPassagePlaces(args.input.verseReference, args.input.selectionState).catch(() => null)
            : null;
        markStage("places");
        const blocks: GuideBlock[] = [];
        // Block ids must stay unique across the requests of one reply (see tool continuation).
        const blockIdPrefix = crypto.randomUUID().slice(0, 8);
        let blockCount = 0;
        const nextBlockId = () => `block-${blockIdPrefix}-${++blockCount}`;
        // Keep prose first: a block requested before any answer text is held and emitted
        // after the text that follows it, never above the lead-in.
        let answerTextStarted = false;
        const heldBlocks: GuideBlock[] = [];
        // show_block calls the model has started, by item id. Writing a call's arguments (a note,
        // a list of places) takes the model a second or two, so the card is announced as soon as
        // its kind is written; the app shows it forging until the block or a cancel arrives.
        const startedBlockCalls = new Map<string, { callId: string; args: string; announced: string | null }>();
        const flushHeldBlocks = () => {
          for (const block of heldBlocks.splice(0)) write({ type: "block", block });
        };
        // Quick replies answer the guide's closing question, so they always go out after all text.
        let quickReplies: GuideBlock | null = null;

        // The greeting is a short orientation; it does not look up the user's own data, but a goal can still be started from it.
        const contextTools = isGreeting
          ? [...buildContextToolsForUser().filter((tool) => !CLIENT_TOOL_NAMES.has(tool.name)), ...buildGoalTools()]
          : [...buildContextToolsForUser(), ...buildGoalTools(), ...buildActivityTools(), ...buildNotificationTools()];
        const runGoalTool = createGoalToolRunner({
          goals: args.input.context?.goals,
          memoryEnabled: args.input.context?.memoryEnabled,
          today: args.input.context?.today ?? new Date().toISOString().slice(0, 10),
        });
        const goalIds = [
          ...(args.input.context?.goals ?? []).map((g) => g.id),
          ...(args.input.goalThread ? [args.input.goalThread.goalId] : []),
        ];
        const runActivityTool = createActivityToolRunner({
          goalIds,
          goals: args.input.context?.goals,
          today: args.input.context?.today ?? new Date().toISOString().slice(0, 10),
        });
        const runNotificationTool = createNotificationToolRunner({
          goalIds,
          today: args.input.context?.today ?? new Date().toISOString().slice(0, 10),
        });
        const tools = modelBlockKinds.length ? [...contextTools, buildShowBlockTool(modelBlockKinds)] : contextTools;
        const instructions = modelBlockKinds.length
          ? [
              bundle.instructions[0],
              { role: "system" as const, content: buildUiBlocksSystemPrompt(modelBlockKinds, passagePlaces) },
              ...bundle.instructions.slice(1),
              // Last, so it outweighs what the conversation so far has shown.
              ...(requestedKind ? [{ role: "system" as const, content: requestedCardRule(requestedKind) }] : []),
            ]
          : bundle.instructions;

        stage = "run_main_response";
        const { finalText, responseId, items, pendingToolCalls } = await runMainChatResponse({
          openaiApiKey,
          model: "gpt-5.5",
          // Low effort cuts time to first text by more than half; answers are short single paragraphs.
          reasoningEffort: "low",
          instructions,
          history: args.input.history,
          input,
          tools,
          // A shown block costs one tool round trip, so allow one more when blocks are on.
          maxToolIterations: modelBlockKinds.length ? 4 : 3,
          signal: args.request.signal,
          isClientToolCall: (call) => CLIENT_TOOL_NAMES.has(call.name),
          isFinalToolCall: isQuickRepliesCall,
          onToolCallStarted: (call) => {
            if (call.name !== SHOW_BLOCK_TOOL_NAME) return;
            markStage("show_block_start");
            startedBlockCalls.set(call.itemId, { callId: call.callId, args: "", announced: null });
          },
          onToolCallArgumentsDelta: (itemId, delta) => {
            const started = startedBlockCalls.get(itemId);
            if (!started) return;
            started.args += delta;
            // Before the answer text starts, blocks are held back (see heldBlocks); so is this.
            if (!answerTextStarted) return;
            const label = pendingBlockLabel(started.args, modelBlockKinds);
            if (!label) return;
            // Announce once the kind is known, and again when the reference completes.
            const key = `${label.kind}|${label.reference ?? ""}`;
            if (started.announced === key) return;
            if (started.announced === null) markStage("block_pending");
            started.announced = key;
            write({ type: "block_pending", kind: label.kind, reference: label.reference });
          },
          onTextDelta: (delta) => {
            if (awaitingRoundText && delta.trim()) {
              awaitingRoundText = false;
              markStage("text");
            }
            if (delta.trim()) answerTextStarted = true;
            write({ type: "delta", text: delta });
          },
          onToolCall: (call) => {
            markStage(call.name);
          },
          onToolResult: (call, output) => {
            markStage(`${call.name}_done`);
            awaitingRoundText = true;
          },
          executeToolCall: async (call: ContextToolCall) => {
            if (call.name === SHOW_BLOCK_TOOL_NAME) {
              // A card that fails to build is dropped; it must never fail the whole answer.
              const result = await resolveShowBlockCall({
                argumentsJson: call.argumentsJson,
                allowedKinds: modelBlockKinds,
                userId,
                blockId: nextBlockId(),
                passage: passagePlaces,
                goalIds,
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
              const announced = [...startedBlockCalls.values()].some((c) => c.callId === call.callId && c.announced);
              if (!result.ok) {
                chatLog("warn", "ui_block_rejected", { correlationId, conversationId, reason: result.reason });
                if (announced) write({ type: "block_pending_cancel" });
                return `Rejected: ${result.reason}`;
              }
              if (result.block.kind === "quick_replies") {
                if (quickReplies) return "Rejected: only one set of quick_replies per reply";
                quickReplies = result.block;
                blocks.push(result.block);
                return "Shown under your question. Do not write anything more.";
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
            if (GOAL_TOOL_NAMES.has(call.name)) {
              const result = runGoalTool(call);
              if (result.event) write({ type: "goal", ...result.event });
              logGoalToolResult({ correlationId, conversationId, tool: call.name, result });
              return result.output;
            }
            if (ACTIVITY_TOOL_NAMES.has(call.name)) {
              const result = runActivityTool(call);
              if (result.event) write({ type: "activity", ...result.event });
              return result.output;
            }
            if (NOTIFICATION_TOOL_NAMES.has(call.name)) {
              const result = runNotificationTool(call);
              if (result.event) write({ type: "notification_settings", changes: result.event });
              return result.output;
            }
            const result = await executeServerToolCall(call);
            if (result.note) write({ type: "memory_note", note: result.note });
            return result.output;
          },
        });
        markStage("model_done");

        // Calls only the app can answer are pending: the reply continues in a follow-up request.
        const finished = pendingToolCalls.length === 0;
        // Everything written this turn, including before a tool continuation.
        const turnText = `${earlierTurnText(args.input.history)}${finalText}`;

        // The model sometimes ends on a question listing its own choices without offering them.
        const closingOptions =
          finished && !quickReplies && modelBlockKinds.includes("quick_replies") ? closingChoiceOptions(finalText) : null;
        if (closingOptions) {
          quickReplies = {
            id: nextBlockId(),
            kind: "quick_replies",
            v: 1,
            options: closingOptions,
            fallback_text: `(Reply options: ${closingOptions.join(" / ")})`,
          };
          blocks.push(quickReplies);
          chatLog("info", "quick_replies_fallback", { correlationId, conversationId, options: closingOptions.length });
        }

        // Drop verse chips for references a block already shows.
        const shownReferences = blockReferences(blocks);
        const actions: AIAction[] = extractUiActionsDeterministic({
          answerText: turnText,
          verseReference: args.input.verseReference,
        }).filter((a) => !(a.params.reference && shownReferences.has(a.params.reference)));

        const lowerText = turnText.toLowerCase();

        // Sort actions by order of first mention in response
        actions.sort((a, b) => {
          const aKey = a.params.reference ?? "";
          const bKey = b.params.reference ?? "";
          const aPos = lowerText.indexOf(aKey.toLowerCase());
          const bPos = lowerText.indexOf(bKey.toLowerCase());
          return (aPos === -1 ? Infinity : aPos) - (bPos === -1 ? Infinity : bPos);
        });

        flushHeldBlocks();
        if (quickReplies) write({ type: "block", block: quickReplies });

        if (finished && isGreeting && blockKinds.includes("map_card") && args.input.selectionState === "visible") {
          const greetingMap = buildChapterGreetingMap(passagePlaces, nextBlockId());
          if (greetingMap) {
            blocks.push(greetingMap);
            write({ type: "block", block: greetingMap });
          }
        }

        const suggestedQuestions = await questionsPromise;
        if (Array.isArray(suggestedQuestions) && suggestedQuestions.length) {
          write({ type: "suggested_questions", questions: suggestedQuestions });
        }

        if (finished) write({ type: "actions", actions });
        write({ type: "done", conversationId, items, ...(finished ? {} : { pendingToolCalls }) });
        stage = "done";
        chatLog("info", "stream_success", {
          correlationId,
          conversationId,
          userId: redactId(userId),
          entrypoint,
          mode,
          responseId: responseId ? redactId(responseId) : null,
          answerLen: finalText.length,
          pendingToolCalls: pendingToolCalls.map((call) => call.name),
          uiBlocks: blocks.length,
          mapPlaces: blocks.reduce((n, b) => n + (b.kind === "map_card" ? b.places.length : 0), 0),
          latencyMs: Date.now() - requestStartTime,
          stages: stageMarks.join(" "),
        });
        controller.close();
      } catch (err) {
        const error = safeErrorDetails(err);
        chatLog("error", "stream_failed", {
          correlationId,
          stage,
          conversationId,
          userId: redactId(userId),
          entrypoint,
          mode,
          latencyMs: Date.now() - requestStartTime,
          error,
        });
        write({ type: "error", message: error.message });
        controller.close();
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
