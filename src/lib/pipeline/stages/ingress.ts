/**
 * INGRESS Stage
 *
 * Normalizes input and produces a unified Plan:
 * - ResponsePlan: how we should respond
 * - RetrievalPlan: what context we should gather
 */

import type { RunContext, EntityRef } from "../types";
import type { StageOutput } from "../orchestrator";
import {
  INGRESS_SCHEMA_VERSION,
  type IngressPayload,
} from "../payloads/ingress";
import { buildPlan } from "../plan/planBuilder";
import { RETRIEVAL_NEEDS, type Plan } from "../plan/types";

// =============================================================================
// Input Normalization
// =============================================================================

/**
 * Normalize user input message.
 */
function normalizeMessage(message: string): string {
  return message
    .trim()
    .replace(/\s+/g, " ") // Collapse whitespace
    .replace(/[\u200B-\u200D\uFEFF]/g, ""); // Remove zero-width chars
}

// =============================================================================
// Entity Extraction
// =============================================================================

// Basic Bible reference pattern
const VERSE_PATTERN =
  /\b(\d?\s*[A-Za-z]+)\s+(\d{1,3})(?::(\d{1,3})(?:-(\d{1,3}))?)?\b/g;

/**
 * Extract Bible references from text.
 */
function extractBibleReferences(text: string): EntityRef[] {
  const refs: EntityRef[] = [];
  let match;

  while ((match = VERSE_PATTERN.exec(text)) !== null) {
    const book = match[1].trim();
    const chapter = match[2];
    const verseStart = match[3];
    const verseEnd = match[4];

    let reference = `${book} ${chapter}`;
    if (verseStart) {
      reference += `:${verseStart}`;
      if (verseEnd) {
        reference += `-${verseEnd}`;
      }
    }

    refs.push({
      type: "verse",
      reference,
    });
  }

  return refs;
}

/**
 * Extract detected entities from message.
 */
function extractEntities(message: string): EntityRef[] {
  const entities: EntityRef[] = [];

  // Extract Bible references
  const verseRefs = extractBibleReferences(message);
  entities.push(...verseRefs);

  // Could add theme extraction here in the future
  // e.g., detecting topics like "faith", "prayer", "love"

  return entities;
}

// =============================================================================
// Stage Executor
// =============================================================================

/**
 * Execute the INGRESS stage.
 */
export async function executeIngressStage(
  ctx: RunContext
): Promise<StageOutput<IngressPayload>> {
  // Normalize input
  const normalizedInput = normalizeMessage(ctx.message);

  // For chat_start we can skip planner intent/LLM entirely and use a deterministic plan.
  // This keeps the pipeline fast and guarantees we retrieve the right recent context bundle.
  let plan: Plan;
  if (ctx.entrypoint === "chat_start") {
    plan = {
      response: {
        responseMode: "coach",
        lengthTarget: "short",
        safetyFlags: { selfHarm: false, violence: false },
        flags: { selfDisclosure: false, situational: false },
        signals: ["chat_start_forced_plan"],
        source: "rules",
        confidence: 0.99,
      },
      retrieval: {
        needs: [
          RETRIEVAL_NEEDS.bible_reading_sessions,
          RETRIEVAL_NEEDS.verse_notes,
          RETRIEVAL_NEEDS.verse_highlights,
          RETRIEVAL_NEEDS.conversation_session_summaries,
          RETRIEVAL_NEEDS.artifact_semantic,
          RETRIEVAL_NEEDS.user_memory,
        ],
        filters: { temporal: { range: "last_month" } },
        limits: {
          [RETRIEVAL_NEEDS.user_memory]: 10,
          [RETRIEVAL_NEEDS.verse_highlights]: 20,
          [RETRIEVAL_NEEDS.verse_notes]: 20,
          [RETRIEVAL_NEEDS.artifact_semantic]: 10,
          [RETRIEVAL_NEEDS.conversation_session_summaries]: 5,
          [RETRIEVAL_NEEDS.bible_reading_sessions]: 10,
        },
      },
    };
  } else {
    plan = await buildPlan({
      message: normalizedInput,
      conversationHistory:
        ctx.conversationHistory?.map((m) => ({
          role: m.role,
          content: m.content,
        })) ?? [],
      isFirstMessage: !ctx.conversationHistory?.length,
    });
  }

  // Extract additional entities from message
  const detectedEntities = extractEntities(normalizedInput);

  // Combine provided entity refs with detected ones (deduplicated)
  const allEntities = [...ctx.entityRefs];
  for (const detected of detectedEntities) {
    const exists = allEntities.some(
      (e) =>
        e.type === detected.type &&
        e.reference.toLowerCase() === detected.reference.toLowerCase()
    );
    if (!exists) {
      allEntities.push(detected);
    }
  }

  const payload: IngressPayload = {
    schemaVersion: INGRESS_SCHEMA_VERSION,
    normalizedInput,
    detectedEntities: allEntities,
    plan,
  };

  return {
    payload,
    summary: `Plan: ${plan.response.responseMode} (${Math.round(plan.response.confidence * 100)}%, ${plan.response.source}), Needs: ${plan.retrieval.needs.length}`,
    stats: {
      inputLength: normalizedInput.length,
      entityCount: allEntities.length,
      planConfidence: plan.response.confidence,
      usedLLM: plan.response.source === "llm" ? 1 : 0,
    },
  };
}
