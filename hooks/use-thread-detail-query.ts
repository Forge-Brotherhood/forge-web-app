"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { communityKeys } from "./use-community-feed-query";

// Thread detail interface
export interface ThreadDetail {
  id: string;
  title: string | null;
  status: "open" | "answered" | "archived";
  isAnonymous: boolean;
  sharedToCommunity: boolean;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  } | null;
  group: {
    id: string;
    name: string | null;
    groupType: "core" | "circle";
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
      muxAssetId: string | null;
      muxPlaybackId: string | null;
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

interface CreatePostParams {
  threadId: string;
  content?: string;
  kind: "request" | "update" | "testimony" | "encouragement" | "verse" | "system";
  mediaIds?: string[];
}

interface CreateReactionParams {
  postId: string;
  type: "amen" | "emoji" | "verse_ref";
  payload?: string;
}

// Query keys
export const threadDetailKeys = {
  all: ['thread-detail'] as const,
  detail: (id: string) => [...threadDetailKeys.all, id] as const,
} as const;

// Fetch thread detail
const fetchThreadDetail = async (id: string): Promise<ThreadDetail> => {
  const response = await fetch(`/api/threads/${id}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch thread: ${response.status}`);
  }
  
  return response.json();
};

// Hook for thread detail
export function useThreadDetail(id: string) {
  return useQuery({
    queryKey: threadDetailKeys.detail(id),
    queryFn: () => fetchThreadDetail(id),
    staleTime: 30 * 1000, // Consider fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    retry: 2,
  });
}

// Hook for creating posts
export function useCreatePostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, ...postData }: CreatePostParams) => {
      const response = await fetch(`/api/threads/${threadId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postData),
      });

      if (!response.ok) {
        throw new Error(`Failed to create post: ${response.status}`);
      }

      return response.json();
    },

    onSuccess: (data, variables) => {
      // Invalidate and refetch the thread detail
      queryClient.invalidateQueries({ 
        queryKey: threadDetailKeys.detail(variables.threadId) 
      });
      
      // Mark community feed data as stale so it refetches in background
      queryClient.invalidateQueries({ 
        queryKey: communityKeys.all,
        refetchType: 'none' // Don't refetch immediately, just mark as stale
      });
      
      // Let the next access to community feed trigger a background refetch
      // This way cached data shows immediately while fresh data loads
    },
  });
}

// Hook for creating reactions
export function useCreateReactionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ postId, type, payload }: CreateReactionParams) => {
      const response = await fetch(`/api/threads/[id]/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, type, payload }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create reaction: ${response.status}`);
      }

      return response.json();
    },

    onSuccess: (data, variables) => {
      // Find the thread that contains this post and invalidate its cache
      // Since we don't know the thread ID from the post ID, we'll invalidate all thread details
      queryClient.invalidateQueries({ 
        queryKey: threadDetailKeys.all 
      });
      
      // Also invalidate community feed since reactions affect thread data
      queryClient.invalidateQueries({ 
        queryKey: communityKeys.all
      });
    },
  });
}