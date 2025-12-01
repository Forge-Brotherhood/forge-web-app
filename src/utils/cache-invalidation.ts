import { QueryClient } from "@tanstack/react-query";

// Import query key factories from new feature hooks
import { threadKeys, communityKeys } from "@features/prayer/hooks";
import { groupKeys } from "@features/groups/hooks";

/**
 * Invalidates all caches related to a thread after an interaction
 * This ensures that thread detail pages, feed pages, and other views
 * stay in sync when prayer lists, reactions, encouragements, or other
 * thread interactions are modified.
 * 
 * @param queryClient - TanStack Query client
 * @param threadId - ID of the thread that was interacted with
 */
export function invalidateThreadCaches(queryClient: QueryClient, threadId: string) {
  // Thread detail page cache
  queryClient.invalidateQueries({ 
    queryKey: threadKeys.detail(threadId) 
  });
  
  // Community feed caches (all filters)
  queryClient.invalidateQueries({ 
    queryKey: communityKeys.feeds() 
  });
  
  // Group feed caches (all groups)
  queryClient.invalidateQueries({ 
    queryKey: groupKeys.feeds() 
  });
  
  // Prayer cart cache if it exists
  queryClient.invalidateQueries({ 
    queryKey: ['prayer-cart'] 
  });
  
  // General threads cache (if any components use this pattern)
  queryClient.invalidateQueries({ 
    queryKey: ['threads'] 
  });
  
  // User-specific caches that might be affected
  queryClient.invalidateQueries({ 
    queryKey: ['user', 'prayer-list'] 
  });
}

/**
 * Invalidates all thread-related caches without targeting a specific thread
 * Useful for bulk operations or when the specific thread ID isn't available
 */
export function invalidateAllThreadCaches(queryClient: QueryClient) {
  // Invalidate all thread-related queries
  queryClient.invalidateQueries({ 
    predicate: (query) => {
      const key = query.queryKey[0];
      return key === 'threads' || 
             key === 'community' || 
             key === 'group' || 
             key === 'prayer-cart' ||
             (Array.isArray(query.queryKey) && query.queryKey.includes('feed'));
    }
  });
}