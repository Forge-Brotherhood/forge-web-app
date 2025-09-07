"use client";

import { useEffect, useState, useCallback } from "react";

export interface CommunityFeedThread {
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
  };
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

interface CommunityStats {
  totalRequests: number;
  totalTestimonies: number;
  totalPrayers: number;
  activeUsers: number;
  [key: string]: number | string | undefined;
}

interface CommunityFeedResponse {
  threads: CommunityFeedThread[];
  totalCount: number;
  hasMore: boolean;
  stats: CommunityStats;
}

interface UseCommunityFeedResult {
  threads: CommunityFeedThread[];
  stats: CommunityStats | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
}

export function useCommunityFeed(
  filter: "all" | "testimonies" | "requests" = "all",
  initialLimit: number = 20
): UseCommunityFeedResult {
  const [threads, setThreads] = useState<CommunityFeedThread[]>([]);
  const [stats, setStats] = useState<CommunityStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [limit] = useState(initialLimit);

  const fetchThreads = useCallback(async (reset: boolean = false) => {
    try {
      if (reset) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const currentOffset = reset ? 0 : offset;
      const url = new URL("/api/community", window.location.origin);
      url.searchParams.set("filter", filter);
      url.searchParams.set("limit", limit.toString());
      url.searchParams.set("offset", currentOffset.toString());

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        throw new Error(`Failed to fetch community feed: ${response.status}`);
      }

      const data: CommunityFeedResponse = await response.json();
      
      if (reset) {
        setThreads(data.threads);
        setOffset(data.threads.length);
        setStats(data.stats);
      } else {
        setThreads(prev => [...prev, ...data.threads]);
        setOffset(prev => prev + data.threads.length);
      }

      setHasMore(data.hasMore);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch community feed";
      setError(errorMessage);
      console.error("Error fetching community feed:", err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [filter, limit, offset]);

  const refetch = useCallback(() => {
    setOffset(0);
    fetchThreads(true);
  }, [fetchThreads]);

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchThreads(false);
    }
  }, [fetchThreads, isLoadingMore, hasMore]);

  useEffect(() => {
    fetchThreads(true);
  }, [filter]); // Only refetch when filter changes

  return {
    threads,
    stats,
    isLoading,
    error,
    refetch,
    hasMore,
    loadMore,
    isLoadingMore,
  };
}