"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { communityKeys, CommunityFeedThread } from "./use-community-feed-query";

interface PrayerActionResponse {
  success: boolean;
  prayerCount: number;
  hasPrayed: boolean;
}

interface PrayerMutationParams {
  threadId: string;
  postId: string;
  action: 'add' | 'remove';
}

// Mutation function for prayer actions
const mutatePrayerAction = async ({
  threadId,
  postId,
  action,
}: PrayerMutationParams): Promise<PrayerActionResponse> => {
  const method = action === 'add' ? 'POST' : 'DELETE';
  
  const response = await fetch(`/api/threads/${threadId}/prayers`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to ${action} prayer: ${response.status}`);
  }

  return response.json();
};

export function usePrayerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: mutatePrayerAction,
    
    // Optimistic update
    onMutate: async ({ threadId, action }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: communityKeys.feeds() });

      // Snapshot the previous value
      const previousData = queryClient.getQueriesData({ queryKey: communityKeys.feeds() });

      // Optimistically update the cache
      queryClient.setQueriesData(
        { queryKey: communityKeys.feeds() },
        (old: any) => {
          if (!old?.pages) return old;

          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              threads: page.threads.map((thread: CommunityFeedThread) =>
                thread.id === threadId
                  ? {
                      ...thread,
                      _count: {
                        ...thread._count,
                        prayers: thread._count.prayers + (action === 'add' ? 1 : -1),
                      },
                    }
                  : thread
              ),
            })),
          };
        }
      );

      return { previousData };
    },

    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (err, variables, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      console.error('Prayer mutation failed:', err);
    },

    // Always refetch after error or success to ensure server state
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: communityKeys.feeds() });
    },
  });
}

// Hook for checking prayer status
export function usePrayerStatus(threadId: string, postId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/threads/${threadId}/prayers`);
      if (!response.ok) {
        throw new Error(`Failed to fetch prayer status: ${response.status}`);
      }
      return response.json();
    },
    
    onSuccess: (data) => {
      // Update the thread in cache with accurate prayer count
      queryClient.setQueriesData(
        { queryKey: communityKeys.feeds() },
        (old: any) => {
          if (!old?.pages) return old;

          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              threads: page.threads.map((thread: CommunityFeedThread) =>
                thread.id === threadId
                  ? {
                      ...thread,
                      _count: {
                        ...thread._count,
                        prayers: data.prayerCount,
                      },
                    }
                  : thread
              ),
            })),
          };
        }
      );
    },
  });
}