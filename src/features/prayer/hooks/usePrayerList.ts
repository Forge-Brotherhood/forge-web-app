"use client";

/**
 * Prayer List Hook
 * Manages the user's saved prayer list with forgeApi.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFeedQuery, type UseFeedResult } from "@core/hooks/useFeedQuery";
import { forgeApi } from "@core/api/forgeApiClient";
import type { APIPrayerListResponse, APIPrayerListItem } from "@core/models/apiModels";
import type { FeedItem } from "@core/models/models";
import { config } from "@core/services/configService";

// MARK: - Query Keys

export const prayerListKeys = {
  all: ["prayerList"] as const,
  list: () => [...prayerListKeys.all, "list"] as const,
  filtered: (filters: Record<string, unknown>) => [...prayerListKeys.list(), filters] as const,
} as const;

// MARK: - Prayer List Query

export function usePrayerListQuery() {
  return useQuery<APIPrayerListResponse>({
    queryKey: prayerListKeys.list(),
    queryFn: () => forgeApi.getPrayerList(),
    staleTime: 30 * 1000, // 30 seconds
    gcTime: config.cacheGcTime,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

// MARK: - Remove From Prayer List Mutation

export function useRemoveFromPrayerList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, postId }: { threadId: string; postId?: string }) => {
      return forgeApi.togglePrayerList(threadId, postId);
    },
    onMutate: async ({ threadId }) => {
      await queryClient.cancelQueries({ queryKey: prayerListKeys.list() });

      const previousList = queryClient.getQueryData<APIPrayerListResponse>(
        prayerListKeys.list()
      );

      if (previousList) {
        queryClient.setQueryData<APIPrayerListResponse>(prayerListKeys.list(), {
          ...previousList,
          items: previousList.items.filter((item) => item.requestId !== threadId),
          count: previousList.count - 1,
        });
      }

      return { previousList };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(prayerListKeys.list(), context.previousList);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: prayerListKeys.list() });
      queryClient.invalidateQueries({ queryKey: ["feed", "prayers"] });
    },
  });
}

// MARK: - Prayer Feed (Infinite Scroll)

export function usePrayerFeed(limit: number = config.defaultPageSize): UseFeedResult {
  return useFeedQuery<APIPrayerListItem>({
    key: ["feed", "prayers"],
    limit,
    fetchPage: async ({ limit, offset }) => {
      // Current API returns all items; emulate pagination client-side
      const response = await forgeApi.getPrayerList();
      const items = response.items || [];
      const start = offset;
      const end = offset + limit;
      const slice = items.slice(start, end);
      return {
        items: slice,
        hasMore: end < items.length,
      };
    },
    mapItem: (item): FeedItem => {
      const thread = item.thread;
      const firstEntry = thread?.posts?.[0];
      const isAnonymous = thread?.isAnonymous ?? false;
      const author = isAnonymous ? null : thread?.author;

      return {
        id: (thread?.shortId || thread?.id || item.id) as string,
        postId: item.entryId || firstEntry?.id,
        userId: author?.id || "",
        userName: author?.displayName || author?.firstName || "Anonymous",
        userAvatar: author?.profileImageUrl,
        isAnonymous,
        title: thread?.title,
        content: firstEntry?.content || "",
        createdAt: new Date(thread?.createdAt || item.createdAt),
        prayerCount: thread?._count?.actions || 0,
        prayerListCount: thread?._count?.savedBy || 0,
        encouragementCount: Math.max(0, (thread?._count?.entries || 1) - 1),
        isFollowing: false,
        hasPrayed: false,
        isInPrayerList: true,
        hasEncouraged: false,
        updateStatus: undefined,
        sharedToCommunity: thread?.sharedToCommunity ?? false,
      };
    },
  });
}
