import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateInternalApiKey } from "../_internalApiKey";
import { createRunContext } from "@/lib/pipeline/context";
import { executeIngressStage } from "@/lib/pipeline/stages/ingress";
import { executeContextCandidatesStage } from "@/lib/pipeline/stages/contextCandidates";
import { compactContextCandidatesPayload } from "@/lib/guide/contextCompact";
import { getAiContextForUser } from "@/lib/ai/userContext";
import { compressContextBundle } from "@/lib/guide/contextCompress";

const requestSchema = z.object({
  userId: z.string().min(1),
  enabledActions: z.array(z.string().min(1).max(64)).max(32).optional(),
  debugMode: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Invalid or missing internal API key" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const input = requestSchema.parse(body);

    let aiContext: { userContext: Record<string, unknown> } | undefined;
    try {
      const userAiContext = await getAiContextForUser(input.userId);
      aiContext = { userContext: userAiContext as unknown as Record<string, unknown> };
    } catch (error) {
      // Best-effort: missing aiContext should not block rich-context debugging.
      console.warn("[suggestion-debugger/context-candidates] Failed to load aiContext:", error);
    }

    const ctx = createRunContext({
      traceId: `debugger_${Date.now()}`,
      userId: input.userId,
      entrypoint: "chat_start",
      message: "",
      mode: "debug",
      sideEffects: "disabled",
      writePolicy: "forbid",
      appVersion: "admin-debugger",
      platform: "admin",
      locale: "en",
      aiContext,
    });

    const ingress = await executeIngressStage(ctx);
    // Debugger-specific: rich-context should focus on the last week (not last month).
    // We intentionally override the deterministic chat_start plan here, without changing
    // production chat_start behavior.
    (ingress.payload.plan as any) = {
      ...(ingress.payload.plan as any),
      retrieval: {
        ...(ingress.payload.plan as any).retrieval,
        filters: {
          ...((ingress.payload.plan as any).retrieval?.filters ?? {}),
          temporal: {
            ...((ingress.payload.plan as any).retrieval?.filters?.temporal ?? {}),
            range: "last_week",
          },
        },
      },
    };

    const candidates = await executeContextCandidatesStage(ctx, ingress.payload);

    const raw = {
      plan: candidates.payload.plan,
      candidates: candidates.payload.candidates,
      bySourceCounts: candidates.payload.bySourceCounts,
    };
    const compact = compressContextBundle({
      raw,
      enabledActions: input.enabledActions,
    });
    const compactedRaw = compactContextCandidatesPayload(raw);

    return NextResponse.json({
      compact,
      ...(input.debugMode ? { raw: compactedRaw } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to build context candidates", details: message }, { status: 500 });
  }
}


