/**
 * Unified AI Context Service
 *
 * Single entry point for all AI endpoints to get user preferences and context.
 * Provides a small, safe "AI Profile Context" that can be injected into prompts.
 */

import { getKVClient, CacheKeys } from "@/lib/kv";
import { prisma } from "@/lib/prisma";
import {
  getActiveLifeContextForAI,
  type ActiveLifeContext,
  type EncouragementStyle,
} from "@/lib/lifeContext";

// ---------- Types ----------

export interface AiProfileContext {
  /** Preferred Bible translation (e.g., "BSB", "ESV") */
  preferredTranslation: string;
  /** Explanation style preference (gentle | balanced | deep | questions) */
  explanationStyle: string;
  /** User experience level (new | growing | mature | scholar) */
  experienceLevel: string;
  /** Brief neutral guidance derived from study intent */
  userGuidance: string;
}

export interface RetrievalPolicy {
  /** Whether memory retrieval is enabled */
  enabled: boolean;
  /** Which memory types can be retrieved */
  allowedTypes: ("study" | "reflection" | "prayer")[];
  /** Maximum number of memories to retrieve */
  maxMemories: number;
}

export interface UserAiContext {
  userProfile: {
    /** User's preferred display name (may be null/empty) */
    displayName?: string;
    /** User's first name (may be null/empty) */
    firstName?: string;
  };
  aiProfileContext: AiProfileContext;
  retrievalPolicy: RetrievalPolicy;
  lifeContext: ActiveLifeContext;
  featureFlags: Record<string, boolean>;
}

// Re-export ActiveLifeContext for consumers
export type { ActiveLifeContext } from "@/lib/lifeContext";

// ---------- Cache Configuration ----------

const CACHE_TTL_SECONDS = 900; // 15 minutes

// ---------- Cache Functions ----------

async function getCachedContext(userId: string): Promise<UserAiContext | null> {
  try {
    const kv = getKVClient();
    const cached = await kv.get<UserAiContext>(CacheKeys.aiContext(userId));
    return cached?.data ?? null;
  } catch (error) {
    console.warn("[AI Context] Cache read error:", error);
    return null; // Cache miss or error - proceed to DB
  }
}

async function cacheContext(userId: string, context: UserAiContext): Promise<void> {
  try {
    const kv = getKVClient();
    await kv.set(CacheKeys.aiContext(userId), context, CACHE_TTL_SECONDS);
  } catch (error) {
    console.warn("[AI Context] Cache write error:", error);
    // Log but don't fail - caching is optimization only
  }
}

/**
 * Invalidate the cached AI context for a user.
 * Call this when user preferences are updated.
 */
export async function invalidateAiContextCache(userId: string): Promise<void> {
  try {
    const kv = getKVClient();
    await kv.delete(CacheKeys.aiContext(userId));
  } catch (error) {
    console.warn("[AI Context] Cache invalidation error:", error);
    // Log but don't fail
  }
}

// ---------- Context Building ----------

function buildAiProfileContext(prefs: {
  translationId: string;
  explanationStyle: string;
  experienceLevel: string;
  studyIntent: string[];
} | null): AiProfileContext {
  const defaults: AiProfileContext = {
    preferredTranslation: "BSB",
    explanationStyle: "balanced",
    experienceLevel: "growing",
    userGuidance: "",
  };

  if (!prefs) return defaults;

  // Generate a neutral guidance line from studyIntent
  const userGuidance = generateUserGuidance(prefs.studyIntent);

  return {
    preferredTranslation: prefs.translationId,
    explanationStyle: prefs.explanationStyle,
    experienceLevel: prefs.experienceLevel,
    userGuidance,
  };
}

/**
 * Convert studyIntent array to a neutral guidance line for AI context.
 * This keeps the prompt injection minimal and safe.
 */
function generateUserGuidance(studyIntent: string[]): string {
  if (!studyIntent || studyIntent.length === 0) return "";

  const intentMap: Record<string, string> = {
    peace: "peaceful",
    understanding: "clear",
    encouragement: "encouraging",
    guidance: "practical",
  };

  const descriptors = studyIntent
    .map((i) => intentMap[i])
    .filter(Boolean)
    .slice(0, 2);

  if (descriptors.length === 0) return "";
  return `appreciates ${descriptors.join(", ")} explanations`;
}

/**
 * Derive retrieval policy from memory mode setting.
 */
function deriveRetrievalPolicy(memoryMode: string): RetrievalPolicy {
  switch (memoryMode) {
    case "off":
      return { enabled: false, allowedTypes: [], maxMemories: 0 };
    case "minimal":
      return { enabled: true, allowedTypes: ["study"], maxMemories: 3 };
    case "standard":
      return { enabled: true, allowedTypes: ["study", "reflection"], maxMemories: 5 };
    case "full":
      return { enabled: true, allowedTypes: ["study", "reflection", "prayer"], maxMemories: 5 };
    default:
      return { enabled: true, allowedTypes: ["study", "reflection"], maxMemories: 5 };
  }
}

/**
 * Get feature flags for a user (placeholder for future A/B tests, rollouts).
 */
async function getFeatureFlags(_userId: string): Promise<Record<string, boolean>> {
  // Future: fetch from feature flag service, database, or environment
  return {};
}

// ---------- Main Export ----------

/**
 * Get the unified AI context for a user.
 *
 * This is the single entry point that all AI endpoints should use.
 * Returns cached context when available, otherwise fetches from DB and caches.
 *
 * @param userId - The internal Forge user ID (not Clerk ID)
 * @returns The user's AI context including profile, retrieval policy, and feature flags
 */
export async function getAiContextForUser(userId: string): Promise<UserAiContext> {
  // 1. Check cache first
  const cached = await getCachedContext(userId);
  if (cached) {
    return cached;
  }

  // 2. Fetch user profile + preferences from DB
  const [user, prefs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        displayName: true,
        firstName: true,
      },
    }),
    prisma.userPreferences.findUnique({
      where: { userId },
      select: {
        translationId: true,
        explanationStyle: true,
        experienceLevel: true,
        studyIntent: true,
        memoryMode: true,
        encouragementStyle: true,
      },
    }),
  ]);

  // 3. Build AI profile context
  const aiProfileContext = buildAiProfileContext(prefs);

  // 4. Derive retrieval policy from memoryMode
  const retrievalPolicy = deriveRetrievalPolicy(prefs?.memoryMode || "standard");

  // 5. Get active life context (pastoral profile)
  const encouragementStyle = (prefs?.encouragementStyle || "gentle") as EncouragementStyle;
  const lifeContext = await getActiveLifeContextForAI(userId, encouragementStyle);

  // 7. Get feature flags
  const featureFlags = await getFeatureFlags(userId);

  const context: UserAiContext = {
    userProfile: {
      displayName: user?.displayName || undefined,
      firstName: user?.firstName || undefined,
    },
    aiProfileContext,
    retrievalPolicy,
    lifeContext,
    featureFlags,
  };

  // 8. Cache with TTL
  await cacheContext(userId, context);

  return context;
}

