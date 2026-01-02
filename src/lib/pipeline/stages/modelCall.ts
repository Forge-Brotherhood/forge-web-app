/**
 * MODEL_CALL Stage
 *
 * Executes the model call and records tool transcript.
 * Uses direct fetch to OpenAI API (matching existing codebase pattern).
 */

import type { RunContext } from "../types";
import type { StageOutput } from "../orchestrator";
import {
  MODEL_CALL_SCHEMA_VERSION,
  type ModelCallPayload,
  type ToolTranscriptEntry,
} from "../payloads/modelCall";
import type { PromptAssemblyPayload, FullPromptData } from "../payloads/promptAssembly";
import { retrieveFromVault } from "../vault";
import { createSideEffects } from "../sideEffects";
import { PipelineStage } from "../types";

// =============================================================================
// OpenAI Types (subset needed for our use)
// =============================================================================

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  refusal?: string | null;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// =============================================================================
// Tool Execution
// =============================================================================

interface ToolResult {
  result?: unknown;
  error?: { type: string; message: string };
}

/**
 * Execute a tool call and return the result.
 */
async function executeToolCall(
  toolCall: OpenAIToolCall,
  ctx: RunContext
): Promise<ToolResult> {
  const sideEffects = createSideEffects(ctx);
  const args = JSON.parse(toolCall.function.arguments);

  try {
    switch (toolCall.function.name) {
      case "save_insight": {
        await sideEffects.writeMemory(ctx.userId, {
          memoryType: "verse_insight",
          value: {
            verseReference: args.verseReference,
            insight: args.insight,
          },
          source: "tool_call",
        });
        return { result: { success: true } };
      }

      case "suggest_actions": {
        // This tool creates tappable UI elements for verse references and prayers
        // The actions are returned to the frontend for rendering - no persistence needed
        return {
          result: {
            success: true,
            actions: args.actions || [],
          },
        };
      }

      default:
        return {
          error: {
            type: "unknown_tool",
            message: `Unknown tool: ${toolCall.function.name}`,
          },
        };
    }
  } catch (error) {
    return {
      error: {
        type: "execution_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// =============================================================================
// Preview Helpers
// =============================================================================

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

// =============================================================================
// Stage Executor
// =============================================================================

/**
 * Execute the MODEL_CALL stage.
 */
export async function executeModelCallStage(
  ctx: RunContext,
  promptPayload: PromptAssemblyPayload
): Promise<StageOutput<ModelCallPayload>> {
  const startTime = Date.now();

  console.log("[ModelCall] Starting with rawRef:", promptPayload.rawRef);

  // Get full prompt data from vault or reconstruct
  let fullPromptData: FullPromptData | null = null;
  if (promptPayload.rawRef) {
    const parsed = promptPayload.rawRef.match(/^vault:\/\/([^/]+)\/(.+)$/);
    console.log("[ModelCall] Parsed vault ref:", parsed);
    if (parsed) {
      fullPromptData = (await retrieveFromVault(
        parsed[1],
        parsed[2] as PipelineStage
      )) as FullPromptData | null;
      console.log("[ModelCall] Retrieved from vault:", fullPromptData ? "success" : "null");
    }
  }

  // If we couldn't get from vault, we need to reconstruct (this shouldn't happen in normal flow)
  if (!fullPromptData) {
    // This is a fallback - in normal operation, we'd have the raw data
    console.warn("[ModelCall] No vault data, using minimal prompt. rawRef was:", promptPayload.rawRef);
    fullPromptData = {
      systemPrompt: "",
      messages: [{ role: "user", content: ctx.message }],
      toolSchemas: [],
    };
  }

  // Build request body
  const requestBody: Record<string, unknown> = {
    model: promptPayload.modelRequestRedacted.model,
    messages: fullPromptData.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: promptPayload.modelRequestRedacted.temperature,
    max_completion_tokens: promptPayload.modelRequestRedacted.maxTokens,
    reasoning_effort: "none", // Disable reasoning tokens for GPT-5.1
  };

  // Add tools if we have any
  if (fullPromptData.toolSchemas.length > 0) {
    requestBody.tools = fullPromptData.toolSchemas;
  }

  // Execute the model call using fetch
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  const latencyMs = Date.now() - startTime;
  const choice = data.choices[0];

  // Build tool transcript if tools were called
  const toolTranscript: ToolTranscriptEntry[] = [];

  if (choice.message.tool_calls) {
    for (const toolCall of choice.message.tool_calls) {
      const toolStartTime = Date.now();

      // Execute the tool
      const toolResult = await executeToolCall(toolCall, ctx);

      toolTranscript.push({
        name: toolCall.function.name,
        args: JSON.parse(toolCall.function.arguments),
        latencyMs: Date.now() - toolStartTime,
        outputRedacted: truncate(JSON.stringify(toolResult), 200),
        success: !toolResult.error,
        errorType: toolResult.error?.type,
      });
    }
  }

  // OpenAI may return `content: null` with a `refusal` string for safety reasons.
  // Our API contract expects a text response, so prefer content, then refusal, then empty.
  const responseSource: "content" | "refusal" | "empty" =
    choice.message.content != null ? "content" : choice.message.refusal != null ? "refusal" : "empty";
  const responseContent = choice.message.content ?? choice.message.refusal ?? "";

  const payload: ModelCallPayload = {
    schemaVersion: MODEL_CALL_SCHEMA_VERSION,
    model: data.model,
    temperature: promptPayload.modelRequestRedacted.temperature,
    maxTokens: promptPayload.modelRequestRedacted.maxTokens,
    latencyMs,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    finishReason: choice.finish_reason ?? "unknown",
    toolTranscript,
    responsePreview: responseContent,
    responseLength: responseContent.length,
    responseSource,
  };

  return {
    payload,
    summary: `${data.model}, ${latencyMs}ms, ${toolTranscript.length} tool calls`,
    stats: {
      latencyMs,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      toolCallCount: toolTranscript.length,
    },
    // Store full response in vault
    rawContent: {
      fullResponse: data,
      toolResults: toolTranscript,
    },
  };
}
