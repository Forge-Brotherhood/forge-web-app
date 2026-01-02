/**
 * PROMPT_ASSEMBLY Stage Payload
 *
 * Output from the prompt building stage.
 */

import type { TokenEstimateMethod } from "../types";

export const PROMPT_ASSEMBLY_SCHEMA_VERSION = "1.0.0";

export interface PromptAssemblyPayload {
  schemaVersion: typeof PROMPT_ASSEMBLY_SCHEMA_VERSION;
  modelRequestRedacted: {
    model: string;
    messagesPreview: Array<{
      role: string;
      contentPreview: string;
      contentLength: number;
    }>;
    messagesCount: number;
    tools: string[];
    temperature: number;
    maxTokens: number;
  };
  tokenBreakdown: {
    systemPrompt: number;
    context: number;
    conversationHistory: number;
    userMessage: number;
    total: number;
    estimateMethod: TokenEstimateMethod;
  };
  promptVersion: string;
  toolSchemaVersion: string;
  rawRef?: string; // Vault pointer: "vault://runId/PROMPT_ASSEMBLY"
}

// Internal type for full prompt data (stored in vault, not artifact)
export interface FullPromptData {
  systemPrompt: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  toolSchemas: unknown[];
}
