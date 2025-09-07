"use client";

import React, { useState, useCallback } from "react";
import { UnifiedFeed } from "@/components/unified-feed";
import { useCommunityFeed, type CommunityFeedThread } from "@/hooks/use-community-feed-query";
import { usePrayerMutation } from "@/hooks/use-prayer-mutations";
import { useDeleteThreadMutation } from "@/hooks/use-thread-mutations";
import { Trophy, BookmarkPlus, Users } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useProfile } from "@/hooks/use-profile";

type FilterType = "all" | "testimonies" | "requests";

export default function CommunityPage() {
  const [filter, setFilter] = useState<FilterType>("all");
  const { threads, isLoading, error, refetch, hasMore, loadMore, isLoadingMore } = useCommunityFeed(filter, 20);
  const { isSignedIn } = useAuth();
  const { profile } = useProfile();
  const prayerMutation = usePrayerMutation();
  const deleteThreadMutation = useDeleteThreadMutation();

  const handlePray = useCallback(async (threadId: string) => {
    if (!isSignedIn || prayerMutation.isPending) return;
    
    try {
      const thread = threads.find(t => t.id === threadId);
      const mainPost = thread?.posts.find(p => p.kind === "request") || thread?.posts[0];
      if (!mainPost) return;

      // TanStack Query handles optimistic updates and cache invalidation
      await prayerMutation.mutateAsync({
        threadId,
        postId: mainPost.id,
        action: 'add', // For now, assume we're always adding prayers from the community page
      });
    } catch (error) {
      console.error("Error praying:", error);
    }
  }, [threads, isSignedIn, prayerMutation]);

  const handleDelete = useCallback(async (threadId: string) => {
    if (!isSignedIn || !profile || deleteThreadMutation.isPending) return;

    try {
      // TanStack Query handles optimistic updates and cache invalidation
      await deleteThreadMutation.mutateAsync({ threadId });
    } catch (error) {
      console.error("Error deleting thread:", error);
    }
  }, [isSignedIn, profile, deleteThreadMutation]);

  // Stats config removed - no longer displaying stats in community feed

  const filters = [
    { key: "all", label: "All" },
    { key: "requests", label: "Prayer Requests" },
    { key: "testimonies", label: "Testimonies", icon: Trophy }
  ];

  const emptyStateConfig = {
    icon: filter === "testimonies" ? Trophy : filter === "requests" ? BookmarkPlus : Users,
    title: filter === "testimonies" 
      ? "No testimonies shared yet" 
      : filter === "requests" 
        ? "No prayer requests found"
        : "No community posts found",
    description: filter === "testimonies" 
      ? "Answered prayers and testimonies will appear here" 
      : "Prayer requests shared to the community will appear here"
  };

  return (
    <UnifiedFeed
      threads={threads}
      isLoading={isLoading}
      error={error}
      feedType="community"
      title="Community"
      description="Join brothers in prayer and celebrate God's faithfulness together"
      showFilters={true}
      filters={filters}
      activeFilter={filter}
      onFilterChange={(newFilter) => setFilter(newFilter as FilterType)}
      onPray={handlePray}
      onDelete={handleDelete}
      onRefetch={refetch}
      hasMore={hasMore}
      loadMore={loadMore}
      isLoadingMore={isLoadingMore}
      enableInfiniteScroll={true}
      infiniteScrollThreshold={300}
      currentUserId={profile?.id}
      isSignedIn={isSignedIn}
      emptyStateConfig={emptyStateConfig}
    />
  );
}