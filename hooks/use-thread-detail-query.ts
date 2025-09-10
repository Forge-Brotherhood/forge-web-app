"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";

// Types
interface User {
  id: string;
  displayName: string | null;
  firstName: string | null;
  profileImageUrl: string | null;
}

interface Media {
  id: string;
  type: "image" | "video" | "audio";
  url: string;
  width: number | null;
  height: number | null;
  durationS: number | null;
  muxPlaybackId?: string | null;
  uploadStatus?: string;
}

interface Reaction {
  id: string;
  type: "amen" | "emoji" | "verse_ref";
  payload: string | null;
  createdAt: string;
  user: {
    id: string;
    displayName: string | null;
    firstName: string | null;
  };
}

interface Post {
  id: string;
  kind: "request" | "update" | "testimony" | "encouragement" | "verse" | "system";
  content: string | null;
  createdAt: string;
  updatedAt: string;
  author: User | null;
  media: Media[];
  reactions: Reaction[];
  _count: {
    prayerActions: number;
  };
}

interface Group {
  id: string;
  name: string | null;
  groupType: "core" | "circle";
}

export interface ThreadDetail {
  id: string;
  title: string | null;
  sharedToCommunity: boolean;
  isAnonymous: boolean;
  status: "open" | "answered" | "archived";
  createdAt: string;
  updatedAt: string;
  author: User | null;
  group: Group | null;
  posts: Post[];
  prayers: Array<{
    userId: string;
    createdAt: string;
    user: {
      id: string;
      displayName: string | null;
      firstName: string | null;
    };
  }>;
  _count: {
    posts: number;
    prayers: number;
  };
}

interface ThreadDetailResponse {
  thread: ThreadDetail;
  currentUser: User | null;
  initialPrayerStatus: {
    hasPrayed: boolean;
    prayerCount: number;
    isInPrayerList: boolean;
    prayerListCount: number;
  };
}

// Query key factory
export const threadKeys = {
  all: ['threads'] as const,
  detail: (threadId: string) => [...threadKeys.all, threadId] as const,
  posts: (threadId: string) => [...threadKeys.detail(threadId), 'posts'] as const,
  prayers: (threadId: string) => [...threadKeys.detail(threadId), 'prayers'] as const,
} as const;

// Fetch function for thread detail
const fetchThreadDetail = async (threadId: string): Promise<ThreadDetailResponse> => {
  const response = await fetch(`/api/threads/${threadId}`);
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Thread not found');
    }
    throw new Error(`Failed to fetch thread: ${response.status}`);
  }

  return response.json();
};

// Hook for thread detail
export function useThreadDetail(threadId: string | undefined) {
  const { isSignedIn } = useAuth();
  
  return useQuery({
    queryKey: threadKeys.detail(threadId!),
    queryFn: () => fetchThreadDetail(threadId!),
    enabled: !!threadId,
    staleTime: 30 * 1000, // Consider fresh for 30 seconds
    gcTime: 10 * 60 * 1000, // Cache for 10 minutes
    retry: (failureCount, error) => {
      // Don't retry 404s
      if (error.message.includes('not found')) return false;
      return failureCount < 3;
    },
  });
}

// Hook for prefetching thread detail (used from feed cards)
export function usePrefetchThreadDetail() {
  const queryClient = useQueryClient();
  
  return (threadId: string) => {
    queryClient.prefetchQuery({
      queryKey: threadKeys.detail(threadId),
      queryFn: () => fetchThreadDetail(threadId),
      staleTime: 30 * 1000,
    });
  };
}

// Hook to get cached thread data without fetching
export function useCachedThreadDetail(threadId: string) {
  const queryClient = useQueryClient();
  
  return queryClient.getQueryData<ThreadDetailResponse>(
    threadKeys.detail(threadId)
  );
}