"use client";

/**
 * Community Feed Hook
 * Provides infinite scrolling community feed with forgeApi.
 */

import { useFeedQuery, type UseFeedResult } from "@core/hooks/useFeedQuery";
import { forgeApi } from "@core/api/forgeApiClient";
import { communityThreadToFeedItem } from "@core/models/modelExtensions";
import type { APICommunityThread } from "@core/models/apiModels";
import type { CommunityFilter } from "@core/models/communityModels";
import { config } from "@core/services/configService";

// MARK: - Query Keys

export const communityKeys = {
  all: ['community'] as const,
  feeds: () => [...communityKeys.all, 'feed'] as const,
  feed: (filter: CommunityFilter) => [...communityKeys.feeds(), { filter }] as const,
} as const;

// MARK: - Hook

export function useCommunityFeed(
  filter: CommunityFilter = "all",
  limit: number = config.defaultPageSize
): UseFeedResult {
  return useFeedQuery<APICommunityThread>({
    key: communityKeys.feed(filter) as unknown as unknown[],
    limit,
    fetchPage: async ({ limit, offset }) => {
      const response = await forgeApi.getCommunityFeed({
        filter,
        limit,
        offset,
      });
      return {
        items: response.threads ?? [],
        hasMore: Boolean(response.hasMore),
      };
    },
    mapItem: (thread) => communityThreadToFeedItem(thread),
  });
}
