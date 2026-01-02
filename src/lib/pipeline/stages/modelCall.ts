/**
 * MODEL_CALL Stage
 *
 * Executes the model call.
 * Uses direct fetch to OpenAI API (matching existing codebase pattern).
 */

import type { RunContext } from "../types";
import type { StageOutput } from "../orchestrator";
import {
  MODEL_CALL_SCHEMA_VERSION,
  type ModelCallPayload,
} from "../payloads/modelCall";
import type { PromptAssemblyPayload, FullPromptData } from "../payloads/promptAssembly";
import { retrieveFromVault } from "../vault";
import { PipelineStage } from "../types";

// =============================================================================
// OpenAI Types (subset needed for our use)
// =============================================================================

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string | null;
  refusal?: string | null;
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
    prompt_tokens_details?: {
      cached_tokens?: number;
      audio_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
      audio_tokens?: number;
      accepted_prediction_tokens?: number;
      rejected_prediction_tokens?: number;
    };
  };
}

// =============================================================================
// Stage Executor
// =============================================================================

/**
 * Execute the MODEL_CALL stage.
 */
export async function executeModelCallStage(
  ctx: RunContext,
  promptPayload: PromptAssemblyPayload,
  fullPromptDataFromPromptAssembly?: FullPromptData | null
): Promise<StageOutput<ModelCallPayload>> {
  const startTime = Date.now();

  // Prefer in-memory prompt data from PROMPT_ASSEMBLY (works in production).
  // Vault is debug-only storage and may be empty in production.
  let fullPromptData: FullPromptData | null = fullPromptDataFromPromptAssembly ?? null;

  // Fallback: try retrieving from vault (useful for debug mode / replay).
  if (!fullPromptData && promptPayload.rawRef) {
    const parsed = promptPayload.rawRef.match(/^vault:\/\/([^/]+)\/(.+)$/);
    if (parsed) {
      fullPromptData = (await retrieveFromVault(
        parsed[1],
        parsed[2] as PipelineStage
      )) as FullPromptData | null;
    }
  }

  // Final fallback: minimal prompt (should not happen in normal flow)
  if (!fullPromptData) {
    console.warn(
      "[ModelCall] Missing full prompt data; using minimal prompt. rawRef was:",
      promptPayload.rawRef
    );
    fullPromptData = {
      systemPrompt: "",
      messages: [{ role: "user", content: ctx.message }],
    };
  }

  // Build request body
  const requestBody: Record<string, unknown> = {
    model: promptPayload.modelRequestRedacted.model,
    messages: fullPromptData.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    max_completion_tokens: promptPayload.modelRequestRedacted.maxTokens,
  };

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
    inputTokenDetails: data.usage?.prompt_tokens_details
      ? {
          cachedTokens: data.usage.prompt_tokens_details.cached_tokens ?? 0,
          audioTokens: data.usage.prompt_tokens_details.audio_tokens ?? 0,
        }
      : undefined,
    outputTokens: data.usage?.completion_tokens ?? 0,
    outputTokenDetails: data.usage?.completion_tokens_details
      ? {
          reasoningTokens: data.usage.completion_tokens_details.reasoning_tokens ?? 0,
          audioTokens: data.usage.completion_tokens_details.audio_tokens ?? 0,
          acceptedPredictionTokens:
            data.usage.completion_tokens_details.accepted_prediction_tokens ?? 0,
          rejectedPredictionTokens:
            data.usage.completion_tokens_details.rejected_prediction_tokens ?? 0,
        }
      : undefined,
    finishReason: choice.finish_reason ?? "unknown",
    responsePreview: responseContent,
    responseLength: responseContent.length,
    responseSource,
  };

  return {
    payload,
    summary: `${data.model}, ${latencyMs}ms`,
    stats: {
      latencyMs,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    // Store full response in vault
    rawContent: {
      fullResponse: data,
    },
  };
}
