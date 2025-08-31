"use client";

import React, { useState, useCallback, useEffect } from "react";
import { CommunityThreadCard } from "@/components/community-thread-card";
import { Button } from "@/components/ui/button";
import { useCommunityFeed, type CommunityFeedThread } from "@/hooks/use-community-feed";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useProfile } from "@/hooks/use-profile";


export default function CommunityFeed() {
  const { threads, isLoading, error, refetch, hasMore, loadMore, isLoadingMore } = useCommunityFeed("open", 20);
  const [localThreads, setLocalThreads] = useState<CommunityFeedThread[]>([]);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const { isSignedIn } = useAuth();
  const { profile } = useProfile();

  // Sync threads with local state for optimistic updates
  useEffect(() => {
    setLocalThreads(threads);
  }, [threads]);

  const handleThreadUpdate = useCallback((threadId: string, updates: Partial<CommunityFeedThread>) => {
    setLocalThreads(prev => 
      prev.map(thread => 
        thread.id === threadId ? { ...thread, ...updates } : thread
      )
    );
  }, []);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    if (!isSignedIn || !profile) return;

    setIsDeletingId(threadId);
    try {
      const response = await fetch(`/api/threads/${threadId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete thread");
      }

      // Remove thread from local state
      setLocalThreads(prev => prev.filter(thread => thread.id !== threadId));
    } catch (error) {
      console.error("Error deleting thread:", error);
    } finally {
      setIsDeletingId(null);
    }
  }, [isSignedIn, profile]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-foreground mb-2">Community</h1>
        </div>

        {/* Prayer Feed */}
        <div className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <AlertCircle className="w-12 h-12 text-muted-foreground" />
              <div className="text-center">
                <p className="text-foreground font-medium">Failed to load prayers</p>
                <p className="text-muted-foreground text-sm mt-1">{error}</p>
                <Button 
                  onClick={refetch} 
                  variant="outline" 
                  className="mt-3"
                >
                  Try Again
                </Button>
              </div>
            </div>
          ) : localThreads.length > 0 ? (
            localThreads.map((thread) => (
              <CommunityThreadCard
                key={thread.id}
                thread={thread}
                onUpdate={handleThreadUpdate}
                currentUserId={profile?.id}
                isSignedIn={isSignedIn}
                onDelete={handleDeleteThread}
                isDeletingId={isDeletingId || undefined}
              />
            ))
          ) : (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No prayers found</p>
            </div>
          )}
        </div>

        {/* Load More */}
        {hasMore && localThreads.length > 0 && (
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
                "Load more prayers"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
