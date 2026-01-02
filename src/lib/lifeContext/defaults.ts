/**
 * Life Context Defaults
 *
 * Default TTLs, values, and helper functions for the life context system.
 */

import type { LifeContextType, SeasonType } from "./types";

// =============================================================================
// Default TTLs (in days)
// =============================================================================

/**
 * Default expiration periods for each context type.
 * null means the item is permanent (goals).
 */
export const DEFAULT_TTL_DAYS: Record<LifeContextType, number | null> = {
  schedule: 7,          // Weekly reset
  season: 14,           // Two weeks, gentle expiry
  prayer_topic: 7,      // One week with check-in option
  weekly_intention: 7,  // Resets each week
  goal: null,           // Permanent until deleted
};

/**
 * Get the default expiration date for a context type.
 * Returns null for permanent items.
 */
export function getDefaultExpiresAt(type: LifeContextType): Date | null {
  const days = DEFAULT_TTL_DAYS[type];
  if (days === null) return null;

  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  // Set to end of day
  expires.setHours(23, 59, 59, 999);
  return expires;
}

/**
 * Get the start of the current week (Sunday).
 */
export function getWeekStart(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const start = new Date(now);
  start.setDate(now.getDate() - dayOfWeek);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Get the end of the current week (Saturday 23:59:59).
 */
export function getWeekEnd(): Date {
  const start = getWeekStart();
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

// =============================================================================
// Display Label Generators
// =============================================================================

import { SEASON_LABELS } from "./types";
import type {
  LifeContextValue,
  ScheduleValue,
  SeasonValue,
  PrayerTopicValue,
  WeeklyIntentionValue,
  GoalValue,
} from "./types";

/**
 * Generate a human-readable display label for a context item.
 */
export function getDisplayLabel(
  type: LifeContextType,
  value: LifeContextValue
): string {
  switch (type) {
    case "schedule": {
      const v = value as ScheduleValue;
      if (v.busyDays && v.busyDays.length > 0) {
        return `Busy: ${v.busyDays.join(", ")}`;
      }
      if (v.preferredTime) {
        return `Prefer ${v.preferredTime} study`;
      }
      return "Schedule preferences";
    }

    case "season": {
      const v = value as SeasonValue;
      return SEASON_LABELS[v.season] || v.season;
    }

    case "prayer_topic": {
      const v = value as PrayerTopicValue;
      // Truncate long topics
      if (v.topic.length > 50) {
        return v.topic.slice(0, 47) + "...";
      }
      return v.topic;
    }

    case "weekly_intention": {
      const v = value as WeeklyIntentionValue;
      if (v.carrying.length > 50) {
        return v.carrying.slice(0, 47) + "...";
      }
      return v.carrying;
    }

    case "goal": {
      const v = value as GoalValue;
      if (v.goal.length > 50) {
        return v.goal.slice(0, 47) + "...";
      }
      return v.goal;
    }

    default:
      return "Unknown context";
  }
}

/**
 * Generate a human-readable expiration label.
 */
export function getExpiresLabel(expiresAt: Date | null): string | null {
  if (!expiresAt) return null;

  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return "Expired";
  } else if (diffDays === 0) {
    return "Expires today";
  } else if (diffDays === 1) {
    return "Expires tomorrow";
  } else if (diffDays <= 7) {
    return `Expires in ${diffDays} days`;
  } else {
    const weeks = Math.ceil(diffDays / 7);
    return `Expires in ${weeks} week${weeks > 1 ? "s" : ""}`;
  }
}

// =============================================================================
// Season to Guidance Mapping (for AI prompts)
// =============================================================================

/**
 * Convert a season type to guidance text for the AI.
 * This is what gets injected into the prompt to silently influence responses.
 */
export function seasonToGuidance(season: SeasonType): string {
  const map: Record<SeasonType, string> = {
    anxious: "anxiety - consider peace-focused passages like Psalm 23, Philippians 4:6-7",
    grieving: "grief - be gentle, suggest lament Psalms, acknowledge their pain",
    discerning: "discernment - focus on wisdom passages like Proverbs, James 1:5",
    thankful: "gratitude - amplify joy and praise, Psalms of thanksgiving",
    lonely: "loneliness - emphasize God's presence and community, Psalm 139",
    struggling: "struggle with temptation - offer strength passages like 1 Corinthians 10:13",
    seeking_discipline: "seeking discipline - practical encouragement, habits, rhythms",
  };
  return map[season];
}

// =============================================================================
// Weekly Check-in Suggestions
// =============================================================================

/**
 * Default carrying suggestions for weekly check-in.
 * These are shown when we don't have history to personalize.
 */
export const DEFAULT_CARRYING_SUGGESTIONS = [
  "A big decision",
  "A relationship",
  "Work stress",
  "Health concerns",
  "Financial worries",
  "Family matters",
];

/**
 * Default hoping suggestions for weekly check-in.
 */
export const DEFAULT_HOPING_SUGGESTIONS = [
  "Peace about a situation",
  "Wisdom for a decision",
  "Healing in a relationship",
  "Clarity on next steps",
  "Strength for a challenge",
  "Gratitude and joy",
];
