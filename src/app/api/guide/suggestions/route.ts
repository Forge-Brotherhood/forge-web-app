import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getAllowedEvidenceIdsFromContext, getAllowedActionTypesFromContext } from "@/lib/guide/contextCompress";
import {
  buildGuideStartContext,
  guideStartRequestSchema,
  GuideStartContextError,
} from "@/lib/guide/start";
import { CONTEXT_SYSTEM_PROMPT_NDJSON, contextGuideEventSchema, type ContextGuideEvent } from "@/lib/guide/contextNdjson";
import { runContextNdjsonSession } from "@/lib/guide/contextRun";
import {
  getCachedGuideSuggestions,
  makeGuideSuggestionsCacheKey,
  setCachedGuideSuggestions,
} from "@/lib/guide/suggestionsCache";

export const runtime = "nodejs";

const ALLOWED_GUIDE_ACTIONS = [
  "continue_reading",
  "open_passage",
  "start_short_reading",
  "start_checkin",
  "open_conversation",
  "open_conversation_summary",
] as const;
type AllowedGuideAction = (typeof ALLOWED_GUIDE_ACTIONS)[number];

const normalizeEnabledActions = (enabled: unknown): AllowedGuideAction[] => {
  if (!Array.isArray(enabled)) return [...ALLOWED_GUIDE_ACTIONS];
  const filtered = enabled.filter((a): a is AllowedGuideAction => ALLOWED_GUIDE_ACTIONS.includes(a));
  return filtered.length ? filtered : [...ALLOWED_GUIDE_ACTIONS];
};

// Suggestions-only endpoint for the Home tab.
// Returns NDJSON: 3–5 suggestion events + done. (No greeting.)
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const validatedBody = guideStartRequestSchema.parse(body);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    const enabledActions = normalizeEnabledActions(validatedBody.enabledActions);
    const debugMode = request.headers.get("x-debug-mode") === "true";
    const forceRefresh = debugMode && request.headers.get("x-force-refresh") === "true";

    const { user, contextPayload, validateEvent } = await buildGuideStartContext({
      userId: authResult.userId,
      enabledActions,
    });

    const cacheKey = makeGuideSuggestionsCacheKey({
      userId: authResult.userId,
      enabledActions,
      // bump to invalidate older cached suggestions with legacy ref_key formats
      cacheVersion: "v2",
    });

    if (!forceRefresh) {
      const cached = await getCachedGuideSuggestions(cacheKey);
      if (cached?.ndjsonLines?.length) {
        const encoder = new TextEncoder();
        const replay = new ReadableStream<Uint8Array>({
          start: (controller) => {
            for (const line of cached.ndjsonLines) controller.enqueue(encoder.encode(`${line}\n`));
            controller.close();
          },
        });
        return new Response(replay, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "x-cache": "hit",
          },
        });
      }
    }

    // Recompute validateEvent from context payload so this endpoint can be a canonical source.
    const allowedEvidenceIds = getAllowedEvidenceIdsFromContext(contextPayload);
    const allowedActionTypes = getAllowedActionTypesFromContext(contextPayload) ?? [];
    const validate = contextGuideEventSchema({
      allowedEvidenceIds,
      allowedActionTypes: allowedActionTypes.length ? allowedActionTypes : undefined,
    });

    const emittedLines: string[] = [];
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const enqueue = (evt: ContextGuideEvent) => {
          const line = JSON.stringify(evt);
          emittedLines.push(line);
          controller.enqueue(encoder.encode(`${line}\n`));
        };

        try {
          await runContextNdjsonSession({
            apiKey,
            systemPrompt: CONTEXT_SYSTEM_PROMPT_NDJSON,
            userFirstName: user.firstName,
            contextPayload,
            validateEvent: validate,
            modelConfig: { model: "gpt-5.1-chat-latest", maxCompletionTokens: 900 },
            onEvent: enqueue,
            onDebugSummary: debugMode ? (s) => enqueue(s as unknown as ContextGuideEvent) : undefined,
            debugScope: "guide_start",
          });
        } catch (err) {
          controller.error(err);
          return;
        } finally {
          controller.close();
          // Best-effort cache write; never block the response.
          try {
            await setCachedGuideSuggestions(cacheKey, { ndjsonLines: emittedLines.filter(Boolean) });
          } catch {
            // ignore
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "x-cache": "miss",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request data", details: error.issues }, { status: 400 });
    }
    if (error instanceof GuideStartContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to get suggestions", details: message }, { status: 500 });
  }
}


