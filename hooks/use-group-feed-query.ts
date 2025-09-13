"use client";

import { useFeedQuery, type FeedItem, type UseFeedResult } from "./use-feed-query";

export const groupKeys = {
  all: ['group'] as const,
  feeds: () => [...groupKeys.all, 'feed'] as const,
  feed: () => [...groupKeys.feeds()] as const,
} as const;

type GroupThread = {
  id: string;
  shortId?: string;
  title?: string | null;
  sharedToCommunity: boolean;
  isAnonymous: boolean;
  status: "open" | "answered" | "archived";
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    profileImageUrl: string | null;
  } | null;
  group?: {
    id: string;
    name: string | null;
    groupType: "core" | "circle";
  } | null;
  entries: Array<{
    id: string;
    kind: "request" | "update" | "testimony" | "encouragement" | "verse" | "system";
    content: string | null;
    createdAt: string;
    author: {
      id: string;
      displayName: string | null;
      firstName: string | null;
      profileImageUrl: string | null;
    } | null;
  }>;
  _count: {
    entries: number;
    actions: number;
    savedBy?: number;
  };
  savedBy?: Array<{ id: string }>;
  isInPrayerList?: boolean;
  prayerListCount?: number;
};

type GroupFeedResponse = {
  threads: GroupThread[];
  hasMore: boolean;
};

export function useGroupFeed(limit: number = 20, enabled: boolean = true): UseFeedResult {
  return useFeedQuery<GroupThread>({
    key: groupKeys.feed() as unknown as unknown[],
    limit,
    enabled,
    fetchPage: async ({ limit, offset }) => {
      const res = await fetch(`/api/threads?source=core&limit=${limit}&offset=${offset}`);
      if (!res.ok) throw new Error(`Failed to fetch group feed: ${res.status}`);
      const json: GroupFeedResponse = await res.json();
      return { items: json.threads ?? [], hasMore: Boolean(json.hasMore) };
    },
    mapItem: (thread): FeedItem => {
      const id = thread.shortId || thread.id;
      const main = thread.entries?.find(e => e.kind === "request" || e.kind === "testimony") || thread.entries?.[0];
      const primaryAuthor = thread.isAnonymous ? null : (thread.author || main?.author);
      const userId = primaryAuthor?.id || "";
      const userName = thread.isAnonymous
        ? "Anonymous"
        : ((primaryAuthor?.displayName || primaryAuthor?.firstName || "Unknown") as string);
      const userAvatar = thread.isAnonymous ? undefined : (primaryAuthor?.profileImageUrl || undefined);

      return {
        id,
        postId: main?.id,
        userId,
        userName,
        userAvatar,
        isAnonymous: thread.isAnonymous,
        title: thread.title,
        content: main?.content || "",
        createdAt: new Date(main?.createdAt || thread.createdAt),
        prayerCount: thread._count?.actions || 0,
        prayerListCount: thread._count?.savedBy || thread.prayerListCount || 0,
        encouragementCount: Math.max(0, (thread._count?.entries || 1) - 1),
        isFollowing: false,
        hasPrayed: false,
        isInPrayerList: Boolean(thread.savedBy?.length || thread.isInPrayerList),
        hasEncouraged: false,
        updateStatus: thread.status === "answered" || main?.kind === "testimony" ? "answered" : null,
        groupName: thread.group?.name || null,
        groupId: thread.group?.id || null,
        sharedToCommunity: thread.sharedToCommunity,
      };
    },
  });
}

// Page-level auxiliary hooks
import { useQuery } from "@tanstack/react-query";

export function useGroupBasic() {
  return useQuery({
    queryKey: [...groupKeys.all, 'basic'],
    queryFn: async () => {
      const res = await fetch("/api/groups/basic?type=core");
      if (!res.ok) throw new Error(`Failed to fetch basic group data: ${res.status}`);
      const groups = await res.json();
      return groups?.[0] || null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

export function useGroupMembers(enabled: boolean = true) {
  return useQuery({
    queryKey: [...groupKeys.all, 'members'],
    queryFn: async () => {
      const res = await fetch("/api/groups/members?type=core");
      if (!res.ok) throw new Error(`Failed to fetch group members: ${res.status}`);
      const groups = await res.json();
      return groups?.[0]?.members || [];
    },
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useGroupStats() {
  return useQuery({
    queryKey: [...groupKeys.all, 'stats'],
    queryFn: async () => {
      const res = await fetch("/api/groups/stats?type=core");
      if (!res.ok) throw new Error(`Failed to fetch group stats: ${res.status}`);
      const groups = await res.json();
      return groups?.[0]?.stats || { memberCount: 0, weeklyPrayers: 0, activeToday: 0, averageStreak: 0, groupStreak: 0 };
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}