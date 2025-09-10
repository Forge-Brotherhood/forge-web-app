"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

// Types (matching existing structure)
export interface GroupFeedThread {
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
      muxAssetId?: string | null;
      muxPlaybackId?: string | null;
    }>;
    reactions?: Array<{
      id: string;
      type: string;
      user: {
        id: string;
        displayName: string | null;
        firstName: string | null;
      };
    }>;
  }>;
  group?: {
    id: string;
    name: string | null;
    groupType: "core" | "circle";
  };
  isInPrayerList?: boolean;
  hasPrayed?: boolean;
  prayerListCount?: number;
  _count: {
    posts: number;
    prayers: number;
    prayerListItems?: number;
  };
}

interface GroupMember {
  id: string;
  userId: string;
  displayName: string | null;
  firstName: string | null;
  profileImageUrl: string | null;
  role: "member" | "leader";
  joinedAt: string;
  user: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    profileImageUrl: string | null;
  };
  prayerStreak?: number;
}

interface GroupInfo {
  id: string;
  name: string | null;
  groupType: "core" | "circle";
  description: string | null;
  memberCount: number;
}

interface GroupStats {
  memberCount: number;
  weeklyPrayers: number;
  activeToday: number;
  averageStreak: number;
  groupStreak: number;
  challengeProgress?: {
    name: string;
    current: number;
    target: number;
    endDate: string;
  };
}

interface GroupFeedResponse {
  threads: GroupFeedThread[];
  totalCount: number;
  hasMore: boolean;
}

interface GroupDataResponse {
  group: GroupInfo;
  stats: GroupStats;
  members: GroupMember[];
}

// Query key factory
export const groupKeys = {
  all: ['group'] as const,
  feeds: () => [...groupKeys.all, 'feed'] as const,
  feed: () => [...groupKeys.feeds()] as const,
  data: () => [...groupKeys.all, 'data'] as const,
  basic: () => [...groupKeys.all, 'basic'] as const,
  members: () => [...groupKeys.all, 'members'] as const,
  stats: () => [...groupKeys.all, 'stats'] as const,
} as const;

// Fetch functions for split endpoints
const fetchGroupBasic = async (): Promise<GroupInfo | null> => {
  const response = await fetch("/api/groups/basic?type=core");
  if (!response.ok) {
    throw new Error(`Failed to fetch basic group data: ${response.status}`);
  }

  const groups = await response.json();
  
  if (!groups?.length) {
    return null; // Return null instead of throwing error
  }

  const group = groups[0];
  return {
    id: group.id,
    name: group.name,
    groupType: group.groupType,
    description: group.description,
    memberCount: 0, // Will be filled by stats
  };
};

const fetchGroupMembers = async (): Promise<GroupMember[]> => {
  const response = await fetch("/api/groups/members?type=core");
  if (!response.ok) {
    throw new Error(`Failed to fetch group members: ${response.status}`);
  }

  const groupsWithMembers = await response.json();
  
  if (!groupsWithMembers?.length) {
    return [];
  }

  return groupsWithMembers[0]?.members || [];
};

const fetchGroupStats = async (): Promise<GroupStats> => {
  const response = await fetch("/api/groups/stats?type=core");
  if (!response.ok) {
    throw new Error(`Failed to fetch group stats: ${response.status}`);
  }

  const groupsWithStats = await response.json();
  
  if (!groupsWithStats?.length) {
    return {
      memberCount: 0,
      weeklyPrayers: 0,
      activeToday: 0,
      averageStreak: 0,
      groupStreak: 0,
    };
  }

  return groupsWithStats[0]?.stats || {
    memberCount: 0,
    weeklyPrayers: 0,
    activeToday: 0,
    averageStreak: 0,
    groupStreak: 0,
  };
};

const fetchGroupFeed = async ({
  limit,
  offset,
}: {
  limit: number;
  offset: number;
}): Promise<GroupFeedResponse> => {
  const response = await fetch(
    `/api/threads?source=core&limit=${limit}&offset=${offset}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch group feed: ${response.status}`);
  }

  return response.json();
};

// New separate hooks for split data
export function useGroupBasic() {
  return useQuery({
    queryKey: groupKeys.basic(),
    queryFn: fetchGroupBasic,
    staleTime: 5 * 60 * 1000, // Consider fresh for 5 minutes
    gcTime: 15 * 60 * 1000, // Cache for 15 minutes
    retry: 2, // Reduced retries for faster failure
  });
}

export function useGroupMembers(enabled: boolean = true) {
  return useQuery({
    queryKey: groupKeys.members(),
    queryFn: fetchGroupMembers,
    enabled,
    staleTime: 2 * 60 * 1000, // Consider fresh for 2 minutes
    gcTime: 10 * 60 * 1000, // Cache for 10 minutes
    retry: 3,
  });
}

export function useGroupStats() {
  return useQuery({
    queryKey: groupKeys.stats(),
    queryFn: fetchGroupStats,
    staleTime: 60 * 1000, // Consider fresh for 1 minute (more dynamic data)
    gcTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 3,
  });
}

export function useGroupFeed(limit: number = 20, enabled: boolean = true) {
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
    queryKey: groupKeys.feed(),
    queryFn: ({ pageParam = 0 }) =>
      fetchGroupFeed({
        limit,
        offset: pageParam,
      }),
    enabled,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      const totalItems = allPages.reduce((sum, page) => sum + page.threads.length, 0);
      return totalItems;
    },
    initialPageParam: 0,
    staleTime: 2 * 60 * 1000, // Consider fresh for 2 minutes (increased)
    gcTime: 10 * 60 * 1000, // Cache for 10 minutes
    // Return cached data immediately while fetching fresh data in background
    placeholderData: (previousData) => previousData,
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

// Combined hook for backward compatibility with existing component
export function useGroupFeedWithData(limit: number = 20) {
  const basicQuery = useGroupBasic();
  const membersQuery = useGroupMembers();
  const statsQuery = useGroupStats();
  const feedQuery = useGroupFeed(limit);

  // Combine basic group info with member count from stats
  const group = basicQuery.data ? {
    ...basicQuery.data,
    memberCount: statsQuery.data?.memberCount || 0,
  } : null;

  return {
    // Group data
    group,
    stats: statsQuery.data || null,
    members: membersQuery.data || [],
    
    // Feed data
    threads: feedQuery.threads,
    hasMore: feedQuery.hasMore,
    loadMore: feedQuery.loadMore,
    isLoadingMore: feedQuery.isLoadingMore,
    
    // Combined loading and error states
    isLoading: basicQuery.isLoading || feedQuery.isLoading,
    error: basicQuery.error || membersQuery.error || statsQuery.error || feedQuery.error,
    refetch: async () => {
      await Promise.all([
        basicQuery.refetch(),
        membersQuery.refetch(),
        statsQuery.refetch(),
        feedQuery.refetch(),
      ]);
    },
  };
}