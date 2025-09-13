"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

export type FeedItem = {
  id: string;
  postId?: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  isAnonymous: boolean;
  title?: string | null;
  content: string;
  createdAt: Date;
  prayerCount: number;
  prayerListCount: number;
  encouragementCount: number;
  isFollowing: boolean;
  hasPrayed: boolean;
  isInPrayerList: boolean;
  hasEncouraged: boolean;
  updateStatus?: "answered" | "update" | null;
  groupName?: string | null;
  groupId?: string | null;
  sharedToCommunity?: boolean;
};

export type UseFeedResult = {
  items: FeedItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
};

type FetchPage<Raw> = (args: { limit: number; offset: number }) => Promise<{ items: Raw[]; hasMore: boolean }>;
type MapItem<Raw> = (raw: Raw) => FeedItem;

export function useFeedQuery<Raw>({
  key,
  limit = 20,
  enabled = true,
  fetchPage,
  mapItem,
  staleTime = 2 * 60 * 1000,
  gcTime = 10 * 60 * 1000,
}: {
  key: unknown[];
  limit?: number;
  enabled?: boolean;
  fetchPage: FetchPage<Raw>;
  mapItem: MapItem<Raw>;
  staleTime?: number;
  gcTime?: number;
}): UseFeedResult {
  // Internal scroll preservation
  // We import lazily to avoid circular deps if any
  const { useScrollPreservation } = require("./use-scroll-preservation");

  const {
    data,
    error,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
    isRefetching,
    isFetching,
  } = useInfiniteQuery({
    queryKey: key,
    queryFn: async ({ pageParam = 0 }) => fetchPage({ limit, offset: pageParam }),
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage?.hasMore) return undefined;
      const totalSoFar = allPages.reduce((sum, p) => sum + (p.items?.length || 0), 0);
      return totalSoFar;
    },
    enabled,
    initialPageParam: 0,
    staleTime,
    gcTime,
    placeholderData: prev => prev,
  });

  const rawItems = data?.pages.flatMap(p => p.items || []) ?? [];
  const items = rawItems.map(mapItem);

  // Hook scroll preservation to unified items
  try {
    const scroll = useScrollPreservation(items.map(i => ({ id: i.id })), isLoading);
    // Expose navigateWithScroll via returned refetch? For now, consumers can import hook directly if needed.
    // We only need the side-effects of preservation here.
  } catch {}

  return {
    items,
    isLoading: isLoading && !data,
    error: error ? (error as Error).message : null,
    refetch,
    hasMore: Boolean(hasNextPage),
    loadMore: fetchNextPage,
    isLoadingMore: isFetchingNextPage || isFetching || isRefetching,
  };
}


