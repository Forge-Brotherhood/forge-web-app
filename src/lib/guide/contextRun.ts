import type { ZodType } from "zod";
import type { ContextGuideEvent } from "@/lib/guide/contextNdjson";

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: { content?: string | null };
  }>;
};

type DropReason = string;

export type ContextRunModelConfig = {
  model: string;
  temperature?: number;
  maxCompletionTokens: number;
};

export type ContextRunDebugSummary = {
  type: "debug";
  scope: "guide_start" | "context_run";
  dropped: Record<string, number>;
  accepted_suggestions: number;
  used_fallback: boolean;
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const supportsTemperatureOverride = (model: string): boolean =>
  !model.toLowerCase().startsWith("gpt-5");

const toDroppedRecord = (droppedCounts: Map<DropReason, number>): Record<string, number> => {
  const dropped: Record<string, number> = {};
  for (const [k, v] of droppedCounts) dropped[k] = v;
  return dropped;
};

export async function runContextNdjsonSession(args: {
  apiKey: string;
  systemPrompt: string;
  userFirstName: string | null;
  contextPayload: unknown;
  validateEvent: ZodType<ContextGuideEvent>;
  modelConfig: ContextRunModelConfig;
  signal?: AbortSignal;
  onEvent: (event: ContextGuideEvent) => void;
  onDebugSummary?: (summary: ContextRunDebugSummary) => void;
  debugScope?: ContextRunDebugSummary["scope"];
}) {
  let rawModelText = "";

  const droppedCounts = new Map<DropReason, number>();
  let suggestionCount = 0;
  let hasDone = false;

  const recordDrop = (reason: DropReason) =>
    droppedCounts.set(reason, (droppedCounts.get(reason) ?? 0) + 1);

  const emitDebugSummaryOnce = () => {
    if (!args.onDebugSummary) return;
    const summary: ContextRunDebugSummary = {
      type: "debug",
      scope: args.debugScope ?? "context_run",
      dropped: toDroppedRecord(droppedCounts),
      accepted_suggestions: suggestionCount,
      used_fallback: false,
    };
    args.onDebugSummary(summary);
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    signal: args.signal,
    body: JSON.stringify({
      model: args.modelConfig.model,
      ...(supportsTemperatureOverride(args.modelConfig.model) && args.modelConfig.temperature !== undefined
        ? { temperature: args.modelConfig.temperature }
        : {}),
      max_completion_tokens: args.modelConfig.maxCompletionTokens,
      stream: true,
      messages: [
        { role: "system", content: args.systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            ...(isRecord(args.contextPayload) ? args.contextPayload : { context: args.contextPayload }),
            user: { first_name: args.userFirstName?.trim() ? args.userFirstName.trim() : null },
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }
  if (!response.body) throw new Error("OpenAI response has no body");

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let sseBuffer = "";
  let ndjsonBuffer = "";

  const processNdjsonLines = () => {
    while (true) {
      const newlineIndex = ndjsonBuffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const rawLine = ndjsonBuffer.slice(0, newlineIndex).trim();
      ndjsonBuffer = ndjsonBuffer.slice(newlineIndex + 1);
      if (!rawLine) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawLine);
      } catch {
        recordDrop("invalid_json");
        continue;
      }

      const validated = args.validateEvent.safeParse(parsed);
      if (!validated.success) {
        recordDrop("schema_validation_failed");
        const msg = validated.error.issues[0]?.message ?? "";
        if (msg.includes("subtitle must be one sentence")) recordDrop("schema_fail.subtitle_one_sentence");
        else if (msg.includes("evidence_ids must come from context")) recordDrop("schema_fail.evidence_ids_not_allowed");
        else if (msg.includes("action.type must be enabled")) recordDrop("schema_fail.action_not_enabled");
        else recordDrop("schema_fail.other");
        continue;
      }

      const event = validated.data;

      if (event.type === "suggestion") {
        if (hasDone) continue;
        if (suggestionCount >= 5) {
          recordDrop("max_suggestions_reached");
          continue;
        }
        args.onEvent(event);
        suggestionCount += 1;
        continue;
      }

      // done
      if (hasDone) continue;
      if (suggestionCount < 3 || suggestionCount > 5) {
        recordDrop("invalid_suggestion_count");
        continue;
      }
      emitDebugSummaryOnce();
      args.onEvent(event);
      hasDone = true;
    }
  };

  const processSseEvents = () => {
    while (true) {
      const sep = sseBuffer.indexOf("\n\n");
      if (sep === -1) return;

      const eventBlock = sseBuffer.slice(0, sep);
      sseBuffer = sseBuffer.slice(sep + 2);

      for (const line of eventBlock.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.replace(/^data:\s?/, "");
        if (!data) continue;
        if (data === "[DONE]") return;

        try {
          const chunk = JSON.parse(data) as OpenAIStreamChunk;
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length) {
            rawModelText += delta;
            ndjsonBuffer += delta;
            processNdjsonLines();
          }
        } catch {
          // ignore malformed SSE chunks
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    processSseEvents();
    if (hasDone) break;
  }

  // best-effort flush
  processNdjsonLines();

  return {
    rawModelText,
    parsed: {
      hasDone,
      acceptedSuggestions: suggestionCount,
      dropped: toDroppedRecord(droppedCounts),
    },
  };
}


