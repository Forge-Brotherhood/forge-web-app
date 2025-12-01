"use client";

/**
 * Thread Detail Hook
 * Fetches and manages detailed prayer thread data with forgeApi.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { forgeApi } from "@core/api/forgeApiClient";
import type { ThreadDetailResponse } from "@core/models/apiModels";
import { config } from "@core/services/configService";
import { ForgeAPIError, ForgeAPIErrorCode } from "@core/api/apiErrors";

// MARK: - Query Keys

export const threadKeys = {
  all: ['threads'] as const,
  detail: (threadId: string) => [...threadKeys.all, threadId] as const,
  posts: (threadId: string) => [...threadKeys.detail(threadId), 'posts'] as const,
  prayers: (threadId: string) => [...threadKeys.detail(threadId), 'prayers'] as const,
} as const;

// MARK: - Types (re-export from apiModels)

export type { ThreadDetailResponse };

// MARK: - Hook

export function useThreadDetail(threadId: string | undefined) {
  return useQuery({
    queryKey: threadKeys.detail(threadId!),
    queryFn: () => forgeApi.getThread(threadId!),
    enabled: !!threadId,
    staleTime: 30 * 1000, // Fresh for 30 seconds
    gcTime: config.cacheGcTime,
    retry: (failureCount, error) => {
      // Don't retry 404s
      if (error instanceof ForgeAPIError && error.code === ForgeAPIErrorCode.NotFound) {
        return false;
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

// MARK: - Prefetch Hook

export function usePrefetchThreadDetail() {
  const queryClient = useQueryClient();

  return (threadId: string) => {
    queryClient.prefetchQuery({
      queryKey: threadKeys.detail(threadId),
      queryFn: () => forgeApi.getThread(threadId),
      staleTime: 30 * 1000,
    });
  };
}

// MARK: - Cached Data Hook

export function useCachedThreadDetail(threadId: string) {
  const queryClient = useQueryClient();

  return queryClient.getQueryData<ThreadDetailResponse>(
    threadKeys.detail(threadId)
  );
}
