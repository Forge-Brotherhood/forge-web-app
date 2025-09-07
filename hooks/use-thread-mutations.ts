"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { communityKeys } from "./use-community-feed-query";

interface DeleteThreadParams {
  threadId: string;
}

// Mutation function for deleting threads
const deleteThread = async ({ threadId }: DeleteThreadParams): Promise<void> => {
  const response = await fetch(`/api/threads/${threadId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete thread: ${response.status}`);
  }
};

export function useDeleteThreadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteThread,
    
    // Optimistic update - remove thread from cache immediately
    onMutate: async ({ threadId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: communityKeys.feeds() });

      // Snapshot the previous value
      const previousData = queryClient.getQueriesData({ queryKey: communityKeys.feeds() });

      // Optimistically remove the thread from the cache
      queryClient.setQueriesData(
        { queryKey: communityKeys.feeds() },
        (old: any) => {
          if (!old?.pages) return old;

          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              threads: page.threads.filter((thread: any) => thread.id !== threadId),
            })),
          };
        }
      );

      return { previousData };
    },

    // If the mutation fails, restore the previous data
    onError: (err, variables, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      console.error('Delete thread mutation failed:', err);
    },

    // Always refetch after error or success
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: communityKeys.feeds() });
    },
  });
}