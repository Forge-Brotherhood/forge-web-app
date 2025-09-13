"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { threadKeys, type ThreadDetail } from "./use-thread-detail-query";
import { communityKeys } from "./use-community-feed-query";
import { groupKeys } from "./use-group-feed-query";
import { prayerListKeys } from "./use-prayer-list-query";
import { invalidateAllThreadCaches } from "@/utils/cache-invalidation";

interface AddPostData {
  threadId: string;
  content: string;
  kind: "update" | "testimony" | "encouragement" | "verse";
  media?: Array<{
    url: string;
    type: "image" | "video" | "audio";
    width?: number;
    height?: number;
    durationS?: number;
  }>;
}

interface AddPostResponse {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    displayName: string | null;
    firstName: string | null;
    profileImageUrl: string | null;
  } | null;
  attachments: Array<{
    id: string;
    type: "image" | "video" | "audio";
    url: string;
    width: number | null;
    height: number | null;
    durationS: number | null;
  }>;
  responses: Array<{
    id: string;
    type: string;
    payload: string | null;
    createdAt: string;
    user: {
      id: string;
      displayName: string | null;
      firstName: string | null;
    };
  }>;
  _count: {
    actions: number;
  };
}

interface PrayerToggleData {
  threadId: string;
  postId: string;
}

interface ReactionData {
  threadId: string;
  postId: string;
  type: "amen" | "emoji" | "verse_ref";
  payload?: string;
}

// Add post mutation
export function useAddPostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: AddPostData): Promise<AddPostResponse> => {
      console.log("Adding post with data:", data);
      
      const response = await fetch(`/api/threads/${data.threadId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: data.content,
          kind: data.kind,
          media: data.media,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to add post:", response.status, errorText);
        throw new Error(`Failed to add post: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log("Post creation result:", result);
      return result;
    },
    onMutate: async (data: AddPostData) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: threadKeys.detail(data.threadId),
      });

      // Snapshot previous value
      const previousThread = queryClient.getQueryData(
        threadKeys.detail(data.threadId)
      );

      // Optimistically update thread with new entry
      queryClient.setQueryData(
        threadKeys.detail(data.threadId),
        (old: any) => {
          if (!old?.thread) return old;

          const optimisticEntry = {
            id: `temp-${Date.now()}`,
            kind: data.kind,
            content: data.content,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            author: old.currentUser,
            attachments: data.media || [],
            responses: [],
            _count: { actions: 0 },
          };

          return {
            ...old,
            thread: {
              ...old.thread,
              entries: [...(old.thread.entries || []), optimisticEntry],
              _count: {
                ...old.thread._count,
                entries: (old.thread._count.entries || 0) + 1,
              },
            },
          };
        }
      );

      return { previousThread };
    },
    onError: (err, data, context) => {
      // Rollback on error
      if (context?.previousThread) {
        queryClient.setQueryData(
          threadKeys.detail(data.threadId),
          context.previousThread
        );
      }
    },
    onSuccess: (result, data) => {
      // Update with real entry data
      queryClient.setQueryData(
        threadKeys.detail(data.threadId),
        (old: any) => {
          if (!old?.thread) return old;

          // Replace temp entry with real entry
          const updatedEntries = (old.thread.entries || []).map((e: any) =>
            e.id.startsWith("temp-") ? result : e
          );

          return {
            ...old,
            thread: {
              ...old.thread,
              entries: updatedEntries,
            },
          };
        }
      );

      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: communityKeys.all });
      queryClient.invalidateQueries({ queryKey: ['group', 'feed'] });
    },
  });
}

// Prayer toggle mutation (optimistic)
export function usePrayerToggleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, postId }: PrayerToggleData) => {
      // Get current prayer status to determine action
      const threadData = queryClient.getQueryData(
        threadKeys.detail(threadId)
      ) as any;
      
      const hasPrayed = threadData?.initialPrayerStatus?.hasPrayed || false;
      const method = hasPrayed ? "DELETE" : "POST";

      const response = await fetch(`/api/threads/${threadId}/prayers`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      });

      if (!response.ok) {
        throw new Error("Failed to toggle prayer");
      }

      return { action: method, ...response.json() };
    },
    onMutate: async ({ threadId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: threadKeys.detail(threadId),
      });

      // Snapshot previous value
      const previousThread = queryClient.getQueryData(
        threadKeys.detail(threadId)
      );

      // Optimistically update prayer status
      queryClient.setQueryData(
        threadKeys.detail(threadId),
        (old: any) => {
          if (!old) return old;

          const currentHasPrayed = old.initialPrayerStatus?.hasPrayed || false;
          const currentCount = old.initialPrayerStatus?.prayerCount || 0;

          return {
            ...old,
            initialPrayerStatus: {
              hasPrayed: !currentHasPrayed,
              prayerCount: currentHasPrayed ? currentCount - 1 : currentCount + 1,
            },
          };
        }
      );

      return { previousThread };
    },
    onError: (err, { threadId }, context) => {
      // Rollback on error
      if (context?.previousThread) {
        queryClient.setQueryData(
          threadKeys.detail(threadId),
          context.previousThread
        );
      }
    },
    onSettled: (data, error, { threadId }) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({
        queryKey: threadKeys.detail(threadId),
      });
      
      // Also invalidate feed caches as prayer counts may have changed
      queryClient.invalidateQueries({ queryKey: communityKeys.all });
      queryClient.invalidateQueries({ queryKey: ['group', 'feed'] });
    },
  });
}

// Reaction mutation (optimistic)
export function useReactionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ReactionData) => {
      const response = await fetch(`/api/threads/${data.threadId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: data.postId,
          type: data.type,
          payload: data.payload,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to add reaction");
      }

      return response.json();
    },
    onMutate: async (data: ReactionData) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: threadKeys.detail(data.threadId),
      });

      // Snapshot previous value
      const previousThread = queryClient.getQueryData(
        threadKeys.detail(data.threadId)
      );

      // Optimistically add response
      queryClient.setQueryData(
        threadKeys.detail(data.threadId),
        (old: any) => {
          if (!old?.thread) return old;

          const optimisticResponse = {
            id: `temp-reaction-${Date.now()}`,
            type: data.type,
            payload: data.payload || null,
            createdAt: new Date().toISOString(),
            user: {
              id: old.currentUser?.id || "",
              displayName: old.currentUser?.displayName || null,
              firstName: old.currentUser?.firstName || null,
            },
          };

          const updatedEntries = (old.thread.entries || []).map((entry: any) =>
            entry.id === data.postId
              ? { ...entry, responses: [...(entry.responses || []), optimisticResponse] }
              : entry
          );

          return {
            ...old,
            thread: {
              ...old.thread,
              entries: updatedEntries,
            },
          };
        }
      );

      return { previousThread };
    },
    onError: (err, data, context) => {
      // Rollback on error
      if (context?.previousThread) {
        queryClient.setQueryData(
          threadKeys.detail(data.threadId),
          context.previousThread
        );
      }
    },
    onSuccess: (result, data) => {
      // Replace temp reaction with real reaction data
      queryClient.invalidateQueries({
        queryKey: threadKeys.detail(data.threadId),
      });
    },
  });
}

// Delete post mutation
export function useDeletePostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, postId }: { threadId: string; postId: string }) => {
      const response = await fetch(`/api/threads/${threadId}/posts?postId=${postId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete post: ${response.status} - ${errorText}`);
      }

      return response.json();
    },
    onMutate: async ({ threadId, postId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: threadKeys.detail(threadId),
      });

      // Snapshot previous value
      const previousThread = queryClient.getQueryData(
        threadKeys.detail(threadId)
      );

      // Optimistically remove entry from cache
      queryClient.setQueryData(
        threadKeys.detail(threadId),
        (old: any) => {
          if (!old?.thread) return old;

          const filteredEntries = (old.thread.entries || []).filter((e: any) => e.id !== postId);

          return {
            ...old,
            thread: {
              ...old.thread,
              entries: filteredEntries,
              _count: {
                ...old.thread._count,
                entries: (old.thread._count.entries || 1) - 1,
              },
            },
          };
        }
      );

      return { previousThread };
    },
    onError: (err, { threadId }, context) => {
      // Rollback on error
      if (context?.previousThread) {
        queryClient.setQueryData(
          threadKeys.detail(threadId),
          context.previousThread
        );
      }
    },
    onSuccess: (data, { threadId }) => {
      // Invalidate related queries to ensure consistency
      queryClient.invalidateQueries({ queryKey: threadKeys.detail(threadId) });
      queryClient.invalidateQueries({ queryKey: communityKeys.all });
      queryClient.invalidateQueries({ queryKey: ['group', 'feed'] });
      queryClient.invalidateQueries({ queryKey: prayerListKeys.all });
    },
  });
}

// Delete thread mutation
export function useDeleteThreadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }) => {
      const response = await fetch(`/api/threads/${threadId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete thread");
      }

      return response.json();
    },
    onSuccess: (data, { threadId }) => {
      // Remove thread from cache
      queryClient.removeQueries({
        queryKey: threadKeys.detail(threadId),
      });

      // Invalidate feed caches
      queryClient.invalidateQueries({ queryKey: communityKeys.all });
      queryClient.invalidateQueries({ queryKey: ['group', 'feed'] });
      queryClient.invalidateQueries({ queryKey: prayerListKeys.all });
    },
  });
}

// Create thread mutation
interface CreateThreadData {
  content: string;
  title?: string;
  isAnonymous?: boolean;
  sharedToCommunity?: boolean;
  groupId?: string | null;
  postKind?: "request" | "update" | "testimony";
  mediaIds?: string[];
  mediaUrls?: Array<{
    url: string;
    type: "image" | "video" | "audio";
    width?: number;
    height?: number;
    durationS?: number;
    muxAssetId?: string;
    muxPlaybackId?: string;
    uploadStatus?: string;
    uploadId?: string;
    filename?: string;
  }>;
}

interface CreateThreadResponse {
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
  } | null;
  posts: Array<any>;
  _count: {
    posts: number;
    prayers: number;
  };
}

// Prayer list toggle mutation
export function usePrayerListToggleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, postId }: { threadId: string; postId?: string }) => {
      if (!threadId) {
        throw new Error(`Invalid parameters: threadId=${threadId}`);
      }

      const response = await fetch(`/api/prayer-list/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postId ? { threadId, entryId: postId } : { threadId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(`Failed to toggle prayer list: ${response.status} ${response.statusText} - ${errorData.error || "Unknown error"}`);
      }

      return response.json() as Promise<{ success: boolean; isSaved: boolean; action: "added" | "removed"; savedCount: number }>;
    },
    onSuccess: (_result, { threadId }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: communityKeys.all });
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      queryClient.invalidateQueries({ queryKey: threadKeys.detail(threadId) });
      queryClient.invalidateQueries({ queryKey: prayerListKeys.all });
      // Ensure My Prayers feed refreshes
      queryClient.invalidateQueries({ queryKey: prayerListKeys.list() });
      queryClient.invalidateQueries({ queryKey: ["feed", "prayers"] });
    },
    onError: (err) => {
      console.error("Prayer list toggle error:", err);
    },
  });
}

export function useCreateThreadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateThreadData): Promise<CreateThreadResponse> => {
      const requestData = {
        content: data.content,
        title: data.title,
        isAnonymous: data.isAnonymous || false,
        sharedToCommunity: data.sharedToCommunity ?? true,
        groupId: data.groupId,
        postKind: data.postKind || "request",
        mediaIds: data.mediaIds?.length ? data.mediaIds : undefined,
        mediaUrls: data.mediaUrls?.length ? data.mediaUrls : undefined,
      };

      const response = await fetch("/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create thread: ${response.status} - ${errorText}`);
      }

      return response.json();
    },
    onSuccess: (result) => {
      // Invalidate all thread-related caches to ensure feeds update
      invalidateAllThreadCaches(queryClient);
      
      // Don't pre-populate the cache - let the thread detail page fetch fresh data
      // This ensures currentUser and other data is correctly populated by the API
    },
    onError: (error) => {
      console.error("Error creating thread:", error);
    },
  });
}