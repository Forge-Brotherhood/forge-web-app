/**
 * Core Domain Models
 * These models represent the application's domain entities.
 * They are separate from API response types to allow for clean data transformation.
 */

// MARK: - Enums

/** Reading plan status */
export enum ReadingPlanStatus {
  Scheduled = 'scheduled',
  Active = 'active',
  Paused = 'paused',
  Completed = 'completed',
  Canceled = 'canceled',
}

/** Reflection kind */
export enum ReflectionKind {
  Reflection = 'reflection',
  SelfPrayer = 'self_prayer',
}

// MARK: - User

export interface User {
  id: string;
  clerkId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  handle?: string;
  profileImageUrl?: string;
  prayerStreak: number;
  lastPrayerAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Helper functions for User */
export const UserHelpers = {
  getFullName(user: User): string {
    return [user.firstName, user.lastName].filter(Boolean).join(' ');
  },

  getDisplayNameOrFallback(user: User): string {
    if (user.displayName && user.displayName.length > 0) return user.displayName;
    const fullName = UserHelpers.getFullName(user);
    if (fullName.length > 0) return fullName;
    return user.email;
  },

  getInitials(user: User): string {
    const fullName = UserHelpers.getFullName(user);
    const words = fullName.split(' ');
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    } else if (user.firstName && user.firstName.length > 0) {
      return user.firstName[0].toUpperCase();
    }
    return '?';
  },
};

// MARK: - User Reading Plan

export interface UserReadingPlan {
  id: string;
  shortId: string;
  status: ReadingPlanStatus;
  startDate: Date;
  timezone: string;
  notifyDaily: boolean;
  template: ReadingPlanTemplate;
  progressCount: number;
  createdAt: Date;
}

export interface ReadingPlanTemplate {
  id: string;
  shortId: string;
  title: string;
  subtitle?: string;
  description?: string;
  coverImageUrl?: string;
  totalDays: number;
  estimatedMinutesMin: number;
  estimatedMinutesMax: number;
  days?: ReadingPlanDay[];
}

export interface ReadingPlanDay {
  id: string;
  dayNumber: number;
  passageRef: string;
  bookId?: string;
  startChapter?: number;
  startVerse?: number;
  endChapter?: number;
  endVerse?: number;
  title?: string;
  summary?: string;
  reflectionPrompt?: string;
  prayerPrompt?: string;
  contextIntro?: string;
}

export interface TodayReading {
  planId: string;
  planShortId: string;
  planStatus: string;
  planTitle: string;
  coverImageUrl?: string;
  totalDays: number;
  currentDay: number;
  day: TodayReadingDay;
  progress: ReadingProgress;
  reflections: ReadingReflection[];
}

export interface TodayReadingDay {
  id: string;
  dayNumber: number;
  passageRef: string;
  bookId?: string;
  startChapter?: number;
  startVerse?: number;
  endChapter?: number;
  endVerse?: number;
  title?: string;
  summary?: string;
  reflectionPrompt?: string;
  prayerPrompt?: string;
  contextIntro?: string;
  audio?: ReadingDayAudio;
}

export interface ReadingDayAudio {
  audioUrl: string;
  durationMs: number;
  markers: unknown;
  translation: string;
}

export interface ReadingProgress {
  hasRead: boolean;
  hasReflected: boolean;
  hasPrayed: boolean;
  completedAt?: Date;
}

export interface ReadingReflection {
  id: string;
  kind: ReflectionKind;
  content?: string;
  audioUrl?: string;
  createdAt: Date;
}

/** Helper functions for UserReadingPlan */
export const UserReadingPlanHelpers = {
  isActive(plan: UserReadingPlan): boolean {
    return plan.status === ReadingPlanStatus.Active;
  },

  isCompleted(plan: UserReadingPlan): boolean {
    return plan.status === ReadingPlanStatus.Completed;
  },

  getCompletionPercent(plan: UserReadingPlan): number {
    if (plan.template.totalDays === 0) return 0;
    return Math.round((plan.progressCount / plan.template.totalDays) * 100);
  },
};
