import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateInternalApiKey } from "../_internalApiKey";
import {
  CONTEXT_SYSTEM_PROMPT_NDJSON,
  contextGuideEventSchema,
  type ContextGuideEvent,
} from "@/lib/guide/contextNdjson";
import { compactContextCandidatesPayload } from "@/lib/guide/contextCompact";
import { getAllowedActionTypesFromContext, getAllowedEvidenceIdsFromContext } from "@/lib/guide/contextCompress";
import { runContextNdjsonSession } from "@/lib/guide/contextRun";

const providerOverridesSchema = z
  .object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(16000).optional(),
  })
  .optional();

const requestSchema = z.object({
  userId: z.string().min(1),
  contextPayload: z.unknown(),
  userFirstName: z.string().optional().nullable(),
  debugMode: z.boolean().optional(),
  providerOverrides: providerOverridesSchema,
});
export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Invalid or missing internal API key" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const input = requestSchema.parse(body);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    // Always compact the payload (even if the user pasted something huge).
    const compactedPayload = compactContextCandidatesPayload(input.contextPayload) as any;

    const allowedEvidenceIds = getAllowedEvidenceIdsFromContext(compactedPayload);
    const allowedActionTypes = getAllowedActionTypesFromContext(compactedPayload);
    const validateEvent = contextGuideEventSchema({
      allowedEvidenceIds,
      allowedActionTypes: allowedActionTypes ?? undefined,
    });

    const model = input.providerOverrides?.model ?? "gpt-5.1-chat-latest";
    const parsedEvents: ContextGuideEvent[] = [];
    const { rawModelText, parsed } = await runContextNdjsonSession({
      apiKey,
      systemPrompt: CONTEXT_SYSTEM_PROMPT_NDJSON,
      userFirstName: input.userFirstName?.trim() ? input.userFirstName.trim() : null,
      contextPayload: compactedPayload,
      validateEvent,
      modelConfig: {
        model,
        temperature: input.providerOverrides?.temperature,
        maxCompletionTokens: input.providerOverrides?.maxTokens ?? 900,
      },
      onEvent: (evt) => parsedEvents.push(evt),
      debugScope: "context_run",
    });

    const debugSummary = {
      dropped: parsed.dropped,
      accepted_suggestions: parsed.acceptedSuggestions,
      used_fallback: false,
    };

    return NextResponse.json({
      rawModelText,
      parsedEvents,
      debugSummary,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to run context debugger", details: message }, { status: 500 });
  }
}


