"use client";

import { useState, useEffect, useCallback } from "react";
import { FeedCard, type PrayerRequest } from "./feed-card";
import { type CommunityFeedThread } from "@/hooks/use-community-feed-query";
import { usePrayerMutation, usePrayerStatus } from "@/hooks/use-prayer-mutations";
import { BookmarkPlus, HandHeart, Trophy, Clock, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { MediaGridGallery } from "./photoswipe-gallery";

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
  const [mounted, setMounted] = useState(false);
  const [hasPrayed, setHasPrayed] = useState(false);
  const router = useRouter();
  
  // TanStack Query mutations
  const prayerMutation = usePrayerMutation();
  const prayerStatusMutation = usePrayerStatus(thread.id);
  
  // Get the main post (request or testimony)
  const mainPost = thread.posts?.find(p => p.kind === "request" || p.kind === "testimony") || thread.posts?.[0];
  const isTestimony = thread.status === "answered" || mainPost?.kind === "testimony";
  
  const loadUserPrayerStatus = useCallback(async () => {
    if (!isSignedIn || !currentUserId || !mainPost) return;
    
    try {
      const data = await prayerStatusMutation.mutateAsync();
      setHasPrayed(data.hasPrayed);
      
      // The prayer count is automatically updated in the cache by the mutation
      // No need to call onUpdate anymore since TanStack Query handles cache updates
    } catch (error) {
      console.error("Failed to load prayer status:", error);
    }
  }, [isSignedIn, currentUserId, mainPost, prayerStatusMutation]);
  
  useEffect(() => {
    setMounted(true);
    
    // Load user's prayer status from API if signed in
    if (isSignedIn && currentUserId && mainPost) {
      loadUserPrayerStatus();
    }
  }, [thread.id, isSignedIn, currentUserId, mainPost, loadUserPrayerStatus]);

  const handlePray = async () => {
    if (!isSignedIn || prayerMutation.isPending || !mainPost) return;
    
    const action = hasPrayed ? 'remove' : 'add';
    
    // Optimistic local update
    setHasPrayed(!hasPrayed);

    try {
      await prayerMutation.mutateAsync({
        threadId: thread.id,
        postId: mainPost.id,
        action,
      });
      
      // Success - the cache has been updated by the mutation
      // No need to manually update anything else
    } catch (error) {
      // Revert local optimistic update on error
      // The cache rollback is handled by the mutation's onError
      setHasPrayed(hasPrayed);
      console.error("Failed to update prayer:", error);
    }
  };

  const handleViewThread = () => {
    router.push(`/threads/${thread.id}`);
  };

  if (!mounted || !mainPost) {
    return null;
  }

  const displayAuthor = thread.isAnonymous ? null : (thread.author || mainPost.author);
  const authorName = displayAuthor ? 
    (displayAuthor.displayName || displayAuthor.firstName || "Unknown") : 
    "Anonymous";

  const content = mainPost.content || "";
  const createdAt = new Date(mainPost.createdAt);

  return (
    <Card className="w-full no-border border-b border-border last:border-b-0">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <Avatar className="w-10 h-10">
              <AvatarImage src={displayAuthor?.profileImageUrl || undefined} />
              <AvatarFallback>
                {thread.isAnonymous ? "?" : (authorName.charAt(0).toUpperCase())}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-medium text-foreground">
                  {authorName}
                </span>
                {isTestimony && (
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                    <Trophy className="w-3 h-3 mr-1" />
                    Testimony
                  </Badge>
                )}
              </div>
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>{thread.group ? (thread.group.name || `${thread.group.groupType} group`) : "Community"}</span>
                <Clock className="w-3 h-3 ml-2" />
                <span>{formatDistanceToNow(createdAt, { addSuffix: true })}</span>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Content */}
        <div className="text-foreground mb-4 line-clamp-4 whitespace-pre-wrap">
          {content}
        </div>

        {/* Media */}
        {mainPost.media && mainPost.media.length > 0 && (
          <div className="mb-2">
            <MediaGridGallery 
              media={mainPost.media} 
              maxItems={4}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-6">
          <div className="flex items-center space-x-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePray}
              disabled={!isSignedIn || prayerMutation.isPending}
              className={hasPrayed ? "text-red-600 hover:text-red-700" : "text-muted-foreground hover:text-black transition-colors"}
            >
              <BookmarkPlus className={`w-4 h-4 mr-2 ${hasPrayed ? "fill-current" : ""}`} />
              {thread._count.prayers}
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleViewThread}
              className="text-muted-foreground hover:text-black transition-colors"
            >
              <HandHeart className="w-4 h-4 mr-2" />
              {thread._count.posts}
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleViewThread}
          >
            View Thread
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};