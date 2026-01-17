/**
 * POST /api/internal/debug-run
 *
 * Internal API for starting a debug pipeline run.
 * Called by forge-admin-app. Protected by INTERNAL_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { prisma } from "@/lib/prisma";
import { createRunContext } from "@/lib/pipeline/context";
import { runPipeline } from "@/lib/pipeline/orchestrator";
import { PipelineStage } from "@/lib/pipeline/types";
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

const entityRefSchema = z.object({
  type: z.enum(["verse", "chapter", "book", "theme"]),
  reference: z.string(),
  text: z.string().optional(),
});

const requestSchema = z.object({
  // Admin context (for audit logging)
  adminId: z.string(),
  adminEmail: z.string().optional(),

  // Debug run configuration
  impersonatedUserId: z.string(),
  entrypoint: z.enum(["chat_start", "guide_followup", "followup", "explain"]),
  // chat_start can be invoked with an empty message (server will inject default).
  message: z.string().max(5000),
  entityRefs: z.array(entityRefSchema).optional(),
  stopAtStage: z.nativeEnum(PipelineStage).optional(),
  includeRaw: z.boolean(),
  runModel: z.boolean(),
  providerOverrides: z
    .object({
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().min(1).max(16000).optional(),
    })
    .optional(),

  // Optional context
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .optional(),
  initialContext: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.entrypoint !== "chat_start" && !val.message.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "message is required for this entrypoint",
      path: ["message"],
    });
  }
});

// =============================================================================
// Response Types
// =============================================================================

interface DebugRunResponse {
  runId: string;
  traceId: string;
  status: "running" | "stopped" | "completed" | "error";
  stoppedAtStage?: PipelineStage;
  errorMessage?: string;
}

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const appendConversationTurn = (
  history: ConversationMessage[],
  turn: ConversationMessage
) => {
  const last = history[history.length - 1];
  if (last?.role === turn.role && last?.content === turn.content) return history;
  history.push(turn);
  return history;
};

// =============================================================================
// POST Handler
// =============================================================================

export async function POST(request: NextRequest) {
  // 1. Validate internal API key
  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    // 2. Parse and validate request
    const body = await request.json();
    const input = requestSchema.parse(body);
    const effectiveMessage =
      input.entrypoint === "chat_start" && !input.message.trim()
        ? "Start the Guide conversation."
        : input.message.trim();

    // 3. Verify impersonated user exists
    const impersonatedUser = await prisma.user.findUnique({
      where: { id: input.impersonatedUserId },
      select: { id: true, email: true },
    });

    if (!impersonatedUser) {
      return NextResponse.json(
        { error: "Impersonated user not found" },
        { status: 404 }
      );
    }

    // 4. Log impersonation event
    console.log(
      `[INTERNAL-DEBUG] IMPERSONATION: Admin ${input.adminEmail || input.adminId} impersonating user ${impersonatedUser.email} (${impersonatedUser.id})` +
      ""
    );

    // 5. Generate IDs
    const traceId = `dbg_${nanoid(16)}`;
    const runId = `run_${nanoid(12)}`;

    // 6. Determine stop stage based on runModel flag
    let effectiveStopAtStage = input.stopAtStage;
    if (!input.runModel && !effectiveStopAtStage) {
      effectiveStopAtStage = PipelineStage.PROMPT_ASSEMBLY;
    }

    // 7. Create DebugRun record (with conversation history for follow-up support)
    await prisma.debugRun.create({
      data: {
        runId,
        traceId,
        adminId: input.adminId,
        impersonatedUserId: input.impersonatedUserId,
        entrypoint: input.entrypoint,
        message: effectiveMessage,
        entityRefs: input.entityRefs || [],
        status: "running",
        settings: {
          includeRaw: input.includeRaw,
          runModel: input.runModel,
          providerOverrides: input.providerOverrides,
        },
        // Persist conversation history for follow-up runs
        conversationHistory: input.conversationHistory
          ? (input.conversationHistory as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });

    // 8. Get AI context for the impersonated user
    let aiContext: { userContext: Record<string, unknown> } | undefined;
    try {
      const userAiContext = await getAiContextForUser(input.impersonatedUserId);
      aiContext = { userContext: userAiContext as unknown as Record<string, unknown> };
    } catch (error) {
      console.warn("[INTERNAL-DEBUG] Failed to get AI context:", error);
    }

    // 9. Create run context with debug mode enabled
    const ctx = createRunContext({
      traceId,
      userId: input.impersonatedUserId,
      entrypoint: input.entrypoint,
      message: effectiveMessage,
      entityRefs: input.entityRefs,
      mode: "debug",
      stopAtStage: effectiveStopAtStage,
      sideEffects: "disabled",
      writePolicy: "forbid",
      appVersion: "admin-debug-1.0",
      platform: "web-admin",
      conversationHistory: input.conversationHistory,
      initialContext: input.initialContext,
      aiContext,
    });

    // Override the runId to use our generated one
    ctx.runId = runId;

    // 10. Execute pipeline
    let finalStatus: DebugRunResponse["status"] = "running";
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

      // Extract assistant response from MODEL_CALL artifact for follow-up chaining
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

      const updatedConversationHistory: ConversationMessage[] = Array.isArray(
        input.conversationHistory
      )
        ? [...input.conversationHistory]
        : [];
      appendConversationTurn(updatedConversationHistory, {
        role: "user",
        content: input.message,
      });
      if (lastAssistantMessage) {
        appendConversationTurn(updatedConversationHistory, {
          role: "assistant",
          content: lastAssistantMessage,
        });
      }

      await prisma.debugRun.update({
        where: { runId },
        data: {
          status: finalStatus,
          stoppedAtStage: stoppedAtStage || null,
          lastAssistantMessage,
          conversationHistory:
            updatedConversationHistory as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (pipelineError) {
      finalStatus = "error";
      errorMessage =
        pipelineError instanceof Error
          ? pipelineError.message
          : String(pipelineError);

      const updatedConversationHistory: ConversationMessage[] = Array.isArray(
        input.conversationHistory
      )
        ? [...input.conversationHistory]
        : [];
      appendConversationTurn(updatedConversationHistory, {
        role: "user",
        content: input.message,
      });

      await prisma.debugRun.update({
        where: { runId },
        data: {
          status: "error",
          errorMessage,
          conversationHistory:
            updatedConversationHistory as unknown as Prisma.InputJsonValue,
        },
      });

      console.error("[INTERNAL-DEBUG] Pipeline execution error:", pipelineError);
    }

    const response: DebugRunResponse = {
      runId,
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
    console.error("[INTERNAL-DEBUG] Error starting run:", error);
    return NextResponse.json(
      { error: "Failed to start debug run" },
      { status: 500 }
    );
  }
}
