"use client";

/**
 * Group Feed Hook
 * Provides infinite scrolling for group prayer requests with forgeApi.
 */

import { useQuery } from "@tanstack/react-query";
import { useFeedQuery, type UseFeedResult } from "@core/hooks/useFeedQuery";
import { forgeApi } from "@core/api/forgeApiClient";
import { communityThreadToFeedItem } from "@core/models/modelExtensions";
import type { APICommunityThread } from "@core/models/apiModels";
import { config } from "@core/services/configService";

// MARK: - Query Keys

export const groupKeys = {
  all: ['group'] as const,
  feeds: () => [...groupKeys.all, 'feed'] as const,
  feed: (groupId?: string) => [...groupKeys.feeds(), { groupId }] as const,
  basic: () => [...groupKeys.all, 'basic'] as const,
  members: (groupId?: string) => [...groupKeys.all, 'members', { groupId }] as const,
  stats: (groupId?: string) => [...groupKeys.all, 'stats', { groupId }] as const,
} as const;

// MARK: - Group Feed Hook

export function useGroupFeed(
  limit: number = config.defaultPageSize,
  enabled: boolean = true,
  groupId?: string
): UseFeedResult {
  return useFeedQuery<APICommunityThread>({
    key: groupKeys.feed(groupId) as unknown as unknown[],
    limit,
    enabled,
    fetchPage: async ({ limit, offset }) => {
      const response = await forgeApi.getThreads({
        source: 'core',
        groupId,
        limit,
        offset,
      });
      return {
        items: (response.threads ?? []) as unknown as APICommunityThread[],
        hasMore: Boolean(response.hasMore),
      };
    },
    mapItem: (thread) => communityThreadToFeedItem(thread),
  });
}

// MARK: - Group Basic Info Hook

export function useGroupBasic() {
  return useQuery({
    queryKey: groupKeys.basic(),
    queryFn: async () => {
      const groups = await forgeApi.getGroups('core');
      return groups?.[0] ?? null;
    },
    staleTime: config.cacheStaleTime,
    gcTime: config.cacheGcTime,
  });
}

// MARK: - Group Members Hook

export function useGroupMembers(groupId?: string, enabled: boolean = true) {
  return useQuery({
    queryKey: groupKeys.members(groupId),
    queryFn: async () => {
      if (!groupId) return [];
      const group = await forgeApi.getGroup(groupId);
      return group?.members ?? [];
    },
    enabled: enabled && !!groupId,
    staleTime: 2 * 60 * 1000,
    gcTime: config.cacheGcTime,
  });
}

// MARK: - Group Stats Hook

export function useGroupStats(groupId?: string) {
  return useQuery({
    queryKey: groupKeys.stats(groupId),
    queryFn: async () => {
      // Stats are usually computed on the server side
      // For now, return default stats until API endpoint is available
      const groups = await forgeApi.getGroups('core');
      const group = groups?.[0];
      return {
        memberCount: group?.members?.length ?? 0,
        weeklyPrayers: 0,
        activeToday: 0,
        averageStreak: 0,
        groupStreak: 0,
      };
    },
    staleTime: 60 * 1000,
    gcTime: config.cacheGcTime,
  });
}
