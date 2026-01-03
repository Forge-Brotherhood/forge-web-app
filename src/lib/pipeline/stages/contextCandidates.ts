/**
 * CONTEXT_CANDIDATES Stage
 *
 * Fans out to multiple context providers to gather all potential context.
 * Each provider returns candidates with stable, derivable IDs.
 */

import type { RunContext, CandidateContext } from "../types";
import type { StageOutput } from "../orchestrator";
import {
  CONTEXT_CANDIDATES_SCHEMA_VERSION,
  type ContextCandidatesPayload,
} from "../payloads/contextCandidates";
import type { IngressPayload } from "../payloads/ingress";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { searchSimilar } from "@/lib/artifacts/embeddingService";
import type { ArtifactType } from "@/lib/artifacts/types";
import { getBookDisplayNameFromCode } from "@/lib/bible";
import { computeDateBounds } from "@/lib/memory/intentClassifier";
import { RETRIEVAL_NEEDS, type ScriptureScope } from "../plan/types";

// =============================================================================
// Preview Redaction
// =============================================================================

const MAX_PREVIEW_LENGTH = 150;

/**
 * Redact and truncate text for preview.
 */
function createRedactedPreview(text: string): string {
  if (!text) return "";

  // Truncate to max length
  let preview = text.length > MAX_PREVIEW_LENGTH
    ? text.substring(0, MAX_PREVIEW_LENGTH) + "..."
    : text;

  // Basic PII redaction (emails, phone numbers)
  preview = preview.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    "[EMAIL]"
  );
  preview = preview.replace(
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    "[PHONE]"
  );

  return preview;
}

// =============================================================================
// Context Providers
// =============================================================================

/**
 * Get Bible context for the referenced verses.
 */
async function getBibleContext(
  ctx: RunContext,
  ingress: IngressPayload
): Promise<CandidateContext[]> {
  const candidates: CandidateContext[] = [];

  for (const entity of ingress.detectedEntities) {
    if (entity.type === "verse" || entity.type === "chapter") {
      candidates.push({
        id: `bible:${entity.reference}`,
        source: "bible",
        label: entity.reference,
        preview: entity.text
          ? createRedactedPreview(entity.text)
          : `Reference: ${entity.reference}`,
        metadata: {
          reference: entity.reference,
          type: entity.type,
          // Store full text for injection in prompt assembly
          fullText: entity.text || null,
        },
      });
    }
  }

  return candidates;
}

/**
 * Get user's durable memories from new UserMemory model.
 *
 * Memories are typed facts about the user (struggle themes, faith stages, etc.)
 * that have been promoted from signals after repeated observation.
 */
async function getUserMemories(
  ctx: RunContext,
  _ingress: IngressPayload
): Promise<CandidateContext[]> {
  console.log("[ContextCandidates] Fetching memories for userId:", ctx.userId);

  const memories = await prisma.userMemory.findMany({
    where: {
      userId: ctx.userId,
      isActive: true,
      strength: { gte: 0.3 }, // Only include memories with sufficient strength
    },
    orderBy: [
      { strength: "desc" },
      { lastSeenAt: "desc" },
    ],
    take: 10, // Limit to top 10 by strength and recency
  });

  console.log("[ContextCandidates] Found memories:", memories.length);

  return memories.map((memory) => {
    const value = memory.value as Record<string, unknown>;
    const label = formatMemoryLabel(memory.memoryType, value);
    const preview = formatMemoryPreview(memory.memoryType, value, memory.strength);

    return {
      id: `memory:${memory.id}`,
      source: "user_memory" as const,
      label,
      preview: createRedactedPreview(preview),
      metadata: {
        memoryType: memory.memoryType,
        value,
        strength: memory.strength,
        occurrences: memory.occurrences,
        firstSeenAt: memory.firstSeenAt.toISOString(),
        lastSeenAt: memory.lastSeenAt.toISOString(),
      },
      features: {
        recencyScore: calculateRecencyScore(memory.lastSeenAt),
        scopeScore: memory.strength, // Use strength as scope score
      },
    };
  });
}

/**
 * Format a human-readable label for a memory type.
 */
function formatMemoryLabel(
  memoryType: string,
  value: Record<string, unknown>
): string {
  switch (memoryType) {
    case "struggle_theme":
      return `Struggle: ${formatThemeValue(value.theme as string)}`;
    case "faith_stage":
      return `Faith Stage: ${value.stage}`;
    case "scripture_affinity":
      return `Scripture Affinity: ${value.reference || value.theme}`;
    case "tone_preference":
      return `Tone Preference: ${value.tone}`;
    case "group_role":
      return `Group Role: ${value.role}`;
    default:
      return `Memory: ${memoryType}`;
  }
}

/**
 * Format a preview string for a memory.
 */
function formatMemoryPreview(
  memoryType: string,
  value: Record<string, unknown>,
  strength: number
): string {
  const strengthLabel = strength >= 0.8 ? "strong" : strength >= 0.5 ? "moderate" : "light";

  switch (memoryType) {
    case "struggle_theme":
      return `User has shown a ${strengthLabel} pattern of struggling with ${formatThemeValue(value.theme as string)}`;
    case "faith_stage":
      return `User appears to be in a ${value.stage} stage of their faith journey (${strengthLabel} signal)`;
    case "scripture_affinity":
      return `User has a ${strengthLabel} affinity for ${value.reference || value.theme}`;
    case "tone_preference":
      return `User prefers a ${value.tone} communication style (${strengthLabel} pattern)`;
    case "group_role":
      return `User serves as ${value.role} in their group (${strengthLabel} pattern)`;
    default:
      return `${memoryType}: ${JSON.stringify(value)}`;
  }
}

/**
 * Format a struggle theme value to be more readable.
 */
function formatThemeValue(theme: string): string {
  // Convert snake_case to title case
  return theme.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function buildArtifactWhereForScope(
  scope: ScriptureScope | undefined,
  artifactType: ArtifactType
): Prisma.ArtifactWhereInput | undefined {
  if (!scope) return undefined;

  const bookName =
    typeof scope.bookName === "string" && scope.bookName.trim()
      ? scope.bookName.trim()
      : getBookDisplayNameFromCode(scope.bookId);
  if (!bookName) return undefined;

  if (artifactType === "verse_note" || artifactType === "verse_highlight") {
    const base: Prisma.ArtifactWhereInput = {
      metadata: { path: ["reference", "book"], equals: bookName },
    };

    if (scope.kind === "chapter") {
      return {
        AND: [
          base,
          { metadata: { path: ["reference", "chapter"], equals: scope.chapter } },
        ],
      };
    }

    return base;
  }

  // conversation_session_summary: optionally scope by scriptureRefs if desired (not enforced for now)
  return undefined;
}

function createArtifactCandidate(
  artifact: {
    id: string;
    type: ArtifactType | string;
    title: string | null;
    content: string;
    scriptureRefs: unknown | null;
    createdAt: Date;
    metadata: unknown | null;
  },
  features?: CandidateContext["features"]
): CandidateContext {
  const scriptureRefs =
    Array.isArray(artifact.scriptureRefs) &&
    artifact.scriptureRefs.every((v) => typeof v === "string")
      ? (artifact.scriptureRefs as string[])
      : null;

  // Extract noteSummary and noteTags from artifact metadata for top-level access
  const artifactMeta = artifact.metadata as Record<string, unknown> | null;
  const noteSummary = artifactMeta?.noteSummary as string | undefined;
  const noteTags = artifactMeta?.noteTags as string[] | undefined;

  const label = formatArtifactLabel(artifact.type, artifact.title);
  return {
    id: `artifact:${artifact.id}`,
    source: "artifact" as const,
    label,
    preview: createRedactedPreview(artifact.content),
    metadata: {
      artifactType: artifact.type,
      title: artifact.title,
      scriptureRefs,
      createdAt: artifact.createdAt.toISOString(),
      fullContent: artifact.content,
      // Flatten noteSummary and noteTags to top level for promptAssembly access
      ...(noteSummary ? { noteSummary } : {}),
      ...(noteTags && noteTags.length > 0 ? { noteTags } : {}),
      ...(artifact.metadata ? { artifactMetadata: artifact.metadata as unknown } : {}),
    },
    ...(features ? { features } : {}),
  };
}

/**
 * Get life context (season, what user is carrying, etc).
 */
async function getLifeContext(
  ctx: RunContext
): Promise<CandidateContext[]> {
  const candidates: CandidateContext[] = [];

  // Get from aiContext if available
  // userContext is the full UserAiContext which has lifeContext nested inside
  const userContext = ctx.aiContext?.userContext as Record<string, unknown> | undefined;
  const lifeContext = userContext?.lifeContext as Record<string, unknown> | undefined;

  console.log("[ContextCandidates] Life context from aiContext:", {
    hasAiContext: !!ctx.aiContext,
    hasUserContext: !!userContext,
    userContextKeys: userContext ? Object.keys(userContext) : [],
    hasLifeContext: !!lifeContext,
    lifeContextKeys: lifeContext ? Object.keys(lifeContext) : [],
  });

  if (lifeContext?.currentSeason) {
    candidates.push({
      id: `life:${ctx.userId}:season`,
      source: "life_context",
      label: "Current Season",
      preview: createRedactedPreview(String(lifeContext.currentSeason)),
      metadata: {
        type: "season",
        value: lifeContext.currentSeason,
      },
    });
  }

  // Life context has weeklyIntention with carrying and hoping
  const weeklyIntention = lifeContext?.weeklyIntention as Record<string, unknown> | undefined;

  if (weeklyIntention?.carrying) {
    candidates.push({
      id: `life:${ctx.userId}:carrying`,
      source: "life_context",
      label: "What You're Carrying",
      preview: createRedactedPreview(String(weeklyIntention.carrying)),
      metadata: {
        type: "carrying",
        value: weeklyIntention.carrying,
      },
    });
  }

  if (weeklyIntention?.hoping) {
    candidates.push({
      id: `life:${ctx.userId}:hoping`,
      source: "life_context",
      label: "What You're Hoping For",
      preview: createRedactedPreview(String(weeklyIntention.hoping)),
      metadata: {
        type: "hoping",
        value: weeklyIntention.hoping,
      },
    });
  }

  return candidates;
}

/**
 * Get recent activity context (recent verses studied, etc).
 */
async function getRecentActivity(
  ctx: RunContext
): Promise<CandidateContext[]> {
  // Could fetch recent reading history, recent conversations, etc.
  // For now, return empty - implement based on your data model
  return [];
}

/**
 * Get system context (static instructions based on intent).
 */
async function getSystemContext(
  ingress: IngressPayload
): Promise<CandidateContext[]> {
  const candidates: CandidateContext[] = [];

  // Add plan-specific system context
  candidates.push({
    id: `system:plan:${ingress.plan.response.responseMode}`,
    source: "system",
    label: `Plan: ${ingress.plan.response.responseMode}`,
    preview: `Planned response: ${ingress.plan.response.responseMode}; retrieval needs: ${ingress.plan.retrieval.needs.join(", ") || "none"}`,
    metadata: {
      responseMode: ingress.plan.response.responseMode,
      confidence: ingress.plan.response.confidence,
      signals: ingress.plan.response.signals,
      needs: ingress.plan.retrieval.needs,
    },
  });

  return candidates;
}

/**
 * Get artifact context via semantic search (query-driven).
 *
 * Embeds the user's message and finds semantically similar artifacts
 * from their past content (journals, prayers, session summaries, etc.).
 */
async function getArtifactContext(
  ctx: RunContext,
  ingress: IngressPayload
): Promise<CandidateContext[]> {
  const needs = new Set(ingress.plan.retrieval.needs);
  if (!needs.has(RETRIEVAL_NEEDS.artifact_semantic)) return [];

  const isChatStart = ctx.entrypoint === "chat_start";
  console.log(
    `[ContextCandidates] Fetching ${isChatStart ? "recent" : "semantic"} artifacts for userId:`,
    ctx.userId
  );

  try {
    const artifactTypes: ArtifactType[] =
      ingress.plan.retrieval.artifactTypes && ingress.plan.retrieval.artifactTypes.length > 0
        ? ingress.plan.retrieval.artifactTypes
        : [
            "conversation_session_summary",
            "journal_entry",
            "prayer_request",
            "prayer_update",
            "testimony",
            "verse_highlight",
            "verse_note",
          ];

    // Check for temporal modifier to apply date filtering
    const temporalModifier = ingress.plan.retrieval.filters?.temporal;
    let createdAfter: Date | undefined;
    let createdBefore: Date | undefined;

    if (temporalModifier?.range) {
      const bounds = computeDateBounds(temporalModifier.range);
      createdAfter = bounds.after;
      createdBefore = bounds.before;
      console.log("[ContextCandidates] Temporal date filter:", {
        range: temporalModifier.range,
        createdAfter,
        createdBefore,
      });
    }

    // For chat_start, we want genuinely "recent context" (recency-ranked),
    // not query-shaped semantic matches to the synthetic chat_start message.
    if (isChatStart) {
      const recent = await prisma.artifact.findMany({
        where: {
          userId: ctx.userId,
          type: { in: artifactTypes },
          status: "active",
          ...(createdAfter || createdBefore
            ? {
                createdAt: {
                  ...(createdAfter ? { gte: createdAfter } : {}),
                  ...(createdBefore ? { lte: createdBefore } : {}),
                },
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      console.log("[ContextCandidates] Found recent artifacts:", recent.length);

      return recent.map((artifact) =>
        createArtifactCandidate(artifact, {
          recencyScore: calculateRecencyScore(artifact.createdAt),
          createdAt: artifact.createdAt.toISOString(),
        })
      );
    }

    // Semantic search using user's message (with optional date filtering)
    const searchResults = await searchSimilar(
      ingress.plan.retrieval.query || ctx.message,
      {
        userId: ctx.userId,
        types: artifactTypes,
        scopes: ["private"], // Only user's private artifacts
        status: "active",
        createdAfter,
        createdBefore,
      },
      20 // topK: fetch more candidates for temporal re-ranking
    );

    console.log("[ContextCandidates] Found artifacts:", searchResults.length);

    // Map to CandidateContext format
    return searchResults.map((result) => {
      const artifact = result.artifact;
      return createArtifactCandidate(artifact, {
        semanticScore: result.score, // Cosine similarity 0-1
        recencyScore: calculateRecencyScore(artifact.createdAt),
        createdAt: artifact.createdAt.toISOString(),
      });
    });
  } catch (error) {
    // Graceful failure: log error but don't block pipeline
    console.error("[ContextCandidates] Artifact retrieval failed:", error);
    return [];
  }
}

async function getVerseHighlights(
  ctx: RunContext,
  ingress: IngressPayload
): Promise<CandidateContext[]> {
  const needs = new Set(ingress.plan.retrieval.needs);
  if (!needs.has(RETRIEVAL_NEEDS.verse_highlights)) return [];

  const scope = ingress.plan.retrieval.filters?.scope;
  const temporal = ingress.plan.retrieval.filters?.temporal;
  const limit = ingress.plan.retrieval.limits?.[RETRIEVAL_NEEDS.verse_highlights] ?? 20;

  let createdAfter: Date | undefined;
  let createdBefore: Date | undefined;
  if (temporal?.range) {
    const bounds = computeDateBounds(temporal.range);
    createdAfter = bounds.after;
    createdBefore = bounds.before;
  }

  const whereBase: Prisma.ArtifactWhereInput = {
    userId: ctx.userId,
    type: "verse_highlight",
    status: "active",
    ...(createdAfter || createdBefore
      ? { createdAt: { ...(createdAfter ? { gte: createdAfter } : {}), ...(createdBefore ? { lte: createdBefore } : {}) } }
      : {}),
  };

  const scopeWhere = buildArtifactWhereForScope(scope, "verse_highlight");
  const where: Prisma.ArtifactWhereInput = scopeWhere ? { AND: [whereBase, scopeWhere] } : whereBase;

  const results = await prisma.artifact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Chapter->book fallback if chapter scope yields nothing
  if (scope?.kind === "chapter" && results.length === 0) {
    const bookScope: ScriptureScope = { kind: "book", bookId: scope.bookId, bookName: scope.bookName };
    const fallbackScopeWhere = buildArtifactWhereForScope(bookScope, "verse_highlight");
    const fallbackWhere: Prisma.ArtifactWhereInput = fallbackScopeWhere ? { AND: [whereBase, fallbackScopeWhere] } : whereBase;
    const fallback = await prisma.artifact.findMany({
      where: fallbackWhere,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return fallback.map((a) =>
      createArtifactCandidate(a, { recencyScore: calculateRecencyScore(a.createdAt), createdAt: a.createdAt.toISOString() })
    );
  }

  return results.map((a) =>
    createArtifactCandidate(a, { recencyScore: calculateRecencyScore(a.createdAt), createdAt: a.createdAt.toISOString() })
  );
}

async function getVerseNotes(
  ctx: RunContext,
  ingress: IngressPayload
): Promise<CandidateContext[]> {
  const needs = new Set(ingress.plan.retrieval.needs);
  if (!needs.has(RETRIEVAL_NEEDS.verse_notes)) return [];

  const scope = ingress.plan.retrieval.filters?.scope;
  const temporal = ingress.plan.retrieval.filters?.temporal;
  const limit = ingress.plan.retrieval.limits?.[RETRIEVAL_NEEDS.verse_notes] ?? 20;

  let createdAfter: Date | undefined;
  let createdBefore: Date | undefined;
  if (temporal?.range) {
    const bounds = computeDateBounds(temporal.range);
    createdAfter = bounds.after;
    createdBefore = bounds.before;
  }

  const whereBase: Prisma.ArtifactWhereInput = {
    userId: ctx.userId,
    type: "verse_note",
    status: "active",
    ...(createdAfter || createdBefore
      ? { createdAt: { ...(createdAfter ? { gte: createdAfter } : {}), ...(createdBefore ? { lte: createdBefore } : {}) } }
      : {}),
  };

  const scopeWhere = buildArtifactWhereForScope(scope, "verse_note");
  const where: Prisma.ArtifactWhereInput = scopeWhere ? { AND: [whereBase, scopeWhere] } : whereBase;

  const results = await prisma.artifact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (scope?.kind === "chapter" && results.length === 0) {
    const bookScope: ScriptureScope = { kind: "book", bookId: scope.bookId, bookName: scope.bookName };
    const fallbackScopeWhere = buildArtifactWhereForScope(bookScope, "verse_note");
    const fallbackWhere: Prisma.ArtifactWhereInput = fallbackScopeWhere ? { AND: [whereBase, fallbackScopeWhere] } : whereBase;
    const fallback = await prisma.artifact.findMany({
      where: fallbackWhere,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return fallback.map((a) =>
      createArtifactCandidate(a, { recencyScore: calculateRecencyScore(a.createdAt), createdAt: a.createdAt.toISOString() })
    );
  }

  return results.map((a) =>
    createArtifactCandidate(a, { recencyScore: calculateRecencyScore(a.createdAt), createdAt: a.createdAt.toISOString() })
  );
}

async function getConversationSessionSummaries(
  ctx: RunContext,
  ingress: IngressPayload
): Promise<CandidateContext[]> {
  const needs = new Set(ingress.plan.retrieval.needs);
  if (!needs.has(RETRIEVAL_NEEDS.conversation_session_summaries)) return [];

  const temporal = ingress.plan.retrieval.filters?.temporal;
  const limit =
    ingress.plan.retrieval.limits?.[RETRIEVAL_NEEDS.conversation_session_summaries] ?? 5;

  let createdAfter: Date | undefined;
  let createdBefore: Date | undefined;
  if (temporal?.range) {
    const bounds = computeDateBounds(temporal.range);
    createdAfter = bounds.after;
    createdBefore = bounds.before;
  }

  const where: Prisma.ArtifactWhereInput = {
    userId: ctx.userId,
    type: "conversation_session_summary",
    status: "active",
    ...(createdAfter || createdBefore
      ? { createdAt: { ...(createdAfter ? { gte: createdAfter } : {}), ...(createdBefore ? { lte: createdBefore } : {}) } }
      : {}),
  };

  const results = await prisma.artifact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return results.map((a) =>
    createArtifactCandidate(a, { recencyScore: calculateRecencyScore(a.createdAt), createdAt: a.createdAt.toISOString() })
  );
}

async function getBibleReadingSessions(
  ctx: RunContext,
  ingress: IngressPayload
): Promise<CandidateContext[]> {
  const needs = new Set(ingress.plan.retrieval.needs);
  if (!needs.has(RETRIEVAL_NEEDS.bible_reading_sessions)) return [];

  const scope = ingress.plan.retrieval.filters?.scope;
  const temporal = ingress.plan.retrieval.filters?.temporal;
  const limit =
    ingress.plan.retrieval.limits?.[RETRIEVAL_NEEDS.bible_reading_sessions] ?? 10;

  let endedAfter: Date | undefined;
  let endedBefore: Date | undefined;
  if (temporal?.range) {
    const bounds = computeDateBounds(temporal.range);
    endedAfter = bounds.after;
    endedBefore = bounds.before;
  }

  const whereBase: NonNullable<Parameters<typeof prisma.bibleReadingSession.findMany>[0]>["where"] =
    {
      userId: ctx.userId,
      ...(endedAfter || endedBefore
        ? {
            endedAt: {
              ...(endedAfter ? { gte: endedAfter } : {}),
              ...(endedBefore ? { lte: endedBefore } : {}),
            },
          }
        : {}),
    };

  // Defensive scope validation: plans can come from LLM/rules/debug tools; never send invalid filters to Prisma.
  const safeScope = (() => {
    if (!scope || typeof scope !== "object") return undefined;
    const kind = (scope as { kind?: unknown }).kind;
    const bookIdRaw = (scope as { bookId?: unknown }).bookId;
    const chapterRaw = (scope as { chapter?: unknown }).chapter;
    const bookId = typeof bookIdRaw === "string" ? bookIdRaw.trim() : "";
    if (!bookId) return undefined;
    if (kind === "book") return { kind: "book" as const, bookId };
    if (kind === "chapter") {
      if (typeof chapterRaw !== "number" || !Number.isFinite(chapterRaw)) return undefined;
      return { kind: "chapter" as const, bookId, chapter: Math.floor(chapterRaw) };
    }
    return undefined;
  })();

  const where =
    safeScope?.kind === "chapter"
      ? { ...whereBase, bookId: safeScope.bookId, chapter: safeScope.chapter }
      : safeScope?.kind === "book"
        ? { ...whereBase, bookId: safeScope.bookId }
        : whereBase;

  const sessions = await prisma.bibleReadingSession.findMany({
    where,
    orderBy: { endedAt: "desc" },
    take: limit,
  });

  return sessions.map((s) => {
    const bookName = s.bookName ?? getBookDisplayNameFromCode(s.bookId) ?? s.bookId;
    const ref =
      s.verseStart === s.verseEnd
        ? `${bookName} ${s.chapter}:${s.verseStart}`
        : `${bookName} ${s.chapter}:${s.verseStart}-${s.verseEnd}`;

    const durationText = (() => {
      const seconds = s.durationSeconds;
      if (!Number.isFinite(seconds) || seconds < 0) return null;
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      if (mins <= 0) return `${secs}s`;
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    })();

    const label = `Reading — ${ref}`;
    const previewParts: string[] = [];
    if (s.translation) previewParts.push(s.translation);
    if (durationText) previewParts.push(durationText);
    if (s.completionStatus) previewParts.push(s.completionStatus);
    const preview = previewParts.length > 0 ? previewParts.join(" · ") : ref;

    return {
      id: `bible_reading_session:${s.sessionId}`,
      source: "bible_reading_session",
      label,
      preview: createRedactedPreview(preview),
      metadata: {
        sessionId: s.sessionId,
        translation: s.translation,
        startRef: {
          bookId: s.bookId,
          book: bookName,
          chapter: s.chapter,
          verse: s.verseStart,
        },
        endRef: {
          bookId: s.bookId,
          book: bookName,
          chapter: s.chapter,
          verse: s.verseEnd,
        },
        durationSeconds: s.durationSeconds,
        versesVisibleCount: s.versesVisibleCount,
        completionStatus: s.completionStatus,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt.toISOString(),
        source: s.source,
      },
      features: {
        recencyScore: calculateRecencyScore(s.endedAt),
        createdAt: s.endedAt.toISOString(),
      },
    };
  });
}

/**
 * Format a human-readable label for an artifact type.
 */
function formatArtifactLabel(type: string, title: string | null): string {
  const typeLabels: Record<string, string> = {
    conversation_session_summary: "Session Summary",
    journal_entry: "Journal",
    prayer_request: "Prayer Request",
    prayer_update: "Prayer Update",
    testimony: "Testimony",
    verse_highlight: "Highlight",
    verse_note: "Note",
    group_meeting_notes: "Meeting Notes",
  };

  const typeLabel = typeLabels[type] || "Artifact";
  return title ? `${typeLabel}: ${title}` : typeLabel;
}

// =============================================================================
// Helpers
// =============================================================================

function calculateRecencyScore(date: Date): number {
  const now = Date.now();
  const ageMs = now - date.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Decay over 90 days
  if (ageDays < 1) return 1.0;
  if (ageDays < 7) return 0.9;
  if (ageDays < 30) return 0.7;
  if (ageDays < 90) return 0.5;
  return 0.3;
}

function groupBySource(
  candidates: CandidateContext[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of candidates) {
    counts[c.source] = (counts[c.source] || 0) + 1;
  }
  return counts;
}

function dedupeCandidates(candidates: CandidateContext[]): CandidateContext[] {
  const byId = new Map<string, CandidateContext>();

  const mergeFeatures = (
    current: CandidateContext["features"] | undefined,
    incoming: CandidateContext["features"] | undefined
  ): CandidateContext["features"] | undefined => {
    if (!current) return incoming;
    if (!incoming) return current;
    return {
      ...current,
      ...incoming,
      semanticScore:
        typeof incoming.semanticScore === "number"
          ? Math.max(incoming.semanticScore ?? 0, current.semanticScore ?? 0)
          : current.semanticScore,
      recencyScore:
        typeof incoming.recencyScore === "number"
          ? Math.max(incoming.recencyScore ?? 0, current.recencyScore ?? 0)
          : current.recencyScore,
      temporalScore:
        typeof incoming.temporalScore === "number"
          ? Math.max(incoming.temporalScore ?? 0, current.temporalScore ?? 0)
          : current.temporalScore,
      scopeScore:
        typeof incoming.scopeScore === "number"
          ? Math.max(incoming.scopeScore ?? 0, current.scopeScore ?? 0)
          : current.scopeScore,
      createdAt: incoming.createdAt ?? current.createdAt,
    };
  };

  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, candidate);
      continue;
    }

    // Prefer candidate with higher semanticScore when available, else higher recencyScore.
    const existingSem = existing.features?.semanticScore ?? -1;
    const incomingSem = candidate.features?.semanticScore ?? -1;
    const existingRec = existing.features?.recencyScore ?? -1;
    const incomingRec = candidate.features?.recencyScore ?? -1;

    const shouldReplace =
      incomingSem > existingSem ||
      (incomingSem === existingSem && incomingRec > existingRec);

    if (shouldReplace) {
      byId.set(candidate.id, {
        ...candidate,
        features: mergeFeatures(existing.features, candidate.features),
      });
    } else {
      byId.set(existing.id, {
        ...existing,
        features: mergeFeatures(existing.features, candidate.features),
      });
    }
  }

  return Array.from(byId.values());
}

// =============================================================================
// Stage Executor
// =============================================================================

/**
 * Execute the CONTEXT_CANDIDATES stage.
 */
export async function executeContextCandidatesStage(
  ctx: RunContext,
  ingress: IngressPayload
): Promise<StageOutput<ContextCandidatesPayload>> {
  const needs = new Set(ingress.plan.retrieval.needs);
  const shouldIncludeLifeContext =
    ingress.plan.response.responseMode === "pastoral" ||
    ingress.plan.response.responseMode === "coach" ||
    needs.has(RETRIEVAL_NEEDS.user_memory);

  // Fan-out to selected providers in parallel
  const [
    bibleContext,
    userMemories,
    lifeContext,
    recentActivity,
    systemContext,
    semanticArtifacts,
    verseHighlights,
    verseNotes,
    sessionSummaries,
    bibleReadingSessions,
  ] = await Promise.all([
    getBibleContext(ctx, ingress),
    needs.has(RETRIEVAL_NEEDS.user_memory) ? getUserMemories(ctx, ingress) : Promise.resolve([]),
    shouldIncludeLifeContext ? getLifeContext(ctx) : Promise.resolve([]),
    getRecentActivity(ctx),
    getSystemContext(ingress),
    getArtifactContext(ctx, ingress),
    getVerseHighlights(ctx, ingress),
    getVerseNotes(ctx, ingress),
    getConversationSessionSummaries(ctx, ingress),
    getBibleReadingSessions(ctx, ingress),
  ]);

  // Combine all candidates
  const candidates: CandidateContext[] = [
    ...bibleContext,
    ...userMemories,
    ...lifeContext,
    ...recentActivity,
    ...systemContext,
    ...semanticArtifacts,
    ...verseHighlights,
    ...verseNotes,
    ...sessionSummaries,
    ...bibleReadingSessions,
  ];

  const dedupedCandidates = dedupeCandidates(candidates);

  const bySourceCounts = groupBySource(dedupedCandidates);

  const payload: ContextCandidatesPayload = {
    schemaVersion: CONTEXT_CANDIDATES_SCHEMA_VERSION,
    candidates: dedupedCandidates,
    bySourceCounts,
    plan: ingress.plan,
  };

  return {
    payload,
    summary: `${dedupedCandidates.length} candidates from ${Object.keys(bySourceCounts).length} sources`,
    stats: {
      totalCandidates: dedupedCandidates.length,
      bibleCount: bibleContext.length,
      memoryCount: userMemories.length,
      lifeContextCount: lifeContext.length,
      systemCount: systemContext.length,
      artifactCount:
        semanticArtifacts.length +
        verseHighlights.length +
        verseNotes.length +
        sessionSummaries.length,
    },
  };
}
