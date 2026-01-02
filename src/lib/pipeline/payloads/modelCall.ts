/**
 * MODEL_CALL Stage Payload
 *
 * Output from the model execution stage.
 */

export const MODEL_CALL_SCHEMA_VERSION = "1.0.0";

export interface ModelCallPayload {
  schemaVersion: typeof MODEL_CALL_SCHEMA_VERSION;
  model: string;
  temperature: number;
  maxTokens: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  responsePreview: string; // Always redacted
  responseLength: number;
  /**
   * Indicates where the response text came from.
   * Some OpenAI responses can return `content: null` with a separate `refusal` string.
   */
  responseSource: "content" | "refusal" | "empty";
}
