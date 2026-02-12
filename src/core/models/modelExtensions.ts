/**
 * Model Extensions
 * Conversion functions to transform API response models to domain models.
 * Mirrors iOS ModelExtensions.swift pattern.
 */

import type {
  User,
  PrayerRequest,
  PrayerEntry,
  Attachment,
  PrayerResponse,
  FeedItem,
  SavedPrayerItem,
} from './models';
import {
  PrayerStatus,
  EntryKind,
  AttachmentType,
  ResponseType,
} from './models';
import type {
  APIProfileResponse,
  APICommunityThread,
  APIThreadEntry,
  APIThreadAttachment,
  APIThreadResponse,
  APIPrayerListItem,
  APIPrayerListRequest,
} from './apiModels';

// MARK: - Date Parsing

/**
 * Parse ISO8601 date string to Date object
 * Handles both formats with and without fractional seconds
 */
export function parseDate(dateString: string | undefined | null): Date {
  if (!dateString) return new Date();

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return new Date();
    }
    return date;
  } catch {
    return new Date();
  }
}

// MARK: - Profile Conversion

export function apiProfileToUser(api: APIProfileResponse): User {
  return {
    id: api.id,
    clerkId: '', // Not included in profile response
    email: api.email,
    firstName: api.firstName,
    lastName: api.lastName,
    displayName: api.displayName,
    handle: api.handle,
    profileImageUrl: api.profileImageUrl,
    prayerStreak: api.prayerStreak ?? 0,
    lastPrayerAt: undefined,
    createdAt: parseDate(api.createdAt),
    updatedAt: new Date(),
  };
}

// MARK: - Thread Conversion

export function communityThreadToPrayerRequest(thread: APICommunityThread): PrayerRequest {
  const author: User | undefined = thread.author
    ? {
        id: thread.author.id,
        clerkId: '',
        email: '',
        firstName: thread.author.firstName,
        displayName: thread.author.displayName,
        profileImageUrl: thread.author.profileImageUrl,
        prayerStreak: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    : undefined;

  const entries = thread.entries.map(threadEntryToPrayerEntry);

  return {
    id: thread.id,
    shortId: thread.shortId ?? thread.id,
    authorId: thread.authorId ?? '',
    title: thread.title,
    sharedToCommunity: thread.sharedToCommunity,
    isAnonymous: thread.isAnonymous,
    status: stringToPrayerStatus(thread.status),
    lastActivityAt: parseDate(thread.lastActivityAt),
    postCount: thread.postCount ?? thread._count.entries,
    amenCount: thread.amenCount ?? thread._count.actions,
    isHidden: thread.isHidden ?? false,
    createdAt: parseDate(thread.createdAt),
    updatedAt: parseDate(thread.updatedAt),
    author,
    entries,
  };
}

export function threadEntryToPrayerEntry(entry: APIThreadEntry): PrayerEntry {
  const author: User | undefined = entry.author
    ? {
        id: entry.author.id,
        clerkId: '',
        email: '',
        firstName: entry.author.firstName,
        displayName: entry.author.displayName,
        profileImageUrl: entry.author.profileImageUrl,
        prayerStreak: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    : undefined;

  const attachments = entry.attachments?.map(threadAttachmentToAttachment) ?? [];
  const responses = entry.responses?.map(threadResponseToPrayerResponse) ?? [];

  return {
    id: entry.id,
    shortId: entry.shortId ?? entry.id,
    requestId: entry.requestId ?? '',
    authorId: entry.authorId,
    kind: stringToEntryKind(entry.kind),
    content: entry.content,
    amenCount: entry.amenCount ?? entry._count?.actions ?? 0,
    isHidden: entry.isHidden ?? false,
    createdAt: parseDate(entry.createdAt),
    updatedAt: parseDate(entry.updatedAt),
    author,
    attachments,
    responses,
  };
}

export function threadAttachmentToAttachment(attachment: APIThreadAttachment): Attachment {
  return {
    id: attachment.id,
    type: attachment.type as AttachmentType,
    url: attachment.url,
    width: attachment.width,
    height: attachment.height,
    durationS: attachment.durationS,
    muxPlaybackId: attachment.muxPlaybackId,
    uploadStatus: attachment.uploadStatus,
  };
}

export function threadResponseToPrayerResponse(response: APIThreadResponse): PrayerResponse {
  return {
    id: response.id,
    type: response.type as ResponseType,
    payload: response.payload,
    createdAt: parseDate(response.createdAt),
    user: {
      id: response.user.id,
      displayName: response.user.displayName,
      firstName: response.user.firstName,
    },
  };
}

// MARK: - Feed Item Conversion

export function communityThreadToFeedItem(
  thread: APICommunityThread,
  currentUserId?: string
): FeedItem {
  const mainEntry = thread.entries.find(
    (e) => e.kind === 'request' || e.kind === 'testimony'
  ) ?? thread.entries[0];

  const primaryAuthor = thread.isAnonymous ? undefined : (thread.author ?? mainEntry?.author);

  const userId = primaryAuthor?.id ?? '';
  const userName = thread.isAnonymous
    ? 'Anonymous'
    : primaryAuthor?.displayName ?? primaryAuthor?.firstName ?? 'Unknown';
  const userAvatar = thread.isAnonymous ? undefined : primaryAuthor?.profileImageUrl;

  const hasPrayed = thread.actions?.some((a) => a.userId === currentUserId) ?? false;
  const isInPrayerList = thread.savedBy?.some((s) => s.id === currentUserId) ?? false;

  const updateStatus: 'answered' | 'update' | undefined =
    thread.status === 'answered' || mainEntry?.kind === 'testimony' ? 'answered' : undefined;

  return {
    id: thread.shortId ?? thread.id,
    postId: mainEntry?.id,
    userId,
    userName,
    userAvatar,
    isAnonymous: thread.isAnonymous,
    title: thread.title,
    content: mainEntry?.content ?? '',
    createdAt: parseDate(mainEntry?.createdAt ?? thread.createdAt),
    prayerCount: thread._count.actions,
    prayerListCount: thread._count.savedBy,
    encouragementCount: Math.max(0, thread._count.entries - 1),
    isFollowing: false,
    hasPrayed,
    isInPrayerList,
    hasEncouraged: false,
    updateStatus,
    sharedToCommunity: thread.sharedToCommunity,
  };
}

// MARK: - Prayer List Conversion

export function prayerListItemToSavedPrayer(item: APIPrayerListItem): SavedPrayerItem {
  const request = item.thread ? prayerListRequestToPrayerRequest(item.thread) : undefined;

  return {
    id: item.id,
    userId: item.userId,
    requestId: item.requestId,
    entryId: item.entryId,
    createdAt: parseDate(item.createdAt),
    request,
  };
}

export function prayerListRequestToPrayerRequest(api: APIPrayerListRequest): PrayerRequest {
  const author: User | undefined = api.author
    ? {
        id: api.author.id,
        clerkId: '',
        email: '',
        firstName: api.author.firstName,
        displayName: api.author.displayName,
        profileImageUrl: api.author.profileImageUrl,
        prayerStreak: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    : undefined;

  const entries = api.posts?.map(threadEntryToPrayerEntry) ?? [];

  return {
    id: api.id,
    shortId: api.shortId ?? '',
    authorId: api.author?.id ?? '',
    title: api.title,
    sharedToCommunity: api.sharedToCommunity ?? false,
    isAnonymous: api.isAnonymous ?? false,
    status: stringToPrayerStatus(api.status),
    lastActivityAt: parseDate(api.lastActivityAt),
    postCount: entries.length,
    amenCount: api._count?.actions ?? 0,
    isHidden: false,
    createdAt: parseDate(api.createdAt),
    updatedAt: parseDate(api.createdAt),
    author,
    entries,
  };
}

// MARK: - Enum Conversion Helpers

export function stringToPrayerStatus(status: string): PrayerStatus {
  switch (status) {
    case 'open':
      return PrayerStatus.Open;
    case 'answered':
      return PrayerStatus.Answered;
    case 'archived':
      return PrayerStatus.Archived;
    default:
      return PrayerStatus.Open;
  }
}

export function stringToEntryKind(kind: string): EntryKind {
  switch (kind) {
    case 'request':
      return EntryKind.Request;
    case 'update':
      return EntryKind.Update;
    case 'testimony':
      return EntryKind.Testimony;
    case 'encouragement':
      return EntryKind.Encouragement;
    case 'verse':
      return EntryKind.Verse;
    case 'system':
      return EntryKind.System;
    default:
      return EntryKind.Request;
  }
}

export function stringToAttachmentType(type: string): AttachmentType {
  switch (type) {
    case 'image':
      return AttachmentType.Image;
    case 'video':
      return AttachmentType.Video;
    case 'audio':
      return AttachmentType.Audio;
    default:
      return AttachmentType.Image;
  }
}

export function stringToResponseType(type: string): ResponseType {
  switch (type) {
    case 'amen':
      return ResponseType.Amen;
    case 'emoji':
      return ResponseType.Emoji;
    case 'verse_ref':
      return ResponseType.VerseRef;
    default:
      return ResponseType.Amen;
  }
}
