import { streamResponsesWithTools, type ContextToolCall } from "@/lib/openai/responsesClient";
import type { ResponsesTool } from "@/lib/openai/responsesClient";
import type { ResponsesInputMessage } from "@/lib/openai/responsesClient";

export type RunMainChatResponseArgs = {
  openaiApiKey: string;
  model: string;
  previousResponseId: string | null;
  messages: ResponsesInputMessage[];
  tools: ResponsesTool[];
  maxToolIterations: number;
  signal?: AbortSignal;
  executeToolCall: (call: ContextToolCall) => Promise<string>;
  onTextDelta?: (delta: string) => void;
  onToolCall?: (call: ContextToolCall) => void;
  onToolResult?: (call: ContextToolCall, output: string) => void;
};

export async function runMainChatResponse(args: RunMainChatResponseArgs): Promise<{
  finalText: string;
  responseId: string | null;
}> {
  let finalText = "";

  const normalizeAssistantDelta = (delta: string): string => {
    // Enforce "single paragraph, no line breaks" at runtime.
    // We normalize any newlines into spaces and collapse excess whitespace.
    const normalized = delta.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
    if (!normalized) return "";
    if (finalText.endsWith(" ") && normalized.startsWith(" ")) return normalized.trimStart();
    return normalized;
  };

  const result = await streamResponsesWithTools({
    apiKey: args.openaiApiKey,
    model: args.model,
    previousResponseId: args.previousResponseId,
    input: args.messages,
    tools: args.tools,
    maxToolIterations: args.maxToolIterations,
    signal: args.signal,
    onTextDelta: (delta) => {
      if (!delta) return;
      const next = normalizeAssistantDelta(delta);
      if (!next) return;
      finalText += next;
      args.onTextDelta?.(next);
    },
    onToolCall: async (call) => {
      args.onToolCall?.(call);
      const output = await args.executeToolCall(call);
      args.onToolResult?.(call, output);
      return output;
    },
  });

  return { finalText, responseId: result.responseId ?? null };
}

