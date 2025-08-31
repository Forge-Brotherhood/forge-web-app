"use client";

import { useState, useEffect, useCallback } from "react";
import { FeedCard, type PrayerRequest } from "./feed-card";
import { type CommunityFeedThread } from "@/hooks/use-community-feed";
import { useThreadActions } from "@/hooks/use-thread-actions";

interface CommunityThreadCardProps {
  thread: CommunityFeedThread;
  onUpdate?: (threadId: string, updates: Partial<CommunityFeedThread>) => void;
  currentUserId?: string;
  isSignedIn?: boolean;
  onDelete?: (id: string) => void;
  isDeletingId?: string;
}

export const CommunityThreadCard = ({ 
  thread, 
  onUpdate, 
  currentUserId,
  isSignedIn = false,
  onDelete,
  isDeletingId 
}: CommunityThreadCardProps) => {
  const { addPrayer, addToCart, removeFromCart, actionLoading } = useThreadActions();
  const [mounted, setMounted] = useState(false);
  
  // Local state to track user interactions
  const [hasPrayed, setHasPrayed] = useState(false);
  const [hasEncouraged, setHasEncouraged] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  
  const loadUserPrayerStatus = useCallback(async () => {
    if (!isSignedIn || !currentUserId) return;
    
    setIsLoadingStatus(true);
    try {
      const response = await fetch(`/api/threads/${thread.id}/prayers`);
      if (response.ok) {
        const data = await response.json();
        setHasPrayed(data.hasPrayed);
        
        // Update the thread data with actual prayer count if different
        if (data.prayerCount !== thread._count.prayers) {
          onUpdate?.(thread.id, {
            ...thread,
            _count: {
              ...thread._count,
              prayers: data.prayerCount
            }
          });
        }
      }
    } catch (error) {
      console.error("Failed to load prayer status:", error);
    } finally {
      setIsLoadingStatus(false);
    }
  }, [isSignedIn, currentUserId, thread, onUpdate]);
  
  useEffect(() => {
    setMounted(true);
    
    // Load user's prayer status from API if signed in
    if (isSignedIn && currentUserId) {
      loadUserPrayerStatus();
    }
  }, [thread.id, isSignedIn, currentUserId, loadUserPrayerStatus]);

  // Convert database thread to FeedCard format
  const prayerRequest: PrayerRequest = {
    id: thread.id,
    userId: thread.author?.id || "anonymous",
    userName: thread.author?.displayName || thread.author?.handle || "Anonymous",
    userAvatar: thread.author?.avatarUrl || undefined,
    isAnonymous: thread.isAnonymous,
    title: thread.title,
    content: thread.body,
    createdAt: new Date(thread.createdAt),
    prayerCount: thread._count.prayers,
    encouragementCount: thread._count.encouragements,
    isFollowing,
    hasPrayed,
    hasEncouraged,
    updateStatus: thread.status === "answered" ? "answered" : null,
    scriptureReference: undefined, // Not in current schema
    voiceNoteUrl: undefined, // Not in current schema  
    streakDays: undefined, // Not in current schema
  };

  const handlePray = async (id: string) => {
    if (!isSignedIn || isLoadingStatus) return;
    
    const isCurrentlyPrayed = hasPrayed;
    
    // Optimistic update
    setHasPrayed(!isCurrentlyPrayed);
    const newCount = thread._count.prayers + (isCurrentlyPrayed ? -1 : 1);
    onUpdate?.(id, {
      ...thread,
      _count: {
        ...thread._count,
        prayers: newCount
      }
    });

    try {
      const method = isCurrentlyPrayed ? "DELETE" : "POST";
      const response = await fetch(`/api/threads/${id}/prayers`, {
        method
      });
      
      if (!response.ok) {
        throw new Error("Failed to update prayer");
      }
      
      const result = await response.json();
      // Update with actual count from server
      setHasPrayed(result.hasPrayed);
      onUpdate?.(id, {
        ...thread,
        _count: {
          ...thread._count,
          prayers: result.prayerCount
        }
      });
    } catch (error) {
      // Revert optimistic update on error
      setHasPrayed(isCurrentlyPrayed);
      onUpdate?.(id, thread);
      console.error("Failed to update prayer:", error);
    }
  };

  const handleEncourage = async (id: string) => {
    if (!isSignedIn) return;
    
    // For now, this triggers the encouragement form in thread detail
    // The actual encouragement logic is handled in the thread detail page
    // This is just a placeholder that navigates to the thread
    window.location.href = `/threads/${id}`;
  };

  const handleFollow = async (id: string) => {
    const isCurrentlyFollowing = isFollowing;
    
    // Optimistic update
    setIsFollowing(!isCurrentlyFollowing);

    try {
      if (isCurrentlyFollowing) {
        await removeFromCart(id);
      } else {
        await addToCart(id);
      }
    } catch (error) {
      // Revert optimistic update on error
      setIsFollowing(isCurrentlyFollowing);
      console.error("Failed to update follow status:", error);
    }
  };

  if (!mounted) {
    return null;
  }

  return (
    <FeedCard
      prayer={prayerRequest}
      onPray={handlePray}
      onEncourage={handleEncourage}
      onFollow={handleFollow}
      showGroupFeatures={false}
      currentUserId={currentUserId}
      isSignedIn={isSignedIn}
      onDelete={onDelete}
      isDeletingId={isDeletingId}
    />
  );
};