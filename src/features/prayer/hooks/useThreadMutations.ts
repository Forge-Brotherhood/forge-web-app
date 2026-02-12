"use client";

/**
 * Thread Mutations Hook
 * Handles all thread-related mutations with forgeApi.
 * Includes optimistic updates and cache invalidation.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { forgeApi } from "@core/api/forgeApiClient";
import type {
  AddPostRequest,
  AddPostResponse,
  CreateThreadRequest,
  CreateThreadResponse,
  AddReactionRequest,
  AddReactionResponse,
  ThreadDetailResponse,
  RecordPrayerResponse,
  RemovePrayerResponse,
  PrayerListToggleResponse,
  SuccessResponse,
} from "@core/models/apiModels";
import { threadKeys } from "./useThreadDetail";
import { communityKeys } from "./useCommunityFeed";

// MARK: - Types

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

interface CreateThreadData {
  content: string;
  title?: string;
  isAnonymous?: boolean;
  sharedToCommunity?: boolean;
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

// MARK: - Helper

function invalidateAllThreadCaches(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return (
        key === 'threads' ||
        key === 'community' ||
        key === 'prayer-cart' ||
        key === 'prayerList' ||
        (Array.isArray(query.queryKey) && query.queryKey.includes('feed'))
      );
    },
  });
}

// MARK: - Add Post Mutation

export function useAddPostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: AddPostData): Promise<AddPostResponse> => {
      return forgeApi.addPost(data.threadId, {
        content: data.content,
        kind: data.kind,
        media: data.media,
      });
    },
    onMutate: async (data: AddPostData) => {
      await queryClient.cancelQueries({
        queryKey: threadKeys.detail(data.threadId),
      });

      const previousThread = queryClient.getQueryData<ThreadDetailResponse>(
        threadKeys.detail(data.threadId)
      );

      queryClient.setQueryData<ThreadDetailResponse>(
        threadKeys.detail(data.threadId),
        (old) => {
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
              entries: [...(old.thread.entries || []), optimisticEntry as any],
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
    onError: (_err, data, context) => {
      if (context?.previousThread) {
        queryClient.setQueryData(
          threadKeys.detail(data.threadId),
          context.previousThread
        );
      }
    },
    onSuccess: (result, data) => {
      queryClient.setQueryData<ThreadDetailResponse>(
        threadKeys.detail(data.threadId),
        (old) => {
          if (!old?.thread) return old;

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

      queryClient.invalidateQueries({ queryKey: communityKeys.all });
    },
  });
}

// MARK: - Prayer Toggle Mutation

export function usePrayerToggleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, postId }: PrayerToggleData) => {
      const threadData = queryClient.getQueryData<ThreadDetailResponse>(
        threadKeys.detail(threadId)
      );

      const hasPrayed = threadData?.initialPrayerStatus?.hasPrayed || false;

      if (hasPrayed) {
        return forgeApi.removePrayer(threadId, postId);
      } else {
        return forgeApi.recordPrayer(threadId, postId);
      }
    },
    onMutate: async ({ threadId }) => {
      await queryClient.cancelQueries({
        queryKey: threadKeys.detail(threadId),
      });

      const previousThread = queryClient.getQueryData<ThreadDetailResponse>(
        threadKeys.detail(threadId)
      );

      queryClient.setQueryData<ThreadDetailResponse>(
        threadKeys.detail(threadId),
        (old) => {
          if (!old) return old;

          const currentHasPrayed = old.initialPrayerStatus?.hasPrayed || false;
          const currentCount = old.initialPrayerStatus?.prayerCount || 0;

          return {
            ...old,
            initialPrayerStatus: {
              ...old.initialPrayerStatus,
              hasPrayed: !currentHasPrayed,
              prayerCount: currentHasPrayed ? currentCount - 1 : currentCount + 1,
            },
          };
        }
      );

      return { previousThread };
    },
    onError: (_err, { threadId }, context) => {
      if (context?.previousThread) {
        queryClient.setQueryData(
          threadKeys.detail(threadId),
          context.previousThread
        );
      }
    },
    onSettled: (_data, _error, { threadId }) => {
      queryClient.invalidateQueries({
        queryKey: threadKeys.detail(threadId),
      });
      queryClient.invalidateQueries({ queryKey: communityKeys.all });
    },
  });
}

// MARK: - Reaction Mutation

export function useReactionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ReactionData): Promise<AddReactionResponse> => {
      return forgeApi.addReaction(data.threadId, {
        postId: data.postId,
        type: data.type,
        payload: data.payload,
      });
    },
    onMutate: async (data: ReactionData) => {
      await queryClient.cancelQueries({
        queryKey: threadKeys.detail(data.threadId),
      });

      const previousThread = queryClient.getQueryData<ThreadDetailResponse>(
        threadKeys.detail(data.threadId)
      );

      queryClient.setQueryData<ThreadDetailResponse>(
        threadKeys.detail(data.threadId),
        (old) => {
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
    onError: (_err, data, context) => {
      if (context?.previousThread) {
        queryClient.setQueryData(
          threadKeys.detail(data.threadId),
          context.previousThread
        );
      }
    },
    onSuccess: (_result, data) => {
      queryClient.invalidateQueries({
        queryKey: threadKeys.detail(data.threadId),
      });
    },
  });
}

// MARK: - Delete Post Mutation

export function useDeletePostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, postId }: { threadId: string; postId: string }): Promise<SuccessResponse> => {
      return forgeApi.deletePost(threadId, postId);
    },
    onMutate: async ({ threadId, postId }) => {
      await queryClient.cancelQueries({
        queryKey: threadKeys.detail(threadId),
      });

      const previousThread = queryClient.getQueryData<ThreadDetailResponse>(
        threadKeys.detail(threadId)
      );

      queryClient.setQueryData<ThreadDetailResponse>(
        threadKeys.detail(threadId),
        (old) => {
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
    onError: (_err, { threadId }, context) => {
      if (context?.previousThread) {
        queryClient.setQueryData(
          threadKeys.detail(threadId),
          context.previousThread
        );
      }
    },
    onSuccess: (_data, { threadId }) => {
      queryClient.invalidateQueries({ queryKey: threadKeys.detail(threadId) });
      queryClient.invalidateQueries({ queryKey: communityKeys.all });
    },
  });
}

// MARK: - Delete Thread Mutation

export function useDeleteThreadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }): Promise<SuccessResponse> => {
      return forgeApi.deleteThread(threadId);
    },
    onSuccess: (_data, { threadId }) => {
      queryClient.removeQueries({
        queryKey: threadKeys.detail(threadId),
      });

      queryClient.invalidateQueries({ queryKey: communityKeys.all });
    },
  });
}

// MARK: - Prayer List Toggle Mutation

export function usePrayerListToggleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ threadId, postId }: { threadId: string; postId?: string }): Promise<PrayerListToggleResponse> => {
      if (!threadId) {
        throw new Error(`Invalid parameters: threadId=${threadId}`);
      }

      return forgeApi.togglePrayerList(threadId, postId);
    },
    onSuccess: (_result, { threadId }) => {
      queryClient.invalidateQueries({ queryKey: communityKeys.all });
      queryClient.invalidateQueries({ queryKey: threadKeys.detail(threadId) });
      // Invalidate prayer list caches
      queryClient.invalidateQueries({ queryKey: ['prayerList'] });
      queryClient.invalidateQueries({ queryKey: ["feed", "prayers"] });
    },
    onError: (err) => {
      console.error("Prayer list toggle error:", err);
    },
  });
}

// MARK: - Create Thread Mutation

export function useCreateThreadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateThreadData): Promise<CreateThreadResponse> => {
      return forgeApi.createThread({
        content: data.content,
        title: data.title,
        isAnonymous: data.isAnonymous || false,
        sharedToCommunity: data.sharedToCommunity ?? true,
        postKind: data.postKind || "request",
        mediaIds: data.mediaIds?.length ? data.mediaIds : undefined,
        mediaUrls: data.mediaUrls?.length ? data.mediaUrls : undefined,
      });
    },
    onSuccess: () => {
      invalidateAllThreadCaches(queryClient);
    },
    onError: (error) => {
      console.error("Error creating thread:", error);
    },
  });
}
