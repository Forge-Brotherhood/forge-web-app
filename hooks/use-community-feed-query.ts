"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

export interface CommunityFeedThread {
  id: string;
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
  posts: Array<{
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
    media: Array<{
      id: string;
      type: "image" | "video" | "audio";
      url: string;
      width: number | null;
      height: number | null;
      durationS: number | null;
    }>;
    reactions: Array<{
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
    posts: number;
    prayers: number;
  };
}

interface CommunityFeedResponse {
  threads: CommunityFeedThread[];
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
) {
  const {
    data,
    error,
    isLoading,
    isError,
    isFetching,
    isRefetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: communityKeys.feed(filter),
    queryFn: ({ pageParam = 0 }) =>
      fetchCommunityFeed({
        filter,
        limit,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      const totalItems = allPages.reduce((sum, page) => sum + page.threads.length, 0);
      return totalItems;
    },
    initialPageParam: 0,
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds (shorter for more frequent updates)
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: true, // Refetch when coming back to the page
    refetchOnMount: "always", // Always refetch when component mounts
    notifyOnChangeProps: ["data", "error"], // Only re-render when data or error changes
  });

  // Flatten all pages of threads
  const threads = data?.pages.flatMap((page) => page.threads) ?? [];

  return {
    threads,
    isLoading: isLoading && !data, // Only show loading if we have no cached data
    isFetching: isFetching || isRefetching, // Show fetching state for background updates
    error: isError ? (error as Error)?.message ?? 'Unknown error' : null,
    refetch,
    hasMore: hasNextPage,
    loadMore: fetchNextPage,
    isLoadingMore: isFetchingNextPage,
  };
}

