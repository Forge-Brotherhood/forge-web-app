/**
 * POST /api/internal/debug-run/:runId/followup
 *
 * Internal API for starting a follow-up debug run from a previous run.
 * Builds conversation history from the parent run for multi-turn debugging.
 * Called by forge-admin-app. Protected by INTERNAL_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { prisma } from "@/lib/prisma";
import { PipelineStage } from "@/lib/pipeline/types";
import { runPipeline } from "@/lib/pipeline/orchestrator";
import { createRunContext } from "@/lib/pipeline/context";
import { getAiContextForUser } from "@/lib/ai/userContext";
import { generateAndCreateSessionSummaryArtifact } from "@/lib/artifacts/sessionSummaryService";
import type { ConversationMessage } from "@/lib/conversation";
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
  adminId: z.string(),
  newMessage: z.string().min(1).max(5000),
  stopAtStage: z.nativeEnum(PipelineStage).optional(),
  includeRaw: z.boolean(),
  runModel: z.boolean(),
  createArtifact: z.boolean().optional(),
});

// =============================================================================
// Response Types
// =============================================================================

interface FollowUpRunResponse {
  runId: string;
  parentRunId: string;
  traceId: string;
  status: "running" | "stopped" | "completed" | "error";
  stoppedAtStage?: PipelineStage | null;
  errorMessage?: string;
}

interface DebugRunSettings {
  includeRaw: boolean;
  runModel: boolean;
  persistMemories?: boolean;
  providerOverrides?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

// =============================================================================
// POST Handler
// =============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId: parentRunId } = await params;

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

    // 3. Fetch parent debug run
    const parentRun = await prisma.debugRun.findUnique({
      where: { runId: parentRunId },
    });

    if (!parentRun) {
      return NextResponse.json(
        { error: "Parent debug run not found" },
        { status: 404 }
      );
    }

    if (parentRun.status !== "completed") {
      return NextResponse.json(
        { error: `Cannot follow up on run with status: ${parentRun.status}. Run must be completed.` },
        { status: 400 }
      );
    }

    if (!parentRun.lastAssistantMessage) {
      return NextResponse.json(
        { error: "Parent run has no assistant response to chain from" },
        { status: 400 }
      );
    }

    // 4. Build conversation history from parent
    const parentHistory =
      (parentRun.conversationHistory as ConversationMessage[] | null) ?? [];
    const newConversationHistory: ConversationMessage[] = [
      ...parentHistory,
      { role: "user", content: parentRun.message },
      { role: "assistant", content: parentRun.lastAssistantMessage },
    ];

    // 5. Generate new IDs (use new traceId for separate trace)
    const traceId = `dbg_${nanoid(16)}`;
    const runId = `run_${nanoid(12)}`;

    // 6. Determine stop stage based on runModel flag
    let effectiveStopAtStage = input.stopAtStage;
    if (!input.runModel && !effectiveStopAtStage) {
      effectiveStopAtStage = PipelineStage.PROMPT_ASSEMBLY;
    }

    // 7. Get parent settings for provider overrides
    const parentSettings = parentRun.settings as unknown as DebugRunSettings;

    // 8. Create new DebugRun record linked to parent
    // Inherit persistMemories from parent run
    const persistMemories = parentSettings.persistMemories || false;

    await prisma.debugRun.create({
      data: {
        runId,
        traceId,
        adminId: input.adminId,
        impersonatedUserId: parentRun.impersonatedUserId,
        entrypoint: "followup", // Follow-up runs use followup entrypoint
        message: input.newMessage,
        entityRefs: parentRun.entityRefs || [],
        status: "running",
        settings: {
          includeRaw: input.includeRaw,
          runModel: input.runModel,
          persistMemories, // Inherit from parent
          providerOverrides: parentSettings.providerOverrides,
        },
        parentRunId: parentRun.id, // Use the parent's id (CUID), not runId
        conversationHistory: newConversationHistory as unknown as Prisma.InputJsonValue,
      },
    });

    console.log(
      `[INTERNAL-DEBUG] FOLLOW-UP: Creating follow-up run ${runId} from parent ${parentRunId}`
    );

    // 9. Get AI context for the impersonated user
    let aiContext: { userContext: Record<string, unknown> } | undefined;
    try {
      const userAiContext = await getAiContextForUser(parentRun.impersonatedUserId);
      aiContext = { userContext: userAiContext as unknown as Record<string, unknown> };
    } catch (error) {
      console.warn("[INTERNAL-DEBUG] Failed to get AI context:", error);
    }

    // 10. Create run context with conversation history
    const entityRefs = parentRun.entityRefs as Array<{
      type: "verse" | "chapter" | "book" | "theme";
      reference: string;
      text?: string;
    }> | null;

    const ctx = createRunContext({
      traceId,
      userId: parentRun.impersonatedUserId,
      entrypoint: "followup",
      message: input.newMessage,
      entityRefs: entityRefs || undefined,
      mode: "debug",
      stopAtStage: effectiveStopAtStage,
      sideEffects: persistMemories ? "enabled" : "disabled",
      writePolicy: "forbid",
      appVersion: "admin-debug-1.0",
      platform: "web-admin",
      conversationHistory: newConversationHistory,
      aiContext,
    });

    // Override runId
    ctx.runId = runId;

    // 11. Execute pipeline
    let finalStatus: FollowUpRunResponse["status"] = "running";
    let stoppedAtStage: PipelineStage | undefined;
    let errorMessage: string | undefined;

    try {
      const result = await runPipeline(ctx);

      if (result.stoppedAt) {
        finalStatus = "stopped";
        stoppedAtStage = result.stoppedAt;
      } else {
        finalStatus = "completed";
      }

      // Extract assistant response for chaining
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
          stoppedAtStage: stoppedAtStage || null,
          lastAssistantMessage,
        },
      });

      // Create artifact if requested and pipeline completed successfully
      if (input.createArtifact && finalStatus === "completed") {
        // Build full conversation for summarization
        const fullConversation = [
          ...newConversationHistory,
          { role: "user", content: input.newMessage },
          ...(lastAssistantMessage ? [{ role: "assistant", content: lastAssistantMessage }] : []),
        ];

        // Fire-and-forget async artifact generation with LLM summary
        generateAndCreateSessionSummaryArtifact({
          userId: parentRun.impersonatedUserId,
          sessionId: runId,
          turns: fullConversation,
          metadata: {
            source: "admin-debugger",
            debugRunId: runId,
            parentRunId: parentRunId,
            traceId,
          },
        })
          .then(() => console.log(`[INTERNAL-DEBUG] Created summary artifact for run ${runId}`))
          .catch((err) => console.error("[INTERNAL-DEBUG] Failed to create summary artifact:", err));
      }
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

      console.error("[INTERNAL-DEBUG] Follow-up pipeline error:", pipelineError);
    }

    const response: FollowUpRunResponse = {
      runId,
      parentRunId,
      traceId,
      status: finalStatus,
      stoppedAtStage,
      errorMessage,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("[INTERNAL-DEBUG] Error creating follow-up run:", error);
    return NextResponse.json(
      { error: "Failed to create follow-up run" },
      { status: 500 }
    );
  }
}
