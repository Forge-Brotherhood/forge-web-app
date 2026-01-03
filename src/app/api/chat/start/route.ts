import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAiContextForUser } from "@/lib/ai/userContext";
import { extractTraceContext } from "@/lib/observability";
import { createRunContext, PipelineStage, runPipeline } from "@/lib/pipeline";

const requestSchema = z.object({
  // Optional: allow client to pass a stable conversationId if desired later
  conversationId: z.string().min(1).max(128).optional(),
});

type ChatStartSuggestion = {
  title: string;
  subtitle?: string;
  prompt: string;
};

function getTimeOfDayGreeting(localHour: number | null): string | null {
  if (localHour == null || Number.isNaN(localHour)) return null;
  if (localHour >= 5 && localHour <= 11) return "morning";
  if (localHour >= 12 && localHour <= 16) return "afternoon";
  if (localHour >= 17 && localHour <= 21) return "evening";
  return "night";
}

function parseChatStartModelOutput(raw: string): {
  message: string;
  suggestions: ChatStartSuggestion[];
} {
  try {
    const parsed = JSON.parse(raw) as {
      message?: unknown;
      suggestions?: unknown;
    };

    const message =
      typeof parsed.message === "string" && parsed.message.trim().length > 0
        ? parsed.message
        : raw;

    const suggestionsRaw = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : [];

    const suggestions = suggestionsRaw
      .map((s): ChatStartSuggestion | null => {
        const obj = s as Record<string, unknown>;
        const title = typeof obj.title === "string" ? obj.title.trim() : "";
        const subtitle =
          typeof obj.subtitle === "string" ? obj.subtitle.trim() : undefined;
        const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
        if (!title || !prompt) return null;
        if (subtitle && subtitle.length > 0) {
          return { title, subtitle, prompt };
        }
        return { title, prompt };
      })
      .filter((s): s is ChatStartSuggestion => s !== null)
      .slice(0, 5);

    return { message, suggestions };
  } catch {
    return { message: raw, suggestions: [] };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const traceCtx = extractTraceContext(request, clerkUserId);

    const body = await request.json().catch(() => ({}));
    requestSchema.parse(body);

    const localHourHeader = request.headers.get("x-local-hour");
    const localHour = localHourHeader ? Number(localHourHeader) : null;
    const timeZone = request.headers.get("x-timezone") ?? undefined;
    const timeOfDay = getTimeOfDayGreeting(Number.isFinite(localHour) ? localHour : null);

    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true, firstName: true, displayName: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const aiContext = await getAiContextForUser(user.id);

    const userName =
      user.firstName?.trim() ||
      user.displayName?.trim() ||
      undefined;

    const ctx = createRunContext({
      traceId: traceCtx.traceId,
      userId: user.id,
      entrypoint: "chat_start",
      message:
        "This is the start of a brand new chat in the Forge app. Begin with a joyful, personal greeting using the user's first name when available, and the user's local time of day when available (good morning/afternoon/evening/night). Then suggest a few next activities they can do now inside the app based on their history: continue/resume their Bible reading, suggest a relevant passage to read next, invite them to share a concern/topic to talk about, and offer to follow up on a previous conversation if appropriate. Output JSON only with keys: message (string) and suggestions (array of {title, subtitle?, prompt}).",
      entityRefs: [],
      mode: "prod",
      sideEffects: "enabled",
      writePolicy: "allow",
      appVersion: traceCtx.appVersion,
      platform: traceCtx.platform,
      initialContext: JSON.stringify({
        greetingContext: {
          userFirstName: userName,
          timeOfDay,
          localHour: Number.isFinite(localHour) ? localHour : null,
          timeZone,
        },
      }),
      aiContext: aiContext
        ? { userContext: aiContext as unknown as Record<string, unknown> }
        : undefined,
    });

    const result = await runPipeline(ctx);

    // Debug stop support (same pattern as followup route)
    if (result.stoppedAt) {
      return NextResponse.json({
        runId: ctx.runId,
        stoppedAt: result.stoppedAt,
        artifacts: result.artifacts,
        _traceId: traceCtx.traceId,
      });
    }

    const modelCallArtifact = result.artifacts.find(
      (a) => a.stage === PipelineStage.MODEL_CALL
    );
    const responsePreview =
      (modelCallArtifact?.payload as { responsePreview?: string } | undefined)
        ?.responsePreview ?? "";

    const { message, suggestions } = parseChatStartModelOutput(responsePreview);

    return NextResponse.json({
      message,
      suggestions,
      _traceId: traceCtx.traceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to start chat", details: message },
      { status: 500 }
    );
  }
}


