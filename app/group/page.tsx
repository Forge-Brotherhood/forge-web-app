"use client";

import React, { useState, useCallback } from "react";
import { UnifiedFeed } from "@/components/unified-feed";
import { GroupNewPost } from "@/components/group-new-post";
import { 
  useGroupBasic, 
  useGroupMembers, 
  useGroupStats,
  useGroupFeed,
  type GroupFeedThread 
} from "@/hooks/use-group-feed-query";
import { useDeleteThreadMutation, usePrayerListToggleMutation } from "@/hooks/use-thread-mutations";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Users, 
  Trophy, 
  Flame, 
  BookOpen, 
  HandHeart, 
  BookmarkPlus, 
  Target,
  Clock
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@clerk/nextjs";
import { useProfile } from "@/hooks/use-profile-query";
import { cn } from "@/lib/utils";
import { useScrollPreservation } from "@/hooks/use-scroll-preservation";
import { usePrefetchThreadDetail } from "@/hooks/use-thread-detail-query";

export default function CoreGroupPage() {
  const [activeTab, setActiveTab] = useState<"feed" | "members">("feed");
  
  // Use optimized hooks for better performance
  const basicQuery = useGroupBasic();
  const statsQuery = useGroupStats();
  // Only load feed if we have a group (prevents unnecessary API call)
  const feedQuery = useGroupFeed(20, !basicQuery.isLoading && !!basicQuery.data);
  
  // Only load members when the members tab is active or when data is needed
  const membersQuery = useGroupMembers(activeTab === "members");
  
  const { isSignedIn } = useAuth();
  const { profile } = useProfile();
  const deleteThreadMutation = useDeleteThreadMutation();
  const prayerListMutation = usePrayerListToggleMutation();
  const prefetchThread = usePrefetchThreadDetail();
  
  // Combine the data
  const group = basicQuery.data ? {
    ...basicQuery.data,
    memberCount: statsQuery.data?.memberCount || 0,
  } : null;
  
  const stats = statsQuery.data;
  const members = membersQuery.data || [];
  const threads = feedQuery.threads;
  // Show loading only while basic query is loading - this determines if user has a group
  const isLoading = basicQuery.isLoading;
  const error = basicQuery.error?.message || statsQuery.error?.message || 
    feedQuery.error || (activeTab === "members" && membersQuery.error?.message) || null;
  const hasMore = feedQuery.hasMore;
  const loadMore = feedQuery.loadMore;
  const isLoadingMore = feedQuery.isLoadingMore;
  
  const refetch = useCallback(async () => {
    await Promise.all([
      basicQuery.refetch(),
      statsQuery.refetch(),
      feedQuery.refetch(),
      ...(activeTab === "members" ? [membersQuery.refetch()] : []),
    ]);
  }, [basicQuery, statsQuery, feedQuery, membersQuery, activeTab]);
  
  // Enable scroll preservation for this feed
  useScrollPreservation(threads, isLoading);

  // Handle thread hover for prefetching
  const handleThreadHover = useCallback((threadId: string) => {
    prefetchThread(threadId);
  }, [prefetchThread]);

  const handlePrayerListToggle = useCallback(async (threadId: string) => {
    if (!isSignedIn) return;
    
    const thread = threads.find(t => t.id === threadId);
    const mainPost = thread?.posts.find(p => p.kind === "request") || thread?.posts[0];
    if (!mainPost) return;

    try {
      await prayerListMutation.mutateAsync({
        threadId,
        postId: mainPost.id
      });
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

  const getAuthorName = (user: any) => {
    if (!user) return "Anonymous";
    return user.displayName || user.firstName || "Unknown";
  };

  const getAuthorInitials = (user: any) => {
    if (!user) return "?";
    const name = getAuthorName(user);
    return name
      .split(" ")
      .map((word: string) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatJoinDate = (dateString: string | null) => {
    if (!dateString) return 'recently';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'recently';
      return formatDistanceToNow(date, { addSuffix: true });
    } catch (error) {
      return 'recently';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // If basic query completed and no group found, show immediately
  if (!isLoading && !group) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Users className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-foreground font-medium mb-2">No Core Group</p>
          <p className="text-muted-foreground text-sm">You haven&apos;t been assigned to a core group yet.</p>
        </div>
      </div>
    );
  }

  const emptyStateConfig = {
    icon: BookOpen,
    title: "No prayer requests yet",
    description: "Be the first to share what your brothers can pray for"
  };

  // Custom header content for the group stats card
  const headerContent = stats && (
    <Card className="mb-6 bg-gradient-to-br from-accent/5 to-accent/10 border-accent/20">
      <CardContent className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="text-center">
            <BookmarkPlus className="w-5 h-5 text-red-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{stats.weeklyPrayers}</p>
            <p className="text-xs text-muted-foreground">Prayers This Week</p>
          </div>
          <div className="text-center">
            <Target className="w-5 h-5 text-green-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{stats.activeToday}</p>
            <p className="text-xs text-muted-foreground">Active Today</p>
          </div>
          <div className="text-center">
            <Flame className="w-5 h-5 text-amber-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{stats.averageStreak}d</p>
            <p className="text-xs text-muted-foreground">Avg Streak</p>
          </div>
          <div className="text-center">
            <Trophy className="w-5 h-5 text-yellow-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-foreground">{stats.groupStreak}d</p>
            <p className="text-xs text-muted-foreground">Best Streak</p>
          </div>
        </div>
        
        {/* Challenge Progress */}
        {stats.challengeProgress && (
          <div className="mt-4 p-4 bg-background/50 rounded-lg border border-border/50">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-medium text-foreground">{stats.challengeProgress.name}</h3>
              <Badge variant="outline" className="text-xs">
                <Clock className="w-3 h-3 mr-1" />
                {formatDistanceToNow(new Date(stats.challengeProgress.endDate))} left
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-secondary rounded-full h-2">
                <div 
                  className="bg-accent rounded-full h-2 transition-all duration-300"
                  style={{ width: `${(stats.challengeProgress.current / stats.challengeProgress.target) * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium text-foreground">
                {stats.challengeProgress.current}/{stats.challengeProgress.target}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Tabs component
  const tabsComponent = (
    <div className="flex gap-2 mb-6 bg-secondary/30 p-1 rounded-lg">
      <Button
        variant={activeTab === "feed" ? "default" : "ghost"}
        onClick={() => setActiveTab("feed")}
        className={cn(
          "flex-1 h-9 transition-all duration-200 text-sm font-medium gap-2",
          activeTab === "feed" 
            ? "bg-accent/20 text-accent border-accent/40 hover:bg-accent/30" 
            : "hover:bg-secondary/50 hover:text-foreground"
        )}
      >
        <BookOpen className="h-4 w-4" />
        Prayer Feed
      </Button>
      <Button
        variant={activeTab === "members" ? "default" : "ghost"}
        onClick={() => setActiveTab("members")}
        className={cn(
          "flex-1 h-9 transition-all duration-200 text-sm font-medium gap-2",
          activeTab === "members" 
            ? "bg-accent/20 text-accent border-accent/40 hover:bg-accent/30" 
            : "hover:bg-secondary/50 hover:text-foreground"
        )}
      >
        <Users className="h-4 w-4" />
        Members
      </Button>
    </div>
  );

  return (
    <>
      {activeTab === "feed" ? (
        <UnifiedFeed
          threads={threads}
          isLoading={isLoading}
          error={error}
          feedType="group"
          title={group?.name || "Core Group"}
          description={`Your brotherhood of ${stats?.memberCount || 0} believers`}
          onPrayerListToggle={handlePrayerListToggle}
          onDelete={handleDelete}
          onRefetch={refetch}
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
          headerContent={
            <>
              {headerContent}
              {group && <GroupNewPost groupId={group.id} onSubmit={refetch} />}
              {tabsComponent}
            </>
          }
        />
      ) : (
        <div className="min-h-screen bg-background">
          <div className="max-w-2xl mx-auto px-4 py-6">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-foreground mb-2">
                {group?.name || "Core Group"}
              </h1>
              <p className="text-muted-foreground">
                Your brotherhood of {stats?.memberCount || 0} believers
              </p>
            </div>

            {headerContent}
            {tabsComponent}

            {/* Members */}
            <div className="space-y-4">
              {members.map((member, index) => (
                <Card key={member.id || `member-${index}`} className="p-5 bg-card/50 backdrop-blur-sm border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={member.user.profileImageUrl || undefined} />
                        <AvatarFallback>
                          {getAuthorInitials(member.user)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-foreground">
                          {getAuthorName(member.user)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Joined {formatJoinDate(member.joinedAt)}
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800 flex items-center space-x-1.5 px-3">
                      <Flame className="h-3.5 w-3.5" />
                      <span className="font-medium">{member.prayerStreak || 0}d</span>
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}