import { prisma } from "@/lib/prisma";
import { createRunContext } from "@/lib/pipeline/context";
import { executeIngressStage } from "@/lib/pipeline/stages/ingress";
import { executeContextCandidatesStage } from "@/lib/pipeline/stages/contextCandidates";
import { getAiContextForUser } from "@/lib/ai/userContext";
import { compactContextCandidatesPayload } from "@/lib/guide/contextCompact";
import {
  compressContextBundle,
  getAllowedActionTypesFromContext,
  getAllowedEvidenceIdsFromContext,
} from "@/lib/guide/contextCompress";
import { contextGuideEventSchema } from "@/lib/guide/contextNdjson";

export class GuideStartContextError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "GuideStartContextError";
  }
}

export type GuideStartContext = {
  user: { id: string; firstName: string | null };
  contextPayload: unknown;
  allowedActionTypes: string[];
  allowedEvidenceIds: string[];
  validateEvent: ReturnType<typeof contextGuideEventSchema>;
};

export const buildGuideStartContext = async (args: {
  userId: string;
  enabledActions: string[];
}): Promise<GuideStartContext> => {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { id: true, firstName: true },
  });
  if (!user) throw new GuideStartContextError("User not found", 404);

  let aiContext: { userContext: Record<string, unknown> } | undefined;
  try {
    const userAiContext = await getAiContextForUser(user.id);
    aiContext = { userContext: userAiContext as unknown as Record<string, unknown> };
  } catch (error) {
    // best-effort; missing aiContext just means less life context
    console.warn("[GuideStart] Failed to load aiContext:", error);
  }

  const ctx = createRunContext({
    traceId: `guide_start_${Date.now()}`,
    userId: user.id,
    entrypoint: "chat_start",
    message: "",
    mode: "prod",
    sideEffects: "disabled",
    writePolicy: "forbid",
    appVersion: "web-app",
    platform: "web",
    locale: "en",
    aiContext,
  });

  const ingress = await executeIngressStage(ctx);
  (ingress.payload.plan as any) = {
    ...(ingress.payload.plan as any),
    retrieval: {
      ...(ingress.payload.plan as any).retrieval,
      filters: {
        ...((ingress.payload.plan as any).retrieval?.filters ?? {}),
        temporal: {
          ...((ingress.payload.plan as any).retrieval?.filters?.temporal ?? {}),
          // Keep production guide/start aligned with the Context debugger and prompt budget.
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

  const compactedRaw = compactContextCandidatesPayload(raw) as any;
  const contextPayload = compressContextBundle({
    raw: compactedRaw,
    enabledActions: args.enabledActions,
  });

  const allowedActionTypes = getAllowedActionTypesFromContext(contextPayload) ?? [];
  const allowedEvidenceIds = getAllowedEvidenceIdsFromContext(contextPayload);
  const validateEvent = contextGuideEventSchema({
    allowedEvidenceIds,
    allowedActionTypes: allowedActionTypes.length ? allowedActionTypes : undefined,
  });

  return {
    user: { id: user.id, firstName: user.firstName?.trim() ?? null },
    contextPayload,
    allowedActionTypes,
    allowedEvidenceIds,
    validateEvent,
  };
};


