"use client";

import React, { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
  Clock,
  TrendingUp,
  AlertCircle,
  Plus
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@clerk/nextjs";
import { useProfile } from "@/hooks/use-profile";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MediaGridGallery } from "@/components/photoswipe-gallery";
import { VideoPlayer } from "@/components/video-player";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";

// Base interfaces
interface BaseUser {
  id: string;
  displayName: string | null;
  firstName: string | null;
  profileImageUrl: string | null;
}

interface BaseMedia {
  id: string;
  type: "image" | "video" | "audio";
  url: string;
  width: number | null;
  height: number | null;
  durationS: number | null;
}

interface BasePost {
  id: string;
  kind: "request" | "update" | "testimony" | "encouragement" | "verse" | "system";
  content: string | null;
  createdAt: string;
  author: BaseUser | null;
  media: BaseMedia[];
  _count?: {
    prayerActions: number;
  };
}

interface BaseThread {
  id: string;
  title: string | null;
  sharedToCommunity: boolean;
  isAnonymous: boolean;
  status: "open" | "answered" | "archived";
  createdAt: string;
  updatedAt: string;
  author: BaseUser | null;
  posts: BasePost[];
  _count: {
    posts: number;
    prayers: number;
  };
  group?: {
    id: string;
    name: string | null;
    groupType: "core" | "circle";
  };
}

interface BaseStats {
  [key: string]: number | string | undefined;
}

// Props for the unified feed
interface UnifiedFeedProps<TThread extends BaseThread, TStats extends BaseStats> {
  // Data
  threads: TThread[];
  stats?: TStats | null;
  isLoading: boolean;
  error?: string | null;
  
  // Configuration
  feedType: "community" | "group";
  title: string;
  description: string;
  
  // Stats configuration
  statsConfig?: Array<{
    key: string;
    icon: React.ComponentType<any>;
    label: string;
    color: string;
    suffix?: string;
  }>;
  
  // Filters
  showFilters?: boolean;
  filters?: Array<{
    key: string;
    label: string;
    icon?: React.ComponentType<any>;
  }>;
  activeFilter?: string;
  onFilterChange?: (filter: string) => void;
  
  // Actions
  onPray?: (threadId: string) => void | Promise<void>;
  onDelete?: (threadId: string) => void | Promise<void>;
  onRefetch?: () => void;
  
  // Pagination
  hasMore?: boolean;
  loadMore?: () => void;
  isLoadingMore?: boolean;
  
  // Infinite Scroll
  enableInfiniteScroll?: boolean;
  infiniteScrollThreshold?: number;
  
  // User context
  currentUserId?: string;
  isSignedIn?: boolean;
  isDeletingId?: string;
  
  // Custom content
  headerContent?: React.ReactNode;
  newPostComponent?: React.ReactNode;
  
  // Empty state customization
  emptyStateConfig?: {
    icon: React.ComponentType<any>;
    title: string;
    description: string;
  };
}

export function UnifiedFeed<TThread extends BaseThread, TStats extends BaseStats>({
  threads,
  stats,
  isLoading,
  error,
  feedType,
  title,
  description,
  statsConfig,
  showFilters = false,
  filters = [],
  activeFilter,
  onFilterChange,
  onPray,
  onDelete,
  onRefetch,
  hasMore = false,
  loadMore,
  isLoadingMore = false,
  enableInfiniteScroll = false,
  infiniteScrollThreshold = 200,
  currentUserId,
  isSignedIn = false,
  isDeletingId,
  headerContent,
  newPostComponent,
  emptyStateConfig
}: UnifiedFeedProps<TThread, TStats>) {
  const { profile } = useProfile();
  const router = useRouter();
  const [localThreads, setLocalThreads] = useState<TThread[]>([]);
  
  // Infinite scroll
  const sentinelRef = useInfiniteScroll(
    loadMore || (() => {}),
    hasMore,
    isLoadingMore,
    { 
      enabled: enableInfiniteScroll && !!loadMore,
      threshold: infiniteScrollThreshold
    }
  );
  
  // Sync threads with local state for optimistic updates
  useEffect(() => {
    setLocalThreads(threads);
  }, [threads]);

  const handleThreadUpdate = useCallback((threadId: string, updates: Partial<TThread>) => {
    setLocalThreads(prev => 
      prev.map(thread => 
        thread.id === threadId ? { ...thread, ...updates } : thread
      )
    );
  }, []);

  const handlePrayClick = useCallback(async (threadId: string) => {
    if (!isSignedIn || !onPray) return;
    await onPray(threadId);
  }, [isSignedIn, onPray]);

  const handleThreadNavigation = useCallback((threadId: string) => {
    router.push(`/threads/${threadId}`);
  }, [router]);

  const getAuthorName = (user: BaseUser | null) => {
    if (!user) return "Anonymous";
    return user.displayName || user.firstName || "Unknown";
  };

  const getAuthorInitials = (user: BaseUser | null) => {
    if (!user) return "?";
    const name = getAuthorName(user);
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const renderThread = (thread: TThread) => {
    const mainPost = thread.posts?.find(p => p.kind === "request" || p.kind === "testimony") || thread.posts?.[0];
    if (!mainPost) return null;

    const isTestimony = thread.status === "answered" || mainPost.kind === "testimony";
    const displayAuthor = thread.isAnonymous ? null : (thread.author || mainPost.author);
    
    // Check if current user has prayed (simplified check - would need proper implementation)
    const hasPrayed = false; // This would need to be tracked properly in a real implementation

    return (
      <Card 
        key={thread.id} 
        className="w-full no-border border-b border-border last:border-b-0 cursor-pointer hover:bg-accent/5 transition-colors"
        onClick={() => handleThreadNavigation(thread.id)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <Avatar className="w-10 h-10">
                <AvatarImage src={displayAuthor?.profileImageUrl || undefined} />
                <AvatarFallback>
                  {thread.isAnonymous ? "?" : getAuthorInitials(displayAuthor)}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-foreground">
                    {getAuthorName(displayAuthor)}
                  </span>
                  {isTestimony && (
                    <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                      <Trophy className="w-3 h-3 mr-1" />
                      Testimony
                    </Badge>
                  )}
                </div>
                <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                  {thread.group && (
                    <>
                      <Users className="w-3 h-3" />
                      <span>{thread.group ? (thread.group.name || `${thread.group.groupType} group`) : "Community"}</span>
                    </>
                  )}
                  <Clock className={cn("w-3 h-3", thread.group && "ml-2")} />
                  <span>{formatDistanceToNow(new Date(mainPost.createdAt), { addSuffix: true })}</span>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0 pb-0">
          {/* Content */}
          <div className="text-foreground whitespace-pre-wrap">
            {mainPost.content}
          </div>
        </CardContent>
        
        {/* Media - outside clickable area to prevent interference */}
        {mainPost.media && mainPost.media.length > 0 && (
          <CardContent className="pt-3 pb-0">
            {/* Image Gallery */}
            {mainPost.media.filter(m => m.type === "image").length > 0 && (
              <div onClick={(e) => e.stopPropagation()}>
                <MediaGridGallery 
                  media={mainPost.media.filter(m => m.type === "image")} 
                  maxItems={4}
                  className=""
                />
              </div>
            )}
            {/* Videos */}
            {mainPost.media.filter(m => m.type === "video").map((media: any) => (
              <div key={media.id} onClick={(e) => e.stopPropagation()}>
                <VideoPlayer
                  video={media}
                  autoPlay={true}
                  muted={true}
                  className=""
                />
              </div>
            ))}
            {/* Audio */}
            {mainPost.media.filter(m => m.type === "audio").map((media: any) => (
              <div key={media.id} className="bg-secondary/50 rounded-lg p-4 h-32 flex items-center justify-center col-span-2" onClick={(e) => e.stopPropagation()}>
                <audio
                  src={media.url}
                  controls
                  className="w-full"
                />
              </div>
            ))}
          </CardContent>
        )}

        {/* Actions - outside clickable area */}
        <CardContent className="pt-6">
          <div className="flex items-center space-x-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handlePrayClick(thread.id);
              }}
              disabled={!isSignedIn}
              className={hasPrayed ? "text-red-600 hover:text-red-700" : "text-muted-foreground hover:text-black transition-colors"}
            >
              <BookmarkPlus className={`w-4 h-4 mr-2 ${hasPrayed ? "fill-current" : ""}`} />
              {thread._count.prayers}
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleThreadNavigation(thread.id);
              }}
              className="text-muted-foreground hover:text-black transition-colors"
            >
              <HandHeart className="w-4 h-4 mr-2" />
              {thread._count.posts}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">{title}</h1>
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground">{description}</p>
            <div className="text-sm text-muted-foreground bg-secondary/50 px-3 py-1 rounded-full">
              {localThreads.length} {localThreads.length === 1 ? 'post' : 'posts'} loaded
            </div>
          </div>
        </div>

        {/* Stats */}
        {stats && statsConfig && (
          <div className={cn(
            "grid gap-4 mb-8",
            statsConfig.length <= 2 ? "grid-cols-2" : 
            statsConfig.length <= 4 ? "grid-cols-2 md:grid-cols-4" : 
            "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
          )}>
            {statsConfig.map(({ key, icon: Icon, label, color, suffix }) => (
              <div key={String(key)} className="bg-card rounded-lg p-4 border">
                <div className="flex items-center space-x-2">
                  <Icon className={cn("w-5 h-5", color)} />
                  <div>
                    <p className="text-2xl font-bold text-foreground">
                      {stats[key]}{suffix || ''}
                    </p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Custom header content */}
        {headerContent}

        {/* Filter Buttons */}
        {showFilters && filters.length > 0 && (
          <div className="flex space-x-2 mb-8">
            {filters.map(({ key, label, icon: Icon }) => (
              <Button
                key={key}
                variant={activeFilter === key ? "default" : "outline"}
                onClick={() => onFilterChange?.(key)}
                className={cn(
                  "flex-1 sm:flex-none",
                  activeFilter === key && "bg-primary text-primary-foreground"
                )}
              >
                {Icon && <Icon className="w-4 h-4 mr-2" />}
                {label}
              </Button>
            ))}
          </div>
        )}

        {/* New Post Component */}
        {newPostComponent}

        {/* Feed Content */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <AlertCircle className="w-12 h-12 text-muted-foreground" />
              <div className="text-center">
                <p className="text-foreground font-medium">Failed to load feed</p>
                <p className="text-muted-foreground text-sm mt-1">{error}</p>
                {onRefetch && (
                  <Button 
                    onClick={onRefetch} 
                    variant="outline" 
                    className="mt-3"
                  >
                    Try Again
                  </Button>
                )}
              </div>
            </div>
          ) : localThreads.length > 0 ? (
            localThreads.map(renderThread)
          ) : (
            <div className="text-center py-12">
              <div className="mb-4">
                {emptyStateConfig?.icon ? (
                  <emptyStateConfig.icon className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                ) : (
                  <BookOpen className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                )}
              </div>
              <p className="text-muted-foreground text-lg mb-2">
                {emptyStateConfig?.title || "No posts found"}
              </p>
              <p className="text-muted-foreground text-sm">
                {emptyStateConfig?.description || "Posts will appear here when available"}
              </p>
            </div>
          )}
        </div>

        {/* Infinite Scroll Sentinel */}
        {enableInfiniteScroll && hasMore && localThreads.length > 0 && (
          <div ref={sentinelRef} className="h-10 flex items-center justify-center mt-4">
            {isLoadingMore && (
              <div className="flex items-center space-x-2 text-muted-foreground">
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Loading more...</span>
              </div>
            )}
          </div>
        )}
        
        {/* Manual Load More - shown when infinite scroll is disabled */}
        {!enableInfiniteScroll && hasMore && localThreads.length > 0 && loadMore && (
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
                `Load more ${activeFilter === "all" ? "posts" : activeFilter || "posts"}`
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}