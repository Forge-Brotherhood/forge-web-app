/**
 * Life Context Service
 *
 * Core service for managing user life context - the pastoral profile
 * that helps personalize AI interactions based on what users choose to share.
 *
 * Key principles:
 * - User-approved: Only store what users explicitly share
 * - Time-bounded: Most context expires automatically
 * - Transparent: Users can see and edit everything
 * - Safe: Never diagnose, never claim beliefs
 */

import { prisma } from "@/lib/prisma";
import type {
  LifeContextType,
  LifeContextValue,
  LifeContextItem,
  LifeContextItemResponse,
  ActiveLifeContext,
  ScheduleValue,
  SeasonValue,
  PrayerTopicValue,
  WeeklyIntentionValue,
  EncouragementStyle,
} from "./types";
import {
  getDefaultExpiresAt,
  getDisplayLabel,
  getExpiresLabel,
  getWeekStart,
} from "./defaults";

// Re-export types
export * from "./types";
export * from "./defaults";
export * from "./safetyRules";

// =============================================================================
// Core CRUD Operations
// =============================================================================

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isWeeklyIntentionValue = (value: unknown): value is WeeklyIntentionValue => {
  if (!isRecord(value)) return false;
  if (typeof value.carrying !== "string") return false;

  if (value.hoping !== undefined && typeof value.hoping !== "string") return false;

  const sessionLength = value.sessionLength;
  if (
    sessionLength !== undefined &&
    sessionLength !== "short" &&
    sessionLength !== "medium" &&
    sessionLength !== "deep"
  ) {
    return false;
  }

  return true;
};

const parseWeeklyIntentionValue = (value: unknown): WeeklyIntentionValue | null => {
  if (!isWeeklyIntentionValue(value)) return null;
  return {
    carrying: value.carrying,
    ...(value.hoping ? { hoping: value.hoping } : {}),
    ...(value.sessionLength ? { sessionLength: value.sessionLength } : {}),
  };
};

const isPrayerTopicValue = (value: unknown): value is PrayerTopicValue => {
  if (!isRecord(value)) return false;
  if (typeof value.topic !== "string") return false;
  if (value.checkInDay !== undefined && typeof value.checkInDay !== "string") return false;
  return true;
};

const parsePrayerTopicValue = (value: unknown): PrayerTopicValue | null => {
  if (!isPrayerTopicValue(value)) return null;
  return {
    topic: value.topic,
    ...(value.checkInDay ? { checkInDay: value.checkInDay } : {}),
  };
};

/**
 * Get all active (non-expired) life context items for a user.
 */
export async function getActiveLifeContext(
  userId: string,
  type?: LifeContextType
): Promise<LifeContextItemResponse[]> {
  const now = new Date();

  const where = {
    userId,
    OR: [
      { expiresAt: null },                    // Permanent items
      { expiresAt: { gt: now } },             // Not expired
      { pinnedUntil: { gt: now } },           // Pinned past expiry
    ],
    ...(type ? { type } : {}),
  };

  const items = await prisma.userLifeContext.findMany({
    where,
    orderBy: [
      { type: "asc" },
      { createdAt: "desc" },
    ],
  });

  return items.map((item) => formatForResponse(item));
}

/**
 * Get a single life context item by ID.
 */
export async function getLifeContextById(
  id: string,
  userId: string
): Promise<LifeContextItemResponse | null> {
  const item = await prisma.userLifeContext.findFirst({
    where: { id, userId },
  });

  if (!item) return null;
  return formatForResponse(item);
}

/**
 * Create a new life context item.
 */
export async function createLifeContext(
  userId: string,
  type: LifeContextType,
  value: LifeContextValue,
  options?: {
    source?: "user_entered" | "user_confirmed";
    expiresAt?: Date;
    checkInAt?: Date;
  }
): Promise<LifeContextItemResponse> {
  // For certain types, we want to replace existing rather than create duplicates
  const uniqueTypes: LifeContextType[] = ["season", "weekly_intention"];

  if (uniqueTypes.includes(type)) {
    // Delete existing items of this type
    await prisma.userLifeContext.deleteMany({
      where: { userId, type },
    });
  }

  const item = await prisma.userLifeContext.create({
    data: {
      userId,
      type,
      value: value as object,
      source: options?.source || "user_entered",
      expiresAt: options?.expiresAt ?? getDefaultExpiresAt(type),
      checkInAt: options?.checkInAt,
    },
  });

  return formatForResponse(item);
}

/**
 * Update an existing life context item.
 */
export async function updateLifeContext(
  id: string,
  userId: string,
  updates: {
    value?: LifeContextValue;
    expiresAt?: Date | null;
    pinnedUntil?: Date | null;
    lastCheckedIn?: Date;
  }
): Promise<LifeContextItemResponse | null> {
  // Verify ownership first
  const existing = await prisma.userLifeContext.findFirst({
    where: { id, userId },
  });

  if (!existing) return null;

  const item = await prisma.userLifeContext.update({
    where: { id },
    data: {
      ...(updates.value !== undefined && { value: updates.value as object }),
      ...(updates.expiresAt !== undefined && { expiresAt: updates.expiresAt }),
      ...(updates.pinnedUntil !== undefined && { pinnedUntil: updates.pinnedUntil }),
      ...(updates.lastCheckedIn !== undefined && { lastCheckedIn: updates.lastCheckedIn }),
    },
  });

  return formatForResponse(item);
}

/**
 * Delete a life context item.
 */
export async function deleteLifeContext(
  id: string,
  userId: string
): Promise<boolean> {
  const result = await prisma.userLifeContext.deleteMany({
    where: { id, userId },
  });

  return result.count > 0;
}

/**
 * Delete all life context items of a specific type.
 */
export async function deleteLifeContextByType(
  userId: string,
  type: LifeContextType
): Promise<number> {
  const result = await prisma.userLifeContext.deleteMany({
    where: { userId, type },
  });

  return result.count;
}

/**
 * Delete all life context items for a user.
 */
export async function clearAllLifeContext(userId: string): Promise<number> {
  const result = await prisma.userLifeContext.deleteMany({
    where: { userId },
  });

  return result.count;
}

// =============================================================================
// Active Context for AI (flattened, denormalized)
// =============================================================================

/**
 * Get the active life context in the format needed for AI prompt injection.
 * This fetches all active context and flattens it into a single object.
 */
export async function getActiveLifeContextForAI(
  userId: string,
  encouragementStyle: EncouragementStyle = "gentle"
): Promise<ActiveLifeContext> {
  const items = await getActiveLifeContext(userId);

  const context: ActiveLifeContext = {
    encouragementStyle,
  };

  for (const item of items) {
    switch (item.type) {
      case "season": {
        const v = item.value as SeasonValue;
        context.currentSeason = v.season;
        context.seasonNote = v.note;
        break;
      }

      case "weekly_intention": {
        const v = item.value as WeeklyIntentionValue;
        context.weeklyIntention = {
          carrying: v.carrying,
          hoping: v.hoping,
        };
        context.sessionPreference = v.sessionLength;
        break;
      }

      case "schedule": {
        const v = item.value as ScheduleValue;
        if (v.busyDays) context.busyDays = v.busyDays;
        if (v.preferredTime) context.preferredTime = v.preferredTime;
        break;
      }

      case "prayer_topic": {
        const v = item.value as PrayerTopicValue;
        if (!context.prayerTopics) context.prayerTopics = [];
        context.prayerTopics.push(v.topic);
        break;
      }

      case "goal": {
        // Goals aren't currently surfaced in AI context
        break;
      }
    }
  }

  return context;
}

// =============================================================================
// Weekly Check-in Helpers
// =============================================================================

/**
 * Get the previous week's intention (if any).
 */
export async function getPreviousWeekIntention(
  userId: string
): Promise<{ carrying: string; hoping?: string } | null> {
  const weekStart = getWeekStart();

  // Look for intentions created before this week
  const previousIntention = await prisma.userLifeContext.findFirst({
    where: {
      userId,
      type: "weekly_intention",
      createdAt: { lt: weekStart },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!previousIntention) return null;

  const value = parseWeeklyIntentionValue(previousIntention.value);
  if (!value) return null;
  return {
    carrying: value.carrying,
    hoping: value.hoping,
  };
}

/**
 * Check if user has completed a check-in this week.
 */
export async function hasCheckedInThisWeek(userId: string): Promise<boolean> {
  const weekStart = getWeekStart();

  const thisWeekIntention = await prisma.userLifeContext.findFirst({
    where: {
      userId,
      type: "weekly_intention",
      createdAt: { gte: weekStart },
    },
  });

  return !!thisWeekIntention;
}

/**
 * Get personalized suggestions based on history.
 */
export async function getCheckinSuggestions(
  userId: string
): Promise<{ carrying: string[]; hoping: string[] }> {
  // Get recent prayer topics and past intentions for personalization
  const recentItems = await prisma.userLifeContext.findMany({
    where: {
      userId,
      type: { in: ["prayer_topic", "weekly_intention"] },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const carryingSuggestions = new Set<string>();
  const hopingSuggestions = new Set<string>();

  for (const item of recentItems) {
    if (item.type === "prayer_topic") {
      const v = parsePrayerTopicValue(item.value);
      if (!v) continue;
      if (v.topic.length < 50) {
        carryingSuggestions.add(v.topic);
      }
    } else if (item.type === "weekly_intention") {
      const v = parseWeeklyIntentionValue(item.value);
      if (!v) continue;
      if (v.carrying.length < 50) {
        carryingSuggestions.add(v.carrying);
      }
      if (v.hoping && v.hoping.length < 50) {
        hopingSuggestions.add(v.hoping);
      }
    }
  }

  // Import defaults as fallback
  const { DEFAULT_CARRYING_SUGGESTIONS, DEFAULT_HOPING_SUGGESTIONS } = await import("./defaults");

  return {
    carrying: carryingSuggestions.size > 0
      ? Array.from(carryingSuggestions).slice(0, 4)
      : DEFAULT_CARRYING_SUGGESTIONS.slice(0, 4),
    hoping: hopingSuggestions.size > 0
      ? Array.from(hopingSuggestions).slice(0, 4)
      : DEFAULT_HOPING_SUGGESTIONS.slice(0, 4),
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a database item for API response.
 */
function formatForResponse(item: {
  id: string;
  type: string;
  value: unknown;
  source: string;
  visibility: string;
  expiresAt: Date | null;
  pinnedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): LifeContextItemResponse {
  const value = item.value as LifeContextValue;
  const type = item.type as LifeContextType;

  const now = new Date();
  const isPinned = item.pinnedUntil !== null && item.pinnedUntil > now;

  return {
    id: item.id,
    type,
    value,
    source: item.source as "user_entered" | "user_confirmed",
    visibility: item.visibility as "private" | "group_shareable",
    expiresAt: item.expiresAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    displayLabel: getDisplayLabel(type, value),
    expiresLabel: getExpiresLabel(item.expiresAt),
    isPinned,
  };
}
