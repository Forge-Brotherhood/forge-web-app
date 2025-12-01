"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

interface ScrollState {
  position: number;
  contentHeight: number;
  itemCount: number;
  timestamp: number;
}

// Global store for scroll states
const scrollStates = new Map<string, ScrollState>();

/**
 * Enhanced scroll preservation hook for infinite scroll feeds
 * Handles Next.js App Router navigation and dynamic content loading
 */
export function useScrollPreservation<T extends { id: string }>(
  items: T[],
  isLoading: boolean
) {
  const pathname = usePathname();
  const router = useRouter();
  const lastItemCountRef = useRef(0);
  const isRestoringRef = useRef(false);
  const hasRestoredRef = useRef(false);
  const scrollKeyRef = useRef(`scroll-${pathname}`);

  // Find the first item currently visible in viewport
  const findFirstVisibleItem = useCallback((itemsToSearch: T[]): string | null => {
    for (const item of itemsToSearch) {
      const element = document.querySelector(`[data-thread-id="${item.id}"]`);
      if (element) {
        const rect = element.getBoundingClientRect();
        if (rect.top >= 0 && rect.top <= window.innerHeight) {
          return item.id;
        }
      }
    }
    return null;
  }, []);

  // Save scroll state before navigation
  const saveScrollState = useCallback(() => {
    if (isRestoringRef.current || items.length === 0) {
      return;
    }

    const currentPosition = window.scrollY;
    const currentHeight = document.documentElement.scrollHeight;

    // Don't overwrite a good state with a bad one
    const existingState = scrollStates.get(scrollKeyRef.current);
    if (existingState && existingState.position > 0 && currentPosition === 0 && currentHeight < 1000) {
      return;
    }

    const state: ScrollState = {
      position: currentPosition,
      contentHeight: currentHeight,
      itemCount: items.length,
      timestamp: Date.now(),
    };


    scrollStates.set(scrollKeyRef.current, state);

    // Also persist to sessionStorage
    try {
      sessionStorage.setItem(scrollKeyRef.current, JSON.stringify(state));
      // Store the first visible item ID for more accurate restoration
      const firstVisibleItem = findFirstVisibleItem(items);
      if (firstVisibleItem) {
        sessionStorage.setItem(`${scrollKeyRef.current}-anchor`, firstVisibleItem);
      }
    } catch (e) {
      console.error("Failed to save scroll state:", e);
    }
  }, [items, findFirstVisibleItem]);

  // Restore scroll position with intelligent retry logic
  const restoreScrollState = useCallback(() => {
    if (hasRestoredRef.current || isRestoringRef.current || isLoading) {
      return;
    }

    // Try sessionStorage first (more reliable for back navigation)
    let savedState = null;
    try {
      const stored = sessionStorage.getItem(scrollKeyRef.current);
      if (stored) {
        savedState = JSON.parse(stored);
      }
    } catch (e) {
      console.error("Failed to retrieve scroll state:", e);
    }
    
    // Fallback to memory
    if (!savedState) {
      savedState = scrollStates.get(scrollKeyRef.current);
    }

    if (!savedState || savedState.position === 0) {
      return;
    }

    // Check if state is still fresh (less than 5 minutes old)
    const isStale = Date.now() - savedState.timestamp > 5 * 60 * 1000;
    if (isStale) {
      return;
    }

    isRestoringRef.current = true;
    hasRestoredRef.current = true;

    // Try anchor-based restoration first
    const anchorId = sessionStorage.getItem(`${scrollKeyRef.current}-anchor`);
    
    if (anchorId) {
      const anchorElement = document.querySelector(`[data-thread-id="${anchorId}"]`);
      if (anchorElement) {
        anchorElement.scrollIntoView({ behavior: "instant", block: "start" });
        isRestoringRef.current = false;
        return;
      }
    }

    // Fallback to position-based restoration
    const attemptRestore = (retries = 0) => {
      if (retries > 10) {
        isRestoringRef.current = false;
        return;
      }

      const currentHeight = document.documentElement.scrollHeight;
      const hasEnoughContent = items.length >= savedState.itemCount * 0.8; // 80% threshold
      
      if (hasEnoughContent || currentHeight >= savedState.contentHeight * 0.8) {
        // Content is loaded enough, restore position
        window.scrollTo({
          top: savedState.position,
          behavior: "instant"
        });
        
        // Verify restoration after a delay
        setTimeout(() => {
          const currentScroll = window.scrollY;
          if (Math.abs(currentScroll - savedState.position) > 100) {
            // Restoration failed, try again
            window.scrollTo({
              top: savedState.position,
              behavior: "instant"
            });
          }
          isRestoringRef.current = false;
        }, 100);
      } else {
        // Not enough content yet, retry
        setTimeout(() => attemptRestore(retries + 1), 50);
      }
    };

    // Start restoration with a small delay for initial render
    requestAnimationFrame(() => {
      attemptRestore();
    });
  }, [items.length, isLoading]);

  // Monitor scroll and save state
  useEffect(() => {
    let scrollTimeout: NodeJS.Timeout;
    let isNavigatingAway = false;
    
    const handleScroll = () => {
      // Don't save if restoring or navigating away
      if (isRestoringRef.current || isNavigatingAway) return;
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        // Only save if we have a meaningful scroll position
        if (window.scrollY > 0 || document.documentElement.scrollHeight > window.innerHeight) {
          saveScrollState();
        }
      }, 150);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    
    // Save state before navigation
    const handleBeforeUnload = () => {
      isNavigatingAway = true;
      saveScrollState();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    
    // Detect navigation away
    const handlePopState = () => {
      isNavigatingAway = true;
    };
    window.addEventListener("popstate", handlePopState);
    
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
      clearTimeout(scrollTimeout);
      // Don't save on unmount if we're at position 0
      if (window.scrollY > 0) {
        saveScrollState();
      }
    };
  }, [saveScrollState]);

  // Attempt restoration when items change
  useEffect(() => {
    if (items.length > 0 && items.length > lastItemCountRef.current && !hasRestoredRef.current) {
      restoreScrollState();
    }
    lastItemCountRef.current = items.length;
  }, [items.length, restoreScrollState]);

  // Reset restoration flag on pathname change
  useEffect(() => {
    hasRestoredRef.current = false;
    isRestoringRef.current = false;
    scrollKeyRef.current = `scroll-${pathname}`;
  }, [pathname]);

  // Navigate with scroll preservation
  const navigateWithScroll = useCallback((href: string) => {
    saveScrollState();
    router.push(href);
  }, [router, saveScrollState]);

  // Force restoration attempt
  const forceRestore = useCallback(() => {
    if (!isLoading && items.length > 0) {
      hasRestoredRef.current = false;
      restoreScrollState();
    }
  }, [isLoading, items.length, restoreScrollState]);

  // Check if we should be restoring (have saved state)
  const shouldRestore = useCallback(() => {
    try {
      const stored = sessionStorage.getItem(scrollKeyRef.current);
      if (stored) {
        const state = JSON.parse(stored);
        return state.position > 0;
      }
    } catch (e) {
      // Ignore
    }
    const memState = scrollStates.get(scrollKeyRef.current);
    return memState && memState.position > 0;
  }, []);

  return {
    navigateWithScroll,
    isRestoring: isRestoringRef.current,
    forceRestore,
    saveScrollState,
    shouldRestore,
  };
}