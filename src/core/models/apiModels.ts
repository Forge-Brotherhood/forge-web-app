/**
 * API Response Models
 * These models match the backend API response structures exactly.
 * They should be converted to domain models for use in the UI.
 */

// MARK: - Profile API

export interface APIProfileResponse {
  id: string;
  email: string;
  displayName?: string;
  handle?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  createdAt: string;
  role: string;
  prayerStreak?: number;
}

// MARK: - User Reading Plans API

export interface APIUserReadingPlan {
  id: string;
  shortId: string;
  status: 'scheduled' | 'active' | 'paused' | 'completed' | 'canceled';
  startDate: string;
  timezone: string;
  notifyDaily: boolean;
  template: APIReadingPlanTemplate;
  progressCount: number;
  createdAt: string;
}

export interface APIReadingPlanTemplate {
  id: string;
  shortId: string;
  title: string;
  subtitle?: string;
  description?: string;
  coverImageUrl?: string;
  totalDays: number;
  estimatedMinutesMin: number;
  estimatedMinutesMax: number;
  days?: APIReadingPlanTemplateDay[];
}

export interface APIReadingPlanTemplateDay {
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

export interface APIUserReadingPlansResponse {
  success: boolean;
  plans: APIUserReadingPlan[];
}

export interface APITodayReadingResponse {
  success: boolean;
  today: APITodayReading | null;
}

export interface APITodayReading {
  planId: string;
  planShortId: string;
  planStatus: 'scheduled' | 'in_progress' | 'completed';
  planTitle: string;
  coverImageUrl?: string;
  totalDays: number;
  currentDay: number;
  day: APITodayReadingDay;
  progress: APIReadingProgress;
  reflections: APIReadingReflection[];
}

export interface APITodayReadingDay {
  id: string;
  dayNumber: number;
  scriptureBlocks: unknown;
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
  audio?: APIReadingDayAudio;
}

export interface APIReadingDayAudio {
  audioUrl: string;
  durationMs: number;
  markers: unknown;
  translation: string;
}

export interface APIReadingProgress {
  hasRead: boolean;
  hasReflected: boolean;
  hasPrayed: boolean;
  completedAt: string | null;
}

export interface APIReadingReflection {
  id: string;
  kind: 'reflection' | 'self_prayer';
  content?: string;
  audioUrl?: string;
  createdAt: string;
}

export interface CreateUserReadingPlanRequest {
  templateId: string;
  startDate?: string;
  timezone?: string;
  notifyDaily?: boolean;
}

export interface UpdateUserReadingPlanRequest {
  status?: 'scheduled' | 'active' | 'paused' | 'completed' | 'canceled';
  notifyDaily?: boolean;
}

export interface UpdateReadingProgressRequest {
  templateDayId: string;
  hasRead?: boolean;
  hasReflected?: boolean;
  hasPrayed?: boolean;
}

export interface CreateReadingReflectionRequest {
  templateDayId: string;
  kind?: 'reflection' | 'self_prayer';
  content?: string;
  audioUrl?: string;
}

// MARK: - Generic Responses

export interface SuccessResponse {
  success: boolean;
  message?: string;
}
