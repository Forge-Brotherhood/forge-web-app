import { streamResponsesWithTools, type ContextToolCall, type ToolCallStart } from "@/lib/openai/responsesClient";
import type { ResponsesTool } from "@/lib/openai/responsesClient";
import type { ResponsesInputMessage } from "@/lib/openai/responsesClient";

export type RunMainChatResponseArgs = {
  openaiApiKey: string;
  model: string;
  instructions: ResponsesInputMessage[];
  history: unknown[];
  input: unknown[];
  tools: ResponsesTool[];
  maxToolIterations: number;
  signal?: AbortSignal;
  reasoningEffort?: "low" | "medium" | "high";
  executeToolCall: (call: ContextToolCall) => Promise<string>;
  isClientToolCall?: (call: ContextToolCall) => boolean;
  isFinalToolCall?: (call: ContextToolCall) => boolean;
  onTextDelta?: (delta: string) => void;
  onToolCall?: (call: ContextToolCall) => void;
  onToolResult?: (call: ContextToolCall, output: string) => void;
  onToolCallStarted?: (call: ToolCallStart) => void;
  onToolCallArgumentsDelta?: (itemId: string, delta: string) => void;
};

export async function runMainChatResponse(args: RunMainChatResponseArgs): Promise<{
  finalText: string;
  responseId: string | null;
  items: unknown[];
  pendingToolCalls: ContextToolCall[];
  usage: unknown[];
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
    instructions: args.instructions,
    history: args.history,
    input: args.input,
    tools: args.tools,
    maxToolIterations: args.maxToolIterations,
    signal: args.signal,
    reasoningEffort: args.reasoningEffort,
    isClientToolCall: args.isClientToolCall,
    isFinalToolCall: args.isFinalToolCall,
    onToolCallStarted: args.onToolCallStarted,
    onToolCallArgumentsDelta: args.onToolCallArgumentsDelta,
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

  return {
    finalText,
    responseId: result.responseId ?? null,
    items: result.items,
    pendingToolCalls: result.pendingToolCalls,
    usage: result.usage,
  };
}
