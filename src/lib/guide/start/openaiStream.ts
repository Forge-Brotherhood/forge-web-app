import type { ZodType } from "zod";
import { CONTEXT_SYSTEM_PROMPT_NDJSON, type ContextGuideEvent } from "@/lib/guide/contextNdjson";
import { runContextNdjsonSession, type ContextRunDebugSummary } from "@/lib/guide/contextRun";

export const createGuideStartStream = (args: {
  apiKey: string;
  userFirstName: string | null;
  contextPayload: unknown;
  validateEvent: ZodType<ContextGuideEvent>;
  debugMode: boolean;
}): ReadableStream<Uint8Array> => {
  const abortController = new AbortController();

  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const encoder = new TextEncoder();
      let isClosed = false;

      const closeOnce = () => {
        if (isClosed) return;
        isClosed = true;
        controller.close();
      };

      const enqueueLine = (obj: unknown) => {
        if (isClosed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };

      try {
        await runContextNdjsonSession({
          apiKey: args.apiKey,
          systemPrompt: CONTEXT_SYSTEM_PROMPT_NDJSON,
          userFirstName: args.userFirstName,
          contextPayload: args.contextPayload,
          validateEvent: args.validateEvent,
          modelConfig: { model: "gpt-5.1-chat-latest", maxCompletionTokens: 900 },
          signal: abortController.signal,
          onEvent: enqueueLine,
          onDebugSummary: args.debugMode
            ? (summary) => {
                const out: ContextRunDebugSummary = { ...summary, scope: "guide_start" };
                enqueueLine(out);
              }
            : undefined,
          debugScope: "guide_start",
        });
      } catch (error) {
        console.error("[GuideStart] Streaming failed:", error);
        closeOnce();
      }
    },
    cancel: () => {
      abortController.abort();
    },
  });
};
