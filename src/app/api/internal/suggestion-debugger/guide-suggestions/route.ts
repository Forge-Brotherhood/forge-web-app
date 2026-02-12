import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateInternalApiKey } from "../_internalApiKey";
import { buildSuggestionsContext } from "@/lib/context/buildSuggestionsContext";
import { CONTEXT_SYSTEM_PROMPT_NDJSON, type ContextGuideEvent } from "@/lib/guide/contextNdjson";
import { runContextNdjsonSession } from "@/lib/guide/contextRun";

const requestSchema = z.object({
  userId: z.string().min(1),
  enabledActions: z.array(z.string().min(1)).optional(),
  userFirstName: z.string().optional().nullable(),
});

// Parity helper for the admin debugger: run the same Home suggestions generation
// that production uses, but authenticated via internal API key.
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

    const enabledActions =
      input.enabledActions?.length
        ? input.enabledActions
        : [
            "continue_reading",
            "open_passage",
            "start_short_reading",
            "start_checkin",
            "open_conversation",
            "open_conversation_summary",
          ];

    const { user, contextPayload, validateEvent } = await buildSuggestionsContext({
      userId: input.userId,
      enabledActions,
    });

    const parsedEvents: ContextGuideEvent[] = [];
    const { rawModelText, parsed } = await runContextNdjsonSession({
      apiKey,
      systemPrompt: CONTEXT_SYSTEM_PROMPT_NDJSON,
      userFirstName: input.userFirstName?.trim() ? input.userFirstName.trim() : user.firstName,
      contextPayload,
      validateEvent,
      modelConfig: { model: "gpt-5.1-chat-latest", maxCompletionTokens: 900 },
      onEvent: (evt) => parsedEvents.push(evt),
      debugScope: "guide_start",
    });

    return NextResponse.json({
      rawModelText,
      parsedEvents,
      debugSummary: {
        dropped: parsed.dropped,
        accepted_suggestions: parsed.acceptedSuggestions,
        used_fallback: false,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to run guide suggestions", details: message }, { status: 500 });
  }
}


