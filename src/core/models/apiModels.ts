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

// MARK: - Threads API

export interface APIThreadsResponse {
  threads: APICommunityThread[];
  totalCount: number;
  hasMore: boolean;
}

export interface CreateThreadRequest {
  title?: string;
  content: string;
  postKind?: 'request' | 'update' | 'testimony';
  isAnonymous?: boolean;
  sharedToCommunity?: boolean;
  mediaIds?: string[];
  mediaUrls?: MediaAttachment[];
}

export interface CreateThreadResponse {
  id: string;
  shortId: string;
  authorId: string;
  title?: string;
  sharedToCommunity: boolean;
  isAnonymous: boolean;
  status: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  author?: APIThreadAuthor;
  entries?: APIThreadEntry[];
}

export interface UpdateThreadRequest {
  status?: 'open' | 'answered' | 'archived';
  title?: string;
  sharedToCommunity?: boolean;
}

export interface UpdateThreadResponse {
  id: string;
  status: string;
  sharedToCommunity: boolean;
  updatedAt: string;
}

// MARK: - Thread Author

export interface APIThreadAuthor {
  id: string;
  displayName?: string;
  firstName?: string;
  profileImageUrl?: string;
  voiceIntroUrl?: string;
}

// MARK: - Thread Entry

export interface APIThreadEntry {
  id: string;
  shortId?: string;
  requestId?: string;
  authorId?: string;
  kind: 'request' | 'update' | 'testimony' | 'encouragement' | 'verse' | 'system';
  content?: string;
  amenCount?: number;
  isHidden?: boolean;
  reportedCount?: number;
  createdAt: string;
  updatedAt?: string;
  author?: APIThreadAuthor;
  attachments?: APIThreadAttachment[];
  responses?: APIThreadResponse[];
  _count?: APIPostCount;
}

export interface APIThreadAttachment {
  id: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  width?: number;
  height?: number;
  durationS?: number;
  muxPlaybackId?: string;
  uploadStatus?: string;
}

export interface APIThreadResponse {
  id: string;
  type: 'amen' | 'emoji' | 'verse_ref';
  payload?: string;
  createdAt: string;
  user: APIResponseUser;
}

export interface APIResponseUser {
  id: string;
  displayName?: string;
  firstName?: string;
}

export interface APIPostCount {
  actions: number;
}

// MARK: - Community Thread (full response)

export interface APICommunityThread {
  id: string;
  shortId?: string;
  authorId?: string;
  title?: string;
  sharedToCommunity: boolean;
  isAnonymous: boolean;
  status: 'open' | 'answered' | 'archived';
  lastActivityAt?: string;
  postCount?: number;
  amenCount?: number;
  isHidden?: boolean;
  reportedCount?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  author?: APIThreadAuthor;
  entries: APIThreadEntry[];
  savedBy?: APISavedByItem[];
  actions?: APIPrayerAction[];
  _count: APIThreadCount;
}

export interface APISavedByItem {
  id: string;
  entryId?: string;
}

export interface APIPrayerAction {
  id?: string;
  userId?: string;
  createdAt?: string;
  user?: APIResponseUser;
}

export interface APIThreadCount {
  entries: number;
  actions: number;
  savedBy: number;
}

// MARK: - Prayer List API

export interface APIPrayerListResponse {
  success: boolean;
  items: APIPrayerListItem[];
  count: number;
}

export interface APIPrayerListItem {
  id: string;
  userId: string;
  requestId: string;
  entryId?: string;
  createdAt: string;
  thread?: APIPrayerListRequest;
}

export interface APIPrayerListRequest {
  id: string;
  shortId?: string;
  title?: string;
  status: string;
  lastActivityAt?: string;
  createdAt: string;
  updatedAt?: string;
  isAnonymous?: boolean;
  sharedToCommunity?: boolean;
  author?: APIPrayerListAuthor;
  posts?: APIThreadEntry[];
  _count?: APIPrayerListCount;
}

export interface APIPrayerListAuthor {
  id: string;
  displayName?: string;
  firstName?: string;
  profileImageUrl?: string;
}

export interface APIPrayerListCount {
  actions?: number;
  entries?: number;
  savedBy?: number;
}

// MARK: - Prayer Actions API

export interface RecordPrayerRequest {
  postId?: string;
}

export interface RecordPrayerResponse {
  prayer?: APIPrayerRecord;
  updatedStreak?: number;
}

export interface APIPrayerRecord {
  id: string;
  userId: string;
  requestId: string;
  entryId?: string;
  createdAt: string;
}

export interface RemovePrayerResponse {
  action: string;
  success: boolean;
}

// MARK: - Add Post API

export interface AddPostRequest {
  content: string;
  kind: 'update' | 'testimony' | 'encouragement' | 'verse';
  media?: MediaAttachment[];
}

export interface MediaAttachment {
  url: string;
  type: 'image' | 'video' | 'audio';
  width?: number;
  height?: number;
  durationS?: number;
}

export interface AddPostResponse {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author?: APIThreadAuthor;
  attachments: APIThreadAttachment[];
  responses: APIThreadResponse[];
  _count: APIPostCount;
}

// MARK: - Reactions API

export interface AddReactionRequest {
  postId: string;
  type: 'amen' | 'emoji' | 'verse_ref';
  payload?: string;
}

export interface AddReactionResponse {
  id: string;
  type: string;
  payload?: string;
  createdAt: string;
}

// MARK: - Prayer List Toggle API

export interface PrayerListToggleRequest {
  threadId: string;
  entryId?: string;
}

export interface PrayerListToggleResponse {
  success: boolean;
  isSaved: boolean;
  action: 'added' | 'removed';
  savedCount: number;
}

// MARK: - Thread Detail API

export interface ThreadDetailResponse {
  thread: APICommunityThread;
  currentUser?: APIThreadAuthor;
  initialPrayerStatus: APIPrayerStatus;
}

export interface APIPrayerStatus {
  hasPrayed: boolean;
  prayerCount: number;
  isInPrayerList: boolean;
  prayerListCount: number;
}

// MARK: - Delete Post API

export interface DeletePostResponse {
  success: boolean;
  message?: string;
}
