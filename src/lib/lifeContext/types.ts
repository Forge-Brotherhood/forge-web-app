/**
 * Life Context Types
 *
 * Type definitions for the pastoral profile / life context system.
 * These types define what the AI can know about a user's current
 * life situation, schedule, and spiritual season.
 */

// =============================================================================
// Context Type Definitions
// =============================================================================

/**
 * The types of life context that can be stored.
 */
export type LifeContextType =
  | "schedule"
  | "season"
  | "prayer_topic"
  | "weekly_intention"
  | "goal";

/**
 * Pastoral seasons - non-clinical, user-selected emotional/spiritual states.
 * These are what the user is currently experiencing, not diagnoses.
 */
export type SeasonType =
  | "anxious"           // anxious / overwhelmed
  | "grieving"          // grieving / heavy-hearted
  | "discerning"        // discerning / decision-making
  | "thankful"          // thankful / joyful
  | "lonely"            // lonely / needing community
  | "struggling"        // struggling with temptation
  | "seeking_discipline"; // seeking discipline / consistency

/**
 * Human-readable labels for seasons (for iOS display)
 */
export const SEASON_LABELS: Record<SeasonType, string> = {
  anxious: "Feeling anxious or overwhelmed",
  grieving: "Grieving or heavy-hearted",
  discerning: "Making a decision",
  thankful: "Thankful and joyful",
  lonely: "Lonely or needing community",
  struggling: "Struggling with temptation",
  seeking_discipline: "Seeking discipline",
};

/**
 * Encouragement style preference - how the user likes to be supported.
 * Stored in UserPreferences (stable), not UserLifeContext (time-scoped).
 */
export type EncouragementStyle =
  | "direct"      // direct and practical
  | "gentle"      // gentle and reassuring (default)
  | "challenge"   // challenge me
  | "questions";  // ask me questions

/**
 * Human-readable labels for encouragement styles
 */
export const ENCOURAGEMENT_STYLE_LABELS: Record<EncouragementStyle, string> = {
  direct: "Direct and practical",
  gentle: "Gentle and reassuring",
  challenge: "Challenge me",
  questions: "Ask me questions",
};

/**
 * Source of context - how it was created.
 * Only user_entered or user_confirmed are allowed (no inference).
 */
export type ContextSource = "user_entered" | "user_confirmed";

/**
 * Visibility of context - who can see it.
 */
export type ContextVisibility = "private" | "group_shareable";

/**
 * Session length preference for the week.
 */
export type SessionLength = "short" | "medium" | "deep";

// =============================================================================
// Value Schemas (type-specific JSON structures)
// =============================================================================

/**
 * Schedule context value - busy days and time preferences.
 */
export interface ScheduleValue {
  busyDays?: string[];                              // ["Monday", "Friday"]
  preferredTime?: "morning" | "evening" | "flexible";
  travelDays?: string[];                            // ISO date strings
}

/**
 * Season context value - current emotional/spiritual state.
 */
export interface SeasonValue {
  season: SeasonType;
  note?: string;                                    // Optional user note (max 100 chars)
}

/**
 * Prayer topic value - something to remember and check in on.
 */
export interface PrayerTopicValue {
  topic: string;                                    // Max 200 chars
  checkInDay?: string;                              // "Friday"
}

/**
 * Weekly intention value - what they're carrying and hoping for.
 */
export interface WeeklyIntentionValue {
  carrying: string;                                 // What I'm carrying this week
  hoping?: string;                                  // What I'm hoping for (optional)
  sessionLength?: SessionLength;                    // Preferred depth
}

/**
 * Goal value - long-term spiritual goals.
 */
export interface GoalValue {
  goal: string;                                     // The goal description
  category?: "reading" | "prayer" | "community" | "growth" | "other";
}

/**
 * Union type for all context values
 */
export type LifeContextValue =
  | ScheduleValue
  | SeasonValue
  | PrayerTopicValue
  | WeeklyIntentionValue
  | GoalValue;

// =============================================================================
// Full Context Item (from database)
// =============================================================================

/**
 * A life context item as stored in the database.
 */
export interface LifeContextItem {
  id: string;
  userId: string;
  type: LifeContextType;
  value: LifeContextValue;
  source: ContextSource;
  visibility: ContextVisibility;
  expiresAt: Date | null;
  pinnedUntil: Date | null;
  checkInAt: Date | null;
  lastCheckedIn: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Life context item for API response (includes computed display fields).
 */
export interface LifeContextItemResponse {
  id: string;
  type: LifeContextType;
  value: LifeContextValue;
  source: ContextSource;
  visibility: ContextVisibility;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Computed fields for iOS display
  displayLabel: string;
  expiresLabel: string | null;
  isPinned: boolean;
}

// =============================================================================
// Active Life Context (for AI injection)
// =============================================================================

/**
 * The active life context used in AI prompts.
 * This is a flattened, denormalized view of the user's current context.
 */
export interface ActiveLifeContext {
  currentSeason?: SeasonType;
  seasonNote?: string;
  weeklyIntention?: {
    carrying: string;
    hoping?: string;
  };
  busyDays?: string[];
  preferredTime?: "morning" | "evening" | "flexible";
  prayerTopics?: string[];
  encouragementStyle: EncouragementStyle;
  sessionPreference?: SessionLength;
  goals?: string[];
}

// =============================================================================
// API Request/Response Types
// =============================================================================

/**
 * Request body for creating a life context item.
 */
export interface CreateLifeContextRequest {
  type: LifeContextType;
  value: LifeContextValue;
  source?: ContextSource;
  expiresAt?: string;           // ISO date string (optional - uses default if not provided)
  checkInAt?: string;           // ISO date string
}

/**
 * Request body for updating a life context item.
 */
export interface UpdateLifeContextRequest {
  value?: LifeContextValue;
  expiresAt?: string | null;    // Extend or remove expiry
  pinnedUntil?: string | null;  // Pin for longer
}

/**
 * Weekly check-in request.
 */
export interface WeeklyCheckinRequest {
  carrying: string;
  hoping?: string;
  busyDays?: string[];
  sessionLength?: SessionLength;
  previousWeekResolved?: boolean;  // Mark last week as resolved
}

/**
 * Weekly check-in response.
 */
export interface WeeklyCheckinResponse {
  hasCompletedThisWeek: boolean;
  lastCheckinDate: string | null;
  previousWeek: {
    carrying: string;
    hoping?: string;
    resolved: boolean;
  } | null;
  suggestions: {
    carrying: string[];
    hoping: string[];
  };
  currentContext: {
    weeklyIntention: WeeklyIntentionValue | null;
    busyDays: string[] | null;
  };
}
