/**
 * POST /api/internal/debug-run/:runId/continue
 *
 * Internal API for continuing a stopped debug run.
 * Called by forge-admin-app. Protected by INTERNAL_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PipelineStage } from "@/lib/pipeline/types";
import { getNextStage, runPipeline } from "@/lib/pipeline/orchestrator";
import { createRunContext } from "@/lib/pipeline/context";
import { getAiContextForUser } from "@/lib/ai/userContext";
import { Prisma } from "@prisma/client";

// =============================================================================
// Internal API Key Validation
// =============================================================================

function validateInternalApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get("x-internal-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.error("[INTERNAL-API] INTERNAL_API_KEY not configured");
    return false;
  }

  return apiKey === expectedKey;
}

// =============================================================================
// Request Schema
// =============================================================================

const requestSchema = z.object({
  stopAtStage: z.nativeEnum(PipelineStage).optional(),
});

// =============================================================================
// Response Types
// =============================================================================

interface ContinueRunResponse {
  runId: string;
  status: "running" | "stopped" | "completed" | "error";
  stoppedAtStage?: PipelineStage | null;
  newStagesCompleted: PipelineStage[];
  errorMessage?: string;
}

// =============================================================================
// POST Handler
// =============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  // 1. Validate internal API key
  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    // 2. Parse request
    const body = await request.json();
    const input = requestSchema.parse(body);

    // 3. Fetch debug run
    const debugRun = await prisma.debugRun.findUnique({
      where: { runId },
    });

    if (!debugRun) {
      return NextResponse.json(
        { error: "Debug run not found" },
        { status: 404 }
      );
    }

    if (debugRun.status !== "stopped") {
      return NextResponse.json(
        { error: `Cannot continue run with status: ${debugRun.status}` },
        { status: 400 }
      );
    }

    // 4. Determine next stage
    const stoppedAt = debugRun.stoppedAtStage as PipelineStage;
    const nextStage = getNextStage(stoppedAt);

    if (!nextStage) {
      return NextResponse.json(
        { error: "Run already completed all stages" },
        { status: 400 }
      );
    }

    // 5. Fetch existing artifacts to track new completions
    const existingArtifacts = await prisma.pipelineArtifact.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
    });
    const completedStages = existingArtifacts.map(
      (a) => a.stage as PipelineStage
    );

    // 6. Update run status
    await prisma.debugRun.update({
      where: { runId },
      data: {
        status: "running",
        stoppedAtStage: null,
      },
    });

    // When continuing, we want to proceed past the current stop point
    // Only apply a new stop stage if explicitly requested
    // Don't re-apply the original runModel restriction since user clicked "Continue"
    const effectiveStopAtStage = input.stopAtStage || undefined;

    // 7. Get AI context for the impersonated user
    let aiContext: { userContext: Record<string, unknown> } | undefined;
    try {
      const userAiContext = await getAiContextForUser(debugRun.impersonatedUserId);
      aiContext = { userContext: userAiContext as unknown as Record<string, unknown> };
    } catch (error) {
      console.warn("[INTERNAL-DEBUG] Failed to get AI context:", error);
    }

    // 8. Recreate context and continue pipeline
    const entityRefs = debugRun.entityRefs as Array<{
      type: "verse" | "chapter" | "book" | "theme";
      reference: string;
      text?: string;
    }> | null;

    const ctx = createRunContext({
      traceId: debugRun.traceId,
      userId: debugRun.impersonatedUserId,
      entrypoint: debugRun.entrypoint as
        | "chat_start"
        | "guide_followup"
        | "followup"
        | "explain",
      message: debugRun.message,
      entityRefs: entityRefs || undefined,
      mode: "debug",
      stopAtStage: effectiveStopAtStage,
      sideEffects: "disabled",
      writePolicy: "forbid",
      appVersion: "admin-debug-1.0",
      platform: "web-admin",
      aiContext,
    });

    // Override runId
    ctx.runId = runId;

    // 9. Continue pipeline execution
    let finalStatus: ContinueRunResponse["status"] = "running";
    let finalStoppedAtStage: PipelineStage | null = null;
    const newStagesCompleted: PipelineStage[] = [];
    let errorMessage: string | undefined;

    try {
      const result = await runPipeline(ctx);

      if (result.stoppedAt) {
        finalStatus = "stopped";
        finalStoppedAtStage = result.stoppedAt;
      } else {
        finalStatus = "completed";
      }

      // Track newly completed stages
      const newArtifacts = await prisma.pipelineArtifact.findMany({
        where: { runId },
        orderBy: { createdAt: "asc" },
      });

      for (const artifact of newArtifacts) {
        if (!completedStages.includes(artifact.stage as PipelineStage)) {
          newStagesCompleted.push(artifact.stage as PipelineStage);
        }
      }

      // Extract assistant response for follow-up chaining
      let lastAssistantMessage: string | null = null;
      if (finalStatus === "completed") {
        const modelCallArtifact = await prisma.pipelineArtifact.findUnique({
          where: { runId_stage: { runId, stage: PipelineStage.MODEL_CALL } },
          select: { payload: true },
        });
        if (modelCallArtifact?.payload) {
          const payload = modelCallArtifact.payload as { responsePreview?: string };
          lastAssistantMessage = payload.responsePreview || null;
        }
      }

      await prisma.debugRun.update({
        where: { runId },
        data: {
          status: finalStatus,
          stoppedAtStage: finalStoppedAtStage,
          lastAssistantMessage,
          conversationHistory: [
            ...(((debugRun.conversationHistory as unknown as Array<{
              role: "user" | "assistant";
              content: string;
            }>) ?? []) as Array<{ role: "user" | "assistant"; content: string }>),
            { role: "user", content: debugRun.message },
            ...(lastAssistantMessage
              ? [{ role: "assistant", content: lastAssistantMessage }]
              : []),
          ] as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (pipelineError) {
      finalStatus = "error";
      errorMessage =
        pipelineError instanceof Error
          ? pipelineError.message
          : String(pipelineError);

      await prisma.debugRun.update({
        where: { runId },
        data: {
          status: "error",
          errorMessage,
        },
      });

      console.error("[INTERNAL-DEBUG] Pipeline continuation error:", pipelineError);
    }

    const response: ContinueRunResponse = {
      runId,
      status: finalStatus,
      stoppedAtStage: finalStoppedAtStage,
      newStagesCompleted,
      errorMessage,
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("[INTERNAL-DEBUG] Error continuing run:", error);
    return NextResponse.json(
      { error: "Failed to continue run" },
      { status: 500 }
    );
  }
}
