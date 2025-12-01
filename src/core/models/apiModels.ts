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
  memberships?: APIGroupMembership[];
}

export interface APIGroupMembership {
  groupId: string;
  role: string;
  group?: APIGroupBasic;
}

export interface APIGroupBasic {
  id: string;
  name?: string;
  description?: string;
  groupType: string;
  members?: APIGroupMemberResponse[];
}

// MARK: - Groups API

export interface APIGroupResponse {
  id: string;
  shortId: string;
  name?: string;
  description?: string;
  groupType: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  members?: APIGroupMemberResponse[];
  prayerRequests?: APIGroupPrayerRequest[];
  _count?: APIGroupCount;
}

export interface APIGroupMemberResponse {
  groupId: string;
  userId: string;
  status: string;
  role: string;
  joinedAt: string;
  user: APIGroupMemberUser;
}

export interface APIGroupMemberUser {
  id: string;
  displayName?: string;
  firstName?: string;
  profileImageUrl?: string;
}

export interface APIGroupPrayerRequest {
  id: string;
  status: string;
  createdAt: string;
}

export interface APIGroupCount {
  prayerRequests: number;
}

// MARK: - Create/Update Group Requests

export interface CreateGroupRequest {
  name: string;
  description?: string;
  groupType?: 'circle' | 'core';
}

export interface UpdateGroupRequest {
  name?: string;
  description?: string;
}

export interface JoinGroupRequest {
  code: string;
}

export interface LeaveGroupRequest {
  groupId: string;
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
  groupId?: string;
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
  groupId?: string;
  authorId: string;
  title?: string;
  sharedToCommunity: boolean;
  isAnonymous: boolean;
  status: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  author?: APIThreadAuthor;
  group?: APIThreadGroup;
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

// MARK: - Thread Author/Group

export interface APIThreadAuthor {
  id: string;
  displayName?: string;
  firstName?: string;
  profileImageUrl?: string;
  voiceIntroUrl?: string;
}

export interface APIThreadGroup {
  id: string;
  shortId?: string;
  name?: string;
  description?: string;
  groupType?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  members?: APIGroupMember[];
}

export interface APIGroupMember {
  groupId: string;
  userId: string;
  status: string;
  role: string;
  joinedAt: string;
  user: APIThreadAuthor;
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
  groupId?: string;
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
  group?: APIThreadGroup;
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
  group?: APIPrayerListGroup;
  posts?: APIThreadEntry[];
  _count?: APIPrayerListCount;
}

export interface APIPrayerListAuthor {
  id: string;
  displayName?: string;
  firstName?: string;
  profileImageUrl?: string;
}

export interface APIPrayerListGroup {
  id: string;
  name?: string;
  groupType: string;
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

// MARK: - Group Invites API

export interface CreateShareLinkRequest {
  expiresInDays?: number;
}

export interface GroupShareLinkResponse {
  url: string;
  token: string;
  expiresAt: string;
}

export interface InviteDetailsResponse {
  valid: boolean;
  expired: boolean;
  alreadyMember?: boolean;
  error?: string;
  group?: InviteGroupPreview;
  inviter?: InviteCreator;
}

export interface InviteGroupPreview {
  id: string;
  name?: string;
  description?: string;
  memberCount: number;
  groupType: string;
}

export interface InviteCreator {
  displayName?: string;
  profileImageUrl?: string;
}

export interface AcceptInviteResponse {
  success: boolean;
  alreadyMember?: boolean;
  group: APIGroupResponse;
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
