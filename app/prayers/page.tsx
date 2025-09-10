"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, BookOpen, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FeedCard, PrayerRequest } from "@/components/feed-card";
import { usePrayerListQuery, useRemoveFromPrayerList } from "@/hooks/use-prayer-list-query";
import { useAuth } from "@clerk/nextjs";

type FilterType = "all" | "community" | "groups";

export default function BookmarkedPrayers() {
  const router = useRouter();
  const { userId } = useAuth();
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const { data, isLoading, error } = usePrayerListQuery();
  const removeFromPrayerList = useRemoveFromPrayerList();

  const handleRemoveFromPrayerList = async (threadId: string) => {
    setRemovingId(threadId);
    try {
      await removeFromPrayerList.mutateAsync({ threadId });
    } catch (error) {
      console.error("Failed to remove from prayer list:", error);
    } finally {
      setRemovingId(null);
    }
  };

  const handleCardClick = (threadId: string) => {
    router.push(`/threads/${threadId}`);
  };

  // Transform prayer list items to FeedCard format
  const transformedPrayers = useMemo(() => {
    if (!data?.items) return [];

    return data.items.map((item): PrayerRequest => {
      const thread = item.thread;
      const firstPost = thread.posts[0];
      const author = thread.isAnonymous ? null : thread.author;

      return {
        id: thread.id,
        userId: author?.id || "",
        userName: author?.displayName || "Anonymous",
        userAvatar: author?.profileImageUrl,
        isAnonymous: thread.isAnonymous,
        title: thread.title,
        content: firstPost?.content || thread.content,
        createdAt: new Date(thread.createdAt),
        prayerCount: thread._count.prayers,
        prayerListCount: thread._count.prayerListItems,
        encouragementCount: 0,
        isFollowing: false,
        hasPrayed: false,
        isInPrayerList: true,
        hasEncouraged: false,
        updateStatus: null,
        groupName: thread.group?.name,
        groupId: thread.group?.id,
        sharedToCommunity: thread.sharedToCommunity,
      };
    });
  }, [data]);

  // Filter prayers based on search and filter type
  const filteredPrayers = useMemo(() => {
    let prayers = transformedPrayers;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      prayers = prayers.filter(prayer => 
        prayer.content.toLowerCase().includes(query) ||
        prayer.title?.toLowerCase().includes(query) ||
        prayer.userName.toLowerCase().includes(query) ||
        prayer.groupName?.toLowerCase().includes(query)
      );
    }

    // Apply type filter
    if (filterType === "community") {
      prayers = prayers.filter(prayer => prayer.sharedToCommunity);
    } else if (filterType === "groups") {
      prayers = prayers.filter(prayer => prayer.groupId && !prayer.sharedToCommunity);
    }

    return prayers;
  }, [transformedPrayers, searchQuery, filterType]);

  const stats = {
    total: transformedPrayers.length,
    community: transformedPrayers.filter(p => p.sharedToCommunity).length,
    groups: transformedPrayers.filter(p => p.groupId && !p.sharedToCommunity).length,
  };

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-6 max-w-md w-full">
          <p className="text-center text-destructive">Failed to load prayer list</p>
          <Button 
            onClick={() => window.location.reload()} 
            className="w-full mt-4"
          >
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-foreground mb-2 flex items-center gap-2">
            <BookOpen className="h-6 w-6" />
            Bookmarked Prayers
          </h1>
          <p className="text-muted-foreground text-sm">
            Prayers you're committed to praying for
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          <Card 
            className={cn(
              "p-3 sm:p-4 text-center cursor-pointer transition-all duration-200",
              "bg-card/50 backdrop-blur-sm border-border/50",
              filterType === "all" && "bg-accent/20 text-accent border-accent/40"
            )}
            onClick={() => setFilterType("all")}
          >
            <p className={cn(
              "text-lg sm:text-2xl font-bold mb-0.5",
              filterType === "all" ? "text-accent" : "text-foreground"
            )}>{stats.total}</p>
            <p className={cn(
              "text-[10px] sm:text-xs",
              filterType === "all" ? "text-accent/80" : "text-muted-foreground"
            )}>All</p>
          </Card>
          <Card 
            className={cn(
              "p-3 sm:p-4 text-center cursor-pointer transition-all duration-200",
              "bg-card/50 backdrop-blur-sm border-border/50",
              filterType === "community" && "bg-accent/20 text-accent border-accent/40"
            )}
            onClick={() => setFilterType("community")}
          >
            <p className={cn(
              "text-lg sm:text-2xl font-bold mb-0.5",
              filterType === "community" ? "text-accent" : "text-blue-600 dark:text-blue-400"
            )}>{stats.community}</p>
            <p className={cn(
              "text-[10px] sm:text-xs",
              filterType === "community" ? "text-accent/80" : "text-muted-foreground"
            )}>Community</p>
          </Card>
          <Card 
            className={cn(
              "p-3 sm:p-4 text-center cursor-pointer transition-all duration-200",
              "bg-card/50 backdrop-blur-sm border-border/50",
              filterType === "groups" && "bg-accent/20 text-accent border-accent/40"
            )}
            onClick={() => setFilterType("groups")}
          >
            <p className={cn(
              "text-lg sm:text-2xl font-bold mb-0.5",
              filterType === "groups" ? "text-accent" : "text-green-600 dark:text-green-400"
            )}>{stats.groups}</p>
            <p className={cn(
              "text-[10px] sm:text-xs",
              filterType === "groups" ? "text-accent/80" : "text-muted-foreground"
            )}>Groups</p>
          </Card>
        </div>

        {/* Search */}
        <div className="relative mb-8">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            type="text"
            placeholder="Search bookmarked prayers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12 bg-secondary/50 border-border/50 focus:border-accent/50 text-base"
          />
        </div>

        {/* Future Pray Now Button */}
        <div className="mb-6">
          <Button 
            className="w-full h-12 text-base font-medium"
            disabled
          >
            Pray Now (Coming Soon)
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Guided prayer experience coming soon
          </p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Prayers List */}
        {!isLoading && filteredPrayers.length > 0 && (
          <div className="space-y-4">
            {filteredPrayers.map((prayer) => (
              <div key={prayer.id} className="relative">
                {prayer.groupName && (
                  <Badge 
                    variant="outline" 
                    className="absolute -top-2 left-4 z-10 bg-background"
                  >
                    {prayer.groupName}
                  </Badge>
                )}
                <FeedCard
                  prayer={prayer}
                  onPrayerListToggle={handleRemoveFromPrayerList}
                  onCardClick={handleCardClick}
                  currentUserId={userId || undefined}
                  isSignedIn={!!userId}
                  isDeletingId={removingId || undefined}
                />
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredPrayers.length === 0 && (
          <Card className="p-12 text-center bg-card/50 backdrop-blur-sm border-border/50">
            <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">
              {searchQuery 
                ? "No prayers found matching your search" 
                : "No bookmarked prayers yet"}
            </p>
            <p className="text-muted-foreground text-sm">
              {searchQuery
                ? "Try adjusting your search terms"
                : "Browse the community or your groups to bookmark prayers"}
            </p>
            <Button 
              onClick={() => router.push("/community")}
              className="mt-6"
            >
              Browse Community Prayers
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}