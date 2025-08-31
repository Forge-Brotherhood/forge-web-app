"use client";

import { useEffect, useState, useCallback } from "react";

export interface CommunityFeedThread {
  id: string;
  title: string;
  body: string;
  tags: string[];
  status: "open" | "answered" | "expired" | "removed";
  isAnonymous: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  answeredAt?: string;
  author: {
    id: string;
    displayName: string | null;
    handle: string | null;
    avatarUrl: string | null;
  } | null;
  _count: {
    prayers: number;
    encouragements: number;
    updates: number;
  };
}

interface UseCommunityFeedResult {
  threads: CommunityFeedThread[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
}

export function useCommunityFeed(
  status: "open" | "answered" | "expired" = "open",
  initialLimit: number = 20
): UseCommunityFeedResult {
  const [threads, setThreads] = useState<CommunityFeedThread[]>([]);
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
      const url = new URL("/api/threads", window.location.origin);
      url.searchParams.set("status", status);
      url.searchParams.set("limit", limit.toString());
      url.searchParams.set("offset", currentOffset.toString());

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        throw new Error(`Failed to fetch threads: ${response.status}`);
      }

      const data = await response.json();
      
      if (reset) {
        setThreads(data);
        setOffset(data.length);
      } else {
        setThreads(prev => [...prev, ...data]);
        setOffset(prev => prev + data.length);
      }

      // If we got fewer items than requested, we've reached the end
      setHasMore(data.length === limit);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch threads";
      setError(errorMessage);
      console.error("Error fetching community feed:", err);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [status, limit, offset]);

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
  }, [status]); // Only refetch when status changes

  return {
    threads,
    isLoading,
    error,
    refetch,
    hasMore,
    loadMore,
    isLoadingMore,
  };
}