/**
 * Core Domain Models
 * These models represent the application's domain entities.
 * They are separate from API response types to allow for clean data transformation.
 */

// MARK: - Enums

/** Prayer request status */
export enum PrayerStatus {
  Open = 'open',
  Answered = 'answered',
  Archived = 'archived',
}

/** Prayer entry kind */
export enum EntryKind {
  Request = 'request',
  Update = 'update',
  Testimony = 'testimony',
  Encouragement = 'encouragement',
  Verse = 'verse',
  System = 'system',
}

/** Activity notification type */
export enum ActivityType {
  PrayerReceived = 'prayerReceived',
  UpdateReceived = 'updateReceived',
  NewRequest = 'newRequest',
  TestimonyShared = 'testimonyShared',
  EncouragementReceived = 'encouragementReceived',
}

/** Group type */
export enum GroupType {
  InPerson = 'in_person',
  Virtual = 'virtual',
}

/** Meeting cadence for in-person groups */
export enum MeetingCadence {
  Weekly = 'weekly',
  Biweekly = 'biweekly',
  Monthly = 'monthly',
}

/** Attachment type */
export enum AttachmentType {
  Image = 'image',
  Video = 'video',
  Audio = 'audio',
}

/** Response/reaction type */
export enum ResponseType {
  Amen = 'amen',
  Emoji = 'emoji',
  VerseRef = 'verse_ref',
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

// MARK: - Meeting Address

/** Structured address for meeting locations */
export interface MeetingAddress {
  locationName?: string;    // Venue name (e.g., "First Baptist Church")
  streetAddress?: string;   // Street address (e.g., "123 Main St")
  city?: string;            // City
  state?: string;           // State/Province
  postalCode?: string;      // ZIP/Postal code
  country?: string;         // Country (ISO 3166-1 alpha-2, e.g., "US")
  latitude?: number;        // Latitude for map display
  longitude?: number;       // Longitude for map display
  placeId?: string;         // Google Places ID for linking
}

/** Helper functions for MeetingAddress */
export const MeetingAddressHelpers = {
  /** Format address for display (single line) */
  formatShort(address?: MeetingAddress): string {
    if (!address) return '';
    const parts = [address.city, address.state].filter(Boolean);
    return parts.join(', ');
  },

  /** Format full address for display (multi-line capable) */
  formatFull(address?: MeetingAddress): string {
    if (!address) return '';
    const lines: string[] = [];
    if (address.locationName) lines.push(address.locationName);
    if (address.streetAddress) lines.push(address.streetAddress);
    const cityState = [address.city, address.state, address.postalCode].filter(Boolean).join(', ');
    if (cityState) lines.push(cityState);
    return lines.join('\n');
  },

  /** Generate Google Maps URL */
  getGoogleMapsUrl(address?: MeetingAddress): string | undefined {
    if (!address) return undefined;
    // Prefer place ID for most accurate link
    if (address.placeId) {
      return `https://www.google.com/maps/place/?q=place_id:${address.placeId}`;
    }
    // Fall back to coordinates
    if (address.latitude && address.longitude) {
      return `https://www.google.com/maps/search/?api=1&query=${address.latitude},${address.longitude}`;
    }
    // Fall back to address string
    const parts = [address.streetAddress, address.city, address.state, address.postalCode, address.country]
      .filter(Boolean);
    if (parts.length > 0) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`;
    }
    return undefined;
  },

  /** Generate Apple Maps URL */
  getAppleMapsUrl(address?: MeetingAddress): string | undefined {
    if (!address) return undefined;
    // Prefer coordinates
    if (address.latitude && address.longitude) {
      return `https://maps.apple.com/?ll=${address.latitude},${address.longitude}`;
    }
    // Fall back to address string
    const parts = [address.streetAddress, address.city, address.state, address.postalCode, address.country]
      .filter(Boolean);
    if (parts.length > 0) {
      return `https://maps.apple.com/?address=${encodeURIComponent(parts.join(', '))}`;
    }
    return undefined;
  },
};

// MARK: - Prayer Group

export interface PrayerGroup {
  id: string;
  shortId: string;
  name?: string;
  description?: string;
  groupType: GroupType | string;
  // Meeting schedule (only applicable for in_person groups)
  meetingCadence?: MeetingCadence | string;
  meetingDayOfWeek?: number; // 0-6 (Sunday-Saturday)
  meetingTime?: string; // e.g., "19:00" (24h format)
  meetingAddress?: MeetingAddress;
  createdAt: Date;
  updatedAt: Date;

  // UI-only fields (not from API directly)
  openRequestCount: number;
  answeredRequestCount: number;
  members: GroupMember[];
}

/** Helper functions for PrayerGroup */
export const PrayerGroupHelpers = {
  getDisplayName(group: PrayerGroup): string {
    return group.name ?? 'Unnamed Group';
  },

  isVirtual(group: PrayerGroup): boolean {
    return group.groupType === GroupType.Virtual || group.groupType === 'virtual';
  },

  isInPerson(group: PrayerGroup): boolean {
    return group.groupType === GroupType.InPerson || group.groupType === 'in_person';
  },

  /** Get formatted meeting location */
  getMeetingLocationDisplay(group: PrayerGroup): string {
    return MeetingAddressHelpers.formatShort(group.meetingAddress);
  },

  /** Get Google Maps URL for meeting location */
  getMeetingMapsUrl(group: PrayerGroup): string | undefined {
    return MeetingAddressHelpers.getGoogleMapsUrl(group.meetingAddress);
  },
};

// MARK: - Group Member

export interface GroupMember {
  groupId: string;
  userId: string;
  status: string;
  role: string;
  joinedAt: Date;
  user?: User;
}

/** Helper functions for GroupMember */
export const GroupMemberHelpers = {
  getId(member: GroupMember): string {
    return `${member.groupId}-${member.userId}`;
  },

  isActive(member: GroupMember): boolean {
    return member.status === 'active';
  },

  isLeader(member: GroupMember): boolean {
    return member.role === 'leader';
  },
};

// MARK: - Prayer Request

export interface PrayerRequest {
  id: string;
  shortId: string;
  groupId?: string;
  authorId: string;
  title?: string;
  sharedToCommunity: boolean;
  isAnonymous: boolean;
  status: PrayerStatus;
  lastActivityAt: Date;
  postCount: number;
  amenCount: number;
  isHidden: boolean;
  createdAt: Date;
  updatedAt: Date;

  // UI-only fields
  author?: User;
  group?: PrayerGroup;
  entries: PrayerEntry[];
}

/** Helper functions for PrayerRequest */
export const PrayerRequestHelpers = {
  getDisplayTitle(request: PrayerRequest): string {
    if (request.title && request.title.length > 0) return request.title;
    const requestEntry = request.entries.find((e) => e.kind === EntryKind.Request);
    if (requestEntry?.content) {
      const content = requestEntry.content;
      return content.length > 50 ? content.substring(0, 50) + '...' : content;
    }
    return 'Prayer Request';
  },

  getAuthorDisplayName(request: PrayerRequest): string {
    if (request.isAnonymous) return 'Anonymous';
    if (request.author) return UserHelpers.getDisplayNameOrFallback(request.author);
    return 'Unknown';
  },

  getAuthorProfileImageUrl(request: PrayerRequest): string | undefined {
    if (request.isAnonymous) return undefined;
    return request.author?.profileImageUrl;
  },
};

// MARK: - Prayer Entry

export interface PrayerEntry {
  id: string;
  shortId: string;
  requestId: string;
  authorId?: string;
  kind: EntryKind;
  content?: string;
  amenCount: number;
  isHidden: boolean;
  createdAt: Date;
  updatedAt: Date;
  author?: User;
  attachments: Attachment[];
  responses: PrayerResponse[];
}

// MARK: - Attachment

export interface Attachment {
  id: string;
  type: AttachmentType | string;
  url: string;
  width?: number;
  height?: number;
  durationS?: number;
  muxPlaybackId?: string;
  uploadStatus?: string;
}

// MARK: - Prayer Response (Reaction)

export interface PrayerResponse {
  id: string;
  type: ResponseType | string;
  payload?: string;
  createdAt: Date;
  user: {
    id: string;
    displayName?: string;
    firstName?: string;
  };
}

// MARK: - Activity Item

export interface ActivityItem {
  id: string;
  title: string;
  subtitle: string;
  date: Date;
  type: ActivityType;
  requestId?: string;
  groupId?: string;
}

/** Helper functions for ActivityItem */
export const ActivityItemHelpers = {
  getIconName(item: ActivityItem): string {
    switch (item.type) {
      case ActivityType.PrayerReceived:
        return 'hands-clapping';
      case ActivityType.UpdateReceived:
        return 'refresh-cw';
      case ActivityType.NewRequest:
        return 'plus-circle';
      case ActivityType.TestimonyShared:
        return 'star';
      case ActivityType.EncouragementReceived:
        return 'heart';
      default:
        return 'bell';
    }
  },
};

// MARK: - Feed Item (Simplified UI representation)

export interface FeedItem {
  id: string;
  postId?: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  isAnonymous: boolean;
  title?: string;
  content: string;
  createdAt: Date;
  prayerCount: number;
  prayerListCount: number;
  encouragementCount: number;
  isFollowing: boolean;
  hasPrayed: boolean;
  isInPrayerList: boolean;
  hasEncouraged: boolean;
  updateStatus?: 'answered' | 'update';
  groupName?: string;
  groupId?: string;
  sharedToCommunity: boolean;
}

// MARK: - Saved Prayer Item

export interface SavedPrayerItem {
  id: string;
  userId: string;
  requestId: string;
  entryId?: string;
  createdAt: Date;
  request?: PrayerRequest;
}
