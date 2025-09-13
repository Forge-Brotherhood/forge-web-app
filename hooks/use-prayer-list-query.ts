import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFeedQuery, type FeedItem, type UseFeedResult } from "./use-feed-query";

export interface PrayerListAuthor {
  id: string;
  displayName: string;
  firstName: string;
  profileImageUrl?: string;
}

export interface PrayerListGroup {
  id: string;
  name: string;
  groupType: string;
}

export interface PrayerListEntry {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
  author: PrayerListAuthor | null;
  attachments: any[];
}

export interface PrayerListThread {
  id: string;
  shortId?: string;
  title?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  isAnonymous: boolean;
  sharedToCommunity: boolean;
  author: PrayerListAuthor | null;
  group: PrayerListGroup | null;
  entries: PrayerListEntry[];
  _count: {
    actions: number;
    entries: number;
    savedBy: number;
  };
}

export interface PrayerListItem {
  id: string;
  userId: string;
  threadId: string; // requestId
  postId: string | null; // entryId
  createdAt: string;
  thread: PrayerListThread; // request
  post: { // entry
    id: string;
    kind: string;
    content: string;
  } | null;
}

export interface PrayerListResponse {
  success: boolean;
  items: PrayerListItem[];
  count: number;
}

export const prayerListKeys = {
  all: ["prayerList"] as const,
  list: () => [...prayerListKeys.all, "list"] as const,
  filtered: (filters: any) => [...prayerListKeys.list(), filters] as const,
};

export function usePrayerListQuery() {
  return useQuery<PrayerListResponse>({
    queryKey: prayerListKeys.list(),
    queryFn: async () => {
      const response = await fetch("/api/prayer-list");
      if (!response.ok) {
        throw new Error("Failed to fetch prayer list");
      }
      return response.json();
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useRemoveFromPrayerList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, postId }: { threadId: string; postId?: string }) => {
      const response = await fetch("/api/prayer-list", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, postId: postId || undefined }),
      });

      if (!response.ok) {
        throw new Error("Failed to remove from prayer list");
      }

      return response.json();
    },
    onMutate: async ({ threadId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: prayerListKeys.list() });

      // Snapshot previous value
      const previousList = queryClient.getQueryData<PrayerListResponse>(
        prayerListKeys.list()
      );

      // Optimistically remove from list
      if (previousList) {
        queryClient.setQueryData<PrayerListResponse>(prayerListKeys.list(), {
          ...previousList,
          items: previousList.items.filter(item => item.threadId !== threadId),
          count: previousList.count - 1,
        });
      }

      return { previousList };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousList) {
        queryClient.setQueryData(prayerListKeys.list(), context.previousList);
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: prayerListKeys.list() });
      queryClient.invalidateQueries({ queryKey: ["feed", "prayers"] });
    },
  });
}

// New: feed adapter for My Prayers using base feed hook
export function usePrayerFeed(limit: number = 20): UseFeedResult {
  return useFeedQuery<PrayerListItem>({
    key: ["feed", "prayers"],
    limit,
    fetchPage: async ({ limit, offset }) => {
      // Current API returns all; emulate pagination client-side
      const res = await fetch(`/api/prayer-list`);
      if (!res.ok) throw new Error("Failed to fetch prayer list");
      const json: PrayerListResponse = await res.json();
      const start = offset;
      const end = offset + limit;
      const slice = json.items.slice(start, end);
      return { items: slice as any, hasMore: end < json.items.length };
    },
    mapItem: (item): FeedItem => {
      const thread = item.thread;
      const firstEntry = thread.entries?.[0];
      const author = thread.isAnonymous ? null : thread.author;
      return {
        id: (thread.shortId || thread.id) as string,
        postId: item.post?.id || firstEntry?.id,
        userId: author?.id || "",
        userName: author?.displayName || author?.firstName || "Anonymous",
        userAvatar: author?.profileImageUrl || undefined,
        isAnonymous: thread.isAnonymous,
        title: thread.title,
        content: firstEntry?.content || "",
        createdAt: new Date(thread.createdAt),
        prayerCount: thread._count.actions || 0,
        prayerListCount: thread._count.savedBy || 0,
        encouragementCount: Math.max(0, (thread._count.entries || 1) - 1),
        isFollowing: false,
        hasPrayed: false,
        isInPrayerList: true,
        hasEncouraged: false,
        updateStatus: null,
        groupName: thread.group?.name || null,
        groupId: thread.group?.id || null,
        sharedToCommunity: thread.sharedToCommunity,
      };
    },
  });
}