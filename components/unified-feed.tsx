"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { 
  BookOpen, 
  AlertCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { usePrayerListToggleMutation } from "@/hooks/use-thread-mutations";
import { FeedCard } from "@/components/feed-card";
import { type UseFeedResult, type FeedItem } from "@/hooks/use-feed-query";
import { cn } from "@/lib/utils";

// Props for the unified feed
interface UnifiedFeedProps {
  feed: UseFeedResult;
}

export function UnifiedFeed({ feed }: UnifiedFeedProps) {
  const router = useRouter();
  const { items, isLoading, hasMore, loadMore, isLoadingMore, error: feedError, refetch } = feed;
  const [localItems, setLocalItems] = useState<FeedItem[]>([]);
  
  // Infinite scroll
  const sentinelRef = useInfiniteScroll(loadMore, hasMore, isLoadingMore, { enabled: true, threshold: 200 });
  
  // Sync threads with local state for optimistic updates
  useEffect(() => {
    setLocalItems(items as FeedItem[]);
  }, [items]);

  const prayerToggle = usePrayerListToggleMutation();

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

  const renderThread = (thread: FeedItem) => {
    const urlId = thread.id;
    const feedCardData = thread as any;

    return (
      <div key={urlId} data-thread-id={urlId}>
        <FeedCard
          className={cn(
            "border-b border-border",
            localItems[localItems.length - 1]?.id === urlId && "border-b-0"
          )}
          prayer={feedCardData}
          onPrayerListToggle={() => handlePrayerListToggle(urlId as any)}
          onCardClick={handleThreadNavigation}
        />
      </div>
    );
  };

  return (
    <div>
      {/* Feed Content */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : feedError ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <AlertCircle className="w-12 h-12 text-muted-foreground" />
            <div className="text-center">
              <p className="text-foreground font-medium">Failed to load feed</p>
              <p className="text-muted-foreground text-sm mt-1">{feedError}</p>
              <Button 
                onClick={refetch as any} 
                variant="outline" 
                className="mt-3"
              >
                Try Again
              </Button>
            </div>
          </div>
        ) : localItems.length > 0 ? (
          localItems.map(renderThread)
        ) : (
          <div className="text-center py-12">
            <div className="mb-4">
              <BookOpen className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            </div>
            <p className="text-muted-foreground text-lg mb-2">
              No posts found
            </p>
            <p className="text-muted-foreground text-sm">
              Posts will appear here when available
            </p>
          </div>
        )}
      </div>

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