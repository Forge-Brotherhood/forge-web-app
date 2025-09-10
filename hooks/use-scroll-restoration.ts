"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

// Store scroll positions for different paths
const scrollPositions = new Map<string, number>();

export function useScrollRestoration(enabled: boolean = true) {
  const pathname = usePathname();
  const isRestoringRef = useRef(false);
  const hasRestoredRef = useRef(false);

  // Save scroll position before navigation
  const saveScrollPosition = useCallback(() => {
    if (!enabled) return;
    
    // Save the current scroll position for this path
    const scrollY = window.scrollY;
    scrollPositions.set(pathname, scrollY);
    
    // Also save to sessionStorage for persistence across page reloads
    try {
      sessionStorage.setItem(`scroll-${pathname}`, scrollY.toString());
    } catch (e) {
      // Ignore sessionStorage errors
    }
  }, [pathname, enabled]);

  // Restore scroll position
  const restoreScrollPosition = useCallback(() => {
    if (!enabled || hasRestoredRef.current) return;
    
    // Try to get position from memory first, then sessionStorage
    let savedPosition = scrollPositions.get(pathname);
    
    if (savedPosition === undefined) {
      try {
        const stored = sessionStorage.getItem(`scroll-${pathname}`);
        if (stored) {
          savedPosition = parseInt(stored, 10);
        }
      } catch (e) {
        // Ignore sessionStorage errors
      }
    }
    
    if (savedPosition !== undefined && savedPosition > 0) {
      isRestoringRef.current = true;
      hasRestoredRef.current = true;
      
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        window.scrollTo(0, savedPosition);
        
        // Double-check after a small delay (for dynamic content)
        setTimeout(() => {
          if (window.scrollY !== savedPosition) {
            window.scrollTo(0, savedPosition);
          }
          isRestoringRef.current = false;
        }, 100);
      });
    }
  }, [pathname, enabled]);

  // Save scroll position on navigation away
  useEffect(() => {
    const handleBeforeUnload = () => saveScrollPosition();
    const handleRouteChange = () => saveScrollPosition();
    
    // Save on various events that might indicate navigation
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleRouteChange);
    
    // Also save periodically while scrolling
    let scrollTimeout: NodeJS.Timeout;
    const handleScroll = () => {
      if (isRestoringRef.current) return;
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        saveScrollPosition();
      }, 200);
    };
    
    window.addEventListener("scroll", handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleRouteChange);
      window.removeEventListener("scroll", handleScroll);
      clearTimeout(scrollTimeout);
      
      // Save position when component unmounts (navigation)
      saveScrollPosition();
    };
  }, [saveScrollPosition]);

  // Reset restoration flag when pathname changes
  useEffect(() => {
    hasRestoredRef.current = false;
  }, [pathname]);

  return {
    restoreScrollPosition,
    saveScrollPosition,
    isRestoring: isRestoringRef.current,
  };
}