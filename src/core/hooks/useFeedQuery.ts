"use client";

/**
 * Base Feed Query Hook
 * Provides infinite scrolling for feed-based data.
 * Used by community feed, group feed, prayer list, etc.
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import type { FeedItem } from "@core/models/models";
import { config } from "@core/services/configService";

// MARK: - Types

export type { FeedItem };

export interface UseFeedResult {
  items: FeedItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
}

export type FetchPage<Raw> = (args: { limit: number; offset: number }) => Promise<{ items: Raw[]; hasMore: boolean }>;
export type MapItem<Raw> = (raw: Raw) => FeedItem;

// MARK: - Hook

export function useFeedQuery<Raw>({
  key,
  limit = config.defaultPageSize,
  enabled = true,
  fetchPage,
  mapItem,
  staleTime = config.cacheStaleTime,
  gcTime = config.cacheGcTime,
}: {
  key: unknown[];
  limit?: number;
  enabled?: boolean;
  fetchPage: FetchPage<Raw>;
  mapItem: MapItem<Raw>;
  staleTime?: number;
  gcTime?: number;
}): UseFeedResult {
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
    placeholderData: (prev) => prev,
  });

  const rawItems = data?.pages.flatMap((p) => p.items || []) ?? [];
  const items = rawItems.map(mapItem);

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
