"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  AlertCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { usePrayerListToggleMutation, useDeleteThreadMutation } from "@features/prayer";
import { useProfile } from "@/core/hooks/useProfile";
import { FeedCard, FeedCardSkeleton } from "@/components/feed-card";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { type UseFeedResult, type FeedItem } from "@core/hooks";
import { cn } from "@/lib/utils";

// Props for the unified feed
interface UnifiedFeedProps {
  feed: UseFeedResult;
}

export function UnifiedFeed({ feed }: UnifiedFeedProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { isSignedIn } = useAuth();
  const { profile } = useProfile();
  const { items, isLoading, hasMore, loadMore, isLoadingMore, error: feedError, refetch } = feed;
  const [localItems, setLocalItems] = useState<FeedItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Infinite scroll
  const sentinelRef = useInfiniteScroll(loadMore, hasMore, isLoadingMore, { enabled: true, threshold: 200 });

  // Sync threads with local state for optimistic updates
  useEffect(() => {
    setLocalItems(items as FeedItem[]);
  }, [items]);

  const prayerToggle = usePrayerListToggleMutation();
  const deleteThread = useDeleteThreadMutation();

  const handlePrayerListToggle = useCallback(async (threadId: string) => {
    // Optimistic UI
    let previous:
      | { idOrShort: string; wasSaved: boolean; prevCount: number }
      | null = null;
    setLocalItems(prev => prev.map((t: FeedItem) => {
      const idOrShort = t.id;
      if (idOrShort !== threadId) return t;
      const wasSaved = !!t.isInPrayerList;
      const nextSaved = !wasSaved;
      const prevCount = t.prayerListCount ?? 0;
      previous = { idOrShort, wasSaved, prevCount };
      return {
        ...t,
        isInPrayerList: nextSaved,
        prayerListCount: Math.max(0, prevCount + (nextSaved ? 1 : -1)),
      };
    }));

    // Call server toggle; choose entryId for main post
    const item = localItems.find((t: FeedItem) => t.id === threadId);
    try {
      const res = await prayerToggle.mutateAsync({ threadId, postId: item?.postId });
      // Reconcile with server truth
      setLocalItems(prev => prev.map((t: FeedItem) => {
        const idOrShort = t.id;
        if (idOrShort !== threadId) return t;
        return {
          ...t,
          isInPrayerList: res.isSaved,
          prayerListCount: typeof res.savedCount === 'number' ? res.savedCount : (t.prayerListCount ?? 0),
        };
      }));
    } catch (err) {
      // Revert on error
      if (previous) {
        setLocalItems(prev => prev.map((t: FeedItem) => {
          const idOrShort = t.id;
          if (idOrShort !== previous!.idOrShort) return t;
          return {
            ...t,
            isInPrayerList: previous!.wasSaved,
            prayerListCount: previous!.prevCount,
          };
        }));
      }
    }
  }, [localItems, prayerToggle]);

  const handleThreadNavigation = useCallback((threadId: string) => {
    router.push(`/threads/${threadId}`);
  }, [router]);

  const handleDelete = useCallback(async (threadId: string) => {
    setDeletingId(threadId);

    try {
      await deleteThread.mutateAsync({ threadId });

      // Remove from local state
      setLocalItems(prev => prev.filter(item => item.id !== threadId));

      toast({
        title: "Prayer request deleted",
        description: "Your prayer request has been removed.",
      });
    } catch (err) {
      toast({
        title: "Failed to delete",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }, [deleteThread, toast]);

  const renderThread = (thread: FeedItem) => {
    const urlId = thread.id;
    const feedCardData = thread as any;

    return (
      <FeedCard
        key={urlId}
        prayer={feedCardData}
        onPrayerListToggle={() => handlePrayerListToggle(urlId as any)}
        onCardClick={handleThreadNavigation}
        currentUserId={profile?.id}
        isSignedIn={!!isSignedIn}
        onDelete={handleDelete}
        isDeletingId={deletingId || undefined}
      />
    );
  };

  return (
    <div>
      {/* Feed Content */}
      {isLoading ? (
        <div className="space-y-3">
          <FeedCardSkeleton />
          <FeedCardSkeleton />
          <FeedCardSkeleton />
        </div>
      ) : feedError ? (
        <EmptyState
          icon={AlertCircle}
          title="Failed to Load"
          message={feedError}
          action={{ label: "Try Again", onClick: refetch as () => void }}
        />
      ) : localItems.length > 0 ? (
        <div className="space-y-3">
          {localItems.map(renderThread)}
        </div>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No Posts Found"
          message="Posts will appear here when available"
        />
      )}

      {/* Infinite Scroll Sentinel */}
      {hasMore && localItems.length > 0 && (
        <div ref={sentinelRef} className="h-10 flex items-center justify-center mt-4">
          {isLoadingMore && (
            <div className="flex items-center space-x-2 text-muted-foreground">
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Loading more...</span>
            </div>
          )}
        </div>
      )}
      
      {/* Manual Load More */}
      {hasMore && localItems.length > 0 && (
        <div className="mt-8 text-center">
          <Button 
            onClick={loadMore}
            disabled={isLoadingMore}
            variant="outline" 
            className="w-full sm:max-w-xs h-10 text-sm font-medium"
          >
            {isLoadingMore ? (
              <>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                Loading...
              </>
            ) : (
              `Load more posts`
            )}
          </Button>
        </div>
      )}
    </div>  
  );
}