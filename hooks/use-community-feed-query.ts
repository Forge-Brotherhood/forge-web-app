"use client";

import { useFeedQuery, type FeedItem, type UseFeedResult } from "./use-feed-query";

export interface CommunityThread {
  id: string;
  shortId?: string;
  title: string | null;
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
  group: {
    id: string;
    name: string | null;
    groupType: "core" | "circle";
  };
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
    attachments: Array<{
      id: string;
      type: "image" | "video" | "audio";
      url: string;
      width: number | null;
      height: number | null;
      durationS: number | null;
    }>;
    responses: Array<{
      id: string;
      type: "amen" | "emoji" | "verse_ref";
      payload: string | null;
      createdAt: string;
      user: {
        id: string;
        displayName: string | null;
        firstName: string | null;
      };
    }>;
  }>;
  _count: {
    entries: number;
    actions: number;
    savedBy?: number;
  };
}

interface CommunityFeedResponse {
  threads: CommunityThread[];
  totalCount: number;
  hasMore: boolean;
}

// Query key factory
export const communityKeys = {
  all: ['community'] as const,
  feeds: () => [...communityKeys.all, 'feed'] as const,
  feed: (filter: string) => [...communityKeys.feeds(), { filter }] as const,
} as const;

// Fetch function for community feed with pagination
const fetchCommunityFeed = async ({
  filter,
  limit,
  offset,
}: {
  filter: string;
  limit: number;
  offset: number;
}): Promise<CommunityFeedResponse> => {
  const url = new URL("/api/community", window.location.origin);
  url.searchParams.set("filter", filter);
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("offset", offset.toString());

  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`Failed to fetch community feed: ${response.status}`);
  }

  return response.json();
};

// Infinite query hook for community feed
export function useCommunityFeed(
  filter: "all" | "testimonies" | "requests" = "all",
  limit: number = 20
): UseFeedResult {
  return useFeedQuery<CommunityThread>({
    key: communityKeys.feed(filter) as unknown as unknown[],
    limit,
    fetchPage: async ({ limit, offset }) => {
      const json = await fetchCommunityFeed({ filter, limit, offset });
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
        prayerListCount: thread._count?.savedBy || 0,
        encouragementCount: Math.max(0, (thread._count?.entries || 1) - 1),
        isFollowing: false,
        hasPrayed: false,
        isInPrayerList: Boolean((thread as any).savedBy?.length || (thread as any).isInPrayerList),
        hasEncouraged: false,
        updateStatus: thread.status === "answered" || main?.kind === "testimony" ? "answered" : null,
        groupName: (thread as any).group?.name || null,
        groupId: (thread as any).group?.id || null,
        sharedToCommunity: thread.sharedToCommunity,
      };
    },
  });
}

