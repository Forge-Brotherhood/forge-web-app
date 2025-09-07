"use client";

import React, { useState, useCallback } from "react";
import { UnifiedFeed } from "@/components/unified-feed";
import { GroupNewPost } from "@/components/group-new-post";
import { useGroupFeed, type GroupFeedThread } from "@/hooks/use-group-feed";
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
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";

export default function CoreGroupPage() {
  const [activeTab, setActiveTab] = useState<"feed" | "members">("feed");
  const { group, threads, stats, members, isLoading, error, refetch, hasMore, loadMore, isLoadingMore } = useGroupFeed();
  const { isSignedIn } = useAuth();
  const { profile } = useProfile();

  const handlePray = useCallback(async (threadId: string) => {
    if (!isSignedIn) return;
    
    try {
      const mainPost = threads.find(t => t.id === threadId)?.posts.find(p => p.kind === "request");
      if (!mainPost) return;

      const response = await fetch(`/api/threads/${threadId}/prayers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: mainPost.id }),
      });

      if (response.ok) {
        // Trigger a refetch to update the data
        refetch();
      }
    } catch (error) {
      console.error("Error praying:", error);
    }
  }, [threads, isSignedIn, refetch]);

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!group) {
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

  const statsConfig = stats ? [
    { key: 'weeklyPrayers', icon: BookmarkPlus, label: 'Prayers This Week', color: 'text-red-500' },
    { key: 'activeToday', icon: Target, label: 'Active Today', color: 'text-green-500' },
    { key: 'averageStreak', icon: Flame, label: 'Avg Streak', color: 'text-amber-500', suffix: 'd' },
    { key: 'groupStreak', icon: Trophy, label: 'Best Streak', color: 'text-yellow-500', suffix: 'd' }
  ] : undefined;

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
          description={`Your brotherhood of ${stats?.totalMembers || 0} believers`}
          onPray={handlePray}
          onRefetch={refetch}
          hasMore={hasMore}
          loadMore={loadMore}
          isLoadingMore={isLoadingMore}
          enableInfiniteScroll={true}
          infiniteScrollThreshold={300}
          currentUserId={profile?.id}
          isSignedIn={isSignedIn}
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
                Your brotherhood of {stats?.totalMembers || 0} believers
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
                          Joined {formatDistanceToNow(new Date(member.joinedAt), { addSuffix: true })}
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