"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, BookOpen, Mic, HandHeart, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PrayerThreadDropdown } from "@/components/prayer-thread-dropdown";
import { QuickActionsBar } from "@/components/quick-actions-bar";
import { usePrefetchThreadDetail } from "@/hooks/use-thread-detail-query";

export interface PrayerRequest {
  id: string;
  postId?: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  isAnonymous: boolean;
  title?: string;
  content: string;
  createdAt: Date;
  prayerCount: number;
  prayerListCount: number;
  encouragementCount: number;
  isFollowing: boolean;
  hasPrayed: boolean;
  isInPrayerList: boolean;
  hasEncouraged: boolean;
  updateStatus?: "answered" | "update" | null;
  scriptureReference?: string;
  voiceNoteUrl?: string;
  streakDays?: number;
  groupName?: string;
  groupId?: string;
  sharedToCommunity?: boolean;
}

interface FeedCardProps {
  prayer: PrayerRequest;
  onPrayerListToggle?: (id: string) => void;
  onEncourage?: (id: string) => void;
  onFollow?: (id: string) => void;
  showGroupFeatures?: boolean;
  onCardClick?: (id: string) => void;
  currentUserId?: string;
  isSignedIn?: boolean;
  onDelete?: (id: string) => void;
  isDeletingId?: string;
  className?: string;
}

export const FeedCard = ({
  prayer,
  onPrayerListToggle,
  onEncourage,
  showGroupFeatures = false,
  onCardClick,
  currentUserId,
  isSignedIn = false,
  onDelete,
  isDeletingId,
  className,
}: FeedCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const prefetchThread = usePrefetchThreadDetail();
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const displayName = prayer.isAnonymous ? "Anonymous" : prayer.userName;
  const initials = prayer.isAnonymous ? "A" : prayer.userName.slice(0, 2).toUpperCase();

  useEffect(() => {
    setMounted(true);
    // Cleanup timeout on unmount
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const handlePrayerListToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPrayerListToggle?.(prayer.id);
  };

  const handleEncourage = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEncourage?.(prayer.id);
  };


  const handleCardClick = () => {
    if (onCardClick) {
      onCardClick(prayer.id);
    } else {
      // Default behavior: navigate to thread page
      const urlId = (prayer as any).shortId || prayer.id;
      router.push(`/threads/${urlId}`);
    }
  };

  const handleDropdownClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleMouseEnter = () => {
    // Clear any existing timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    // Set a new timeout to prefetch after 100ms
    hoverTimeoutRef.current = setTimeout(() => {
      prefetchThread(prayer.id);
    }, 100);
  };

  const handleMouseLeave = () => {
    // Clear the timeout if user leaves before prefetch triggers
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };



  return (
    <Card
      className={cn("p-8 bg-card/50 backdrop-blur-sm border-border/50 hover:border-border/80 transition-all duration-200 cursor-pointer hover:bg-card/60", className)}
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center space-x-3">
          <Avatar className="w-9 h-9">
            {!prayer.isAnonymous && prayer.userAvatar && (
              <AvatarImage src={prayer.userAvatar} alt={displayName} />
            )}
            <AvatarFallback className="bg-secondary text-secondary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-medium text-muted-foreground">{displayName}</h3>
              {showGroupFeatures && prayer.streakDays && prayer.streakDays > 0 && (
                <Badge variant="secondary" className="forge-amber-subtle text-xs px-2 py-0.5 flex items-center gap-1">
                  <Flame className="w-3 h-3" />
                  <span>{prayer.streakDays}d</span>
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              {mounted ? formatDistanceToNow(prayer.createdAt, { addSuffix: true }) : "..."}
            </p>
          </div>
        </div>
        <PrayerThreadDropdown
          isOwner={!!(isSignedIn && currentUserId && prayer.userId === currentUserId)}
          isSignedIn={isSignedIn}
          onDelete={() => onDelete?.(prayer.id)}
          isDeleting={isDeletingId === prayer.id}
          onClick={handleDropdownClick}
        />
      </div>


      {/* Status Badge */}
      {prayer.updateStatus && (
        <div className="mb-6">
          <Badge
            variant={prayer.updateStatus === "answered" ? "default" : "secondary"}
            className={cn(
              "text-sm px-3 py-1",
              prayer.updateStatus === "answered" ? "forge-success-subtle" : "forge-amber-subtle"
            )}
          >
            {prayer.updateStatus === "answered" ? "✓ Answered" : "↻ Update"}
          </Badge>
        </div>
      )}

      {/* Prayer Content */}
      <div className="py-2">
        <p
          className={cn(
            "text-foreground text-lg whitespace-pre-wrap leading-8 font-normal",
            !isExpanded && prayer.content.length > 250 && "line-clamp-4"
          )}
        >
          {prayer.content}
        </p>
        {prayer.content.length > 250 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="text-sm text-accent hover:text-accent/90 hover:underline mt-3 transition-colors font-medium"
          >
            {isExpanded ? "Show less" : "Read more"}
          </button>
        )}
      </div>

      {/* Scripture Reference */}
      {prayer.scriptureReference && (
        <div className="p-4 bg-secondary/30 rounded-lg border border-border/50 mb-6">
          <p className="text-sm text-muted-foreground italic flex items-start gap-2">
            <BookOpen className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{prayer.scriptureReference}</span>
          </p>
        </div>
      )}

      {/* Voice Note */}
      {showGroupFeatures && prayer.voiceNoteUrl && (
        <div className="mb-6">
          <button 
            onClick={(e) => e.stopPropagation()}
            className="flex items-center space-x-2 px-4 py-2.5 bg-secondary/50 rounded-lg hover:bg-secondary/70 hover:border-accent/30 border border-transparent transition-all duration-200"
          >
            <Mic className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium text-foreground">Voice note</span>
          </button>
        </div>
      )}



      {/* Actions */}
      <div className="pt-6" onClick={(e) => e.stopPropagation()}>
        <QuickActionsBar
          postId={prayer.postId || prayer.id}
          threadId={prayer.id}
          isMainPost={true}
          prayerListCount={prayer.prayerListCount}
          isInPrayerList={prayer.isInPrayerList}
          encouragementCount={prayer.encouragementCount}
          onPrayerListToggle={() => onPrayerListToggle?.(prayer.id)}
          onReplyClick={() => onCardClick?.(prayer.id)}
          isPrayerListPending={false}
        />
      </div>
    </Card>
  );
};
