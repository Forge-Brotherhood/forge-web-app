"use client";

import React, { useCallback } from "react";
import { UnifiedFeed } from "@/components/unified-feed";
import { useCommunityFeed, type CommunityFeedThread } from "@/hooks/use-community-feed-query";
import { useDeleteThreadMutation, usePrayerListToggleMutation } from "@/hooks/use-thread-mutations";
import { Trophy, BookmarkPlus, Users } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useProfile } from "@/hooks/use-profile-query";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useScrollPreservation } from "@/hooks/use-scroll-preservation";
import { usePrefetchThreadDetail } from "@/hooks/use-thread-detail-query";

type FilterType = "all" | "testimonies" | "requests";

export default function CommunityPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  // Get filter from URL or default to "all"
  const filter = (searchParams.get("filter") as FilterType) || "all";
  
  // Update URL when filter changes
  const setFilter = useCallback((newFilter: FilterType) => {
    const params = new URLSearchParams(searchParams);
    if (newFilter === "all") {
      params.delete("filter");
    } else {
      params.set("filter", newFilter);
    }
    const search = params.toString();
    const query = search ? `?${search}` : "";
    router.push(`${pathname}${query}`, { scroll: false });
  }, [pathname, router, searchParams]);
  const { threads, isLoading, error, refetch, hasMore, loadMore, isLoadingMore } = useCommunityFeed(filter, 20);
  const { isSignedIn } = useAuth();
  const { profile } = useProfile();
  const deleteThreadMutation = useDeleteThreadMutation();
  const prayerListMutation = usePrayerListToggleMutation();
  
  // Enable scroll preservation for this feed
  const { navigateWithScroll } = useScrollPreservation(threads, isLoading);
  const prefetchThread = usePrefetchThreadDetail();
  
  // Handle thread navigation with scroll preservation
  const handleThreadClick = useCallback((threadId: string) => {
    navigateWithScroll(`/threads/${threadId}`);
  }, [navigateWithScroll]);

  // Handle thread hover for prefetching
  const handleThreadHover = useCallback((threadId: string) => {
    prefetchThread(threadId);
  }, [prefetchThread]);

  const handlePrayerListToggle = useCallback(async (threadId: string) => {
    console.log("Prayer list toggle clicked for thread:", threadId, "isSignedIn:", isSignedIn);
    if (!isSignedIn) return;
    
    const thread = threads.find(t => t.id === threadId);
    const mainPost = thread?.posts.find(p => p.kind === "request") || thread?.posts[0];
    if (!mainPost) {
      console.log("No main post found for thread:", threadId);
      return;
    }

    console.log("Calling prayer list mutation for thread:", threadId, "post:", mainPost.id);
    try {
      await prayerListMutation.mutateAsync({
        threadId,
        postId: mainPost.id
      });
      console.log("Prayer list mutation completed successfully");
    } catch (error) {
      console.error("Error updating prayer list:", error);
    }
  }, [threads, isSignedIn, prayerListMutation]);


  const handleDelete = useCallback(async (threadId: string) => {
    if (!isSignedIn || !profile || deleteThreadMutation.isPending) return;
    
    if (!confirm("Are you sure you want to delete this thread? This action cannot be undone.")) return;

    try {
      // TanStack Query handles optimistic updates and cache invalidation
      await deleteThreadMutation.mutateAsync({ threadId });
    } catch (error) {
      console.error("Error deleting thread:", error);
      alert(`Failed to delete thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [isSignedIn, profile, deleteThreadMutation]);

  const handleSend = useCallback((threadId: string) => {
    // TODO: Implement send functionality
    console.log("Send thread:", threadId);
  }, []);

  const handleShare = useCallback((threadId: string) => {
    // TODO: Implement share functionality
    console.log("Share thread:", threadId);
  }, []);


  const handleEdit = useCallback((threadId: string) => {
    // TODO: Implement edit functionality
    console.log("Edit thread:", threadId);
  }, []);

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
      onPrayerListToggle={handlePrayerListToggle}
      onDelete={handleDelete}
      onRefetch={refetch}
      onThreadClick={handleThreadClick}
      onThreadHover={handleThreadHover}
      onSend={handleSend}
      onShare={handleShare}
      onEdit={handleEdit}
      hasMore={hasMore}
      loadMore={loadMore}
      isLoadingMore={isLoadingMore}
      enableInfiniteScroll={true}
      infiniteScrollThreshold={300}
      currentUserId={profile?.id}
      isSignedIn={isSignedIn}
      isDeletingId={deleteThreadMutation.isPending ? "loading" : undefined}
      emptyStateConfig={emptyStateConfig}
    />
  );
}