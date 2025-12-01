"use client";

import { useEffect, useRef, useCallback } from "react";

interface UseInfiniteScrollOptions {
  /**
   * Distance from bottom (in pixels) to trigger loading
   * @default 200
   */
  threshold?: number;
  /**
   * Whether infinite scroll is enabled
   * @default true
   */
  enabled?: boolean;
  /**
   * Debounce delay in milliseconds
   * @default 100
   */
  debounceMs?: number;
}

/**
 * Hook for implementing infinite scroll using Intersection Observer
 * 
 * @param loadMore - Function to call when more content should be loaded
 * @param hasMore - Whether there is more content available to load
 * @param isLoading - Whether content is currently being loaded
 * @param options - Configuration options
 * @returns Ref to attach to the sentinel element at the bottom of the list
 */
export function useInfiniteScroll(
  loadMore: () => void,
  hasMore: boolean,
  isLoading: boolean,
  options: UseInfiniteScrollOptions = {}
) {
  const {
    threshold = 200,
    enabled = true,
    debounceMs = 100
  } = options;

  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const debouncedLoadMore = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      if (hasMore && !isLoading && enabled) {
        loadMore();
      }
    }, debounceMs);
  }, [loadMore, hasMore, isLoading, enabled, debounceMs]);

  const handleIntersect = useCallback((entries: IntersectionObserverEntry[]) => {
    const [entry] = entries;
    if (entry?.isIntersecting) {
      debouncedLoadMore();
    }
  }, [debouncedLoadMore]);

  useEffect(() => {
    // Use a timeout to ensure the DOM element is available
    const setupObserver = () => {
      const sentinel = sentinelRef.current;
      
      if (!enabled || !sentinel || !hasMore) {
        return;
      }

      // Create intersection observer
      observerRef.current = new IntersectionObserver(handleIntersect, {
        root: null,
        rootMargin: `${threshold}px`,
        threshold: 0.1
      });

      observerRef.current.observe(sentinel);
    };

    // Small delay to ensure DOM is ready
    const timer = setTimeout(setupObserver, 10);

    return () => {
      clearTimeout(timer);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [enabled, hasMore, threshold, handleIntersect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return sentinelRef;
}