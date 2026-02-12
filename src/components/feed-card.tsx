"use client";

import { useState, useEffect, useRef } from "react";
import { BookOpen, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PrayerThreadDropdown } from "@/components/prayer-thread-dropdown";
import { QuickActionsBar } from "@/components/quick-actions-bar";
import { PrayerListItemCard, StatusChip } from "@features/prayer/components";
import { usePrefetchThreadDetail } from "@features/prayer";
import type { FeedItem } from "@core/models/models";

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

// Loading skeleton for feed cards
export function FeedCardSkeleton() {
  return (
    <div className="p-4 rounded-xl bg-card shadow-sm dark:shadow-none animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-3 w-16 bg-muted rounded" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-2/3 bg-muted rounded" />
          </div>
          <div className="flex gap-4 pt-2">
            <div className="h-8 w-20 bg-muted rounded" />
            <div className="h-8 w-20 bg-muted rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

export const FeedCard = ({
  prayer,
  onPrayerListToggle,
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
  const prefetchThread = usePrefetchThreadDetail();
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const handleCardClick = () => {
    if (onCardClick) {
      onCardClick(prayer.id);
    }
  };

  const handleDropdownClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      prefetchThread(prayer.id);
    }, 100);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  // Convert PrayerRequest to FeedItem format for the base card
  const feedItem: FeedItem = {
    id: (prayer as any).shortId || prayer.id,
    postId: prayer.postId,
    userName: prayer.userName,
    userAvatar: prayer.userAvatar,
    isAnonymous: prayer.isAnonymous,
    title: prayer.title,
    content: prayer.content,
    createdAt: prayer.createdAt,
    updateStatus: prayer.updateStatus,
    prayerListCount: prayer.prayerListCount,
    isInPrayerList: prayer.isInPrayerList,
  } as FeedItem;

  return (
    <PrayerListItemCard
      item={feedItem}
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      contentLineClamp={isExpanded ? undefined : 4}
      showTimestamp={mounted}
      className={className}
      headerAction={
        <div className="flex items-center gap-2" onClick={handleDropdownClick}>
          {prayer.updateStatus && (
            <Badge
              variant={prayer.updateStatus === "answered" ? "default" : "secondary"}
              className={cn(
                "text-xs px-2 py-0.5 rounded-full",
                prayer.updateStatus === "answered"
                  ? "bg-green-500/15 text-green-600 dark:text-green-400"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              )}
            >
              {prayer.updateStatus === "answered" ? "Answered" : "Update"}
            </Badge>
          )}
          <PrayerThreadDropdown
            isOwner={!!(isSignedIn && currentUserId && prayer.userId === currentUserId)}
            isSignedIn={isSignedIn}
            onDelete={() => onDelete?.(prayer.id)}
            isDeleting={isDeletingId === prayer.id}
            onClick={handleDropdownClick}
          />
        </div>
      }
      contentExtra={
        <>
          {/* Read more button */}
          {prayer.content.length > 250 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="text-sm text-accent hover:text-accent/90 hover:underline mt-2 transition-colors font-medium"
            >
              {isExpanded ? "Show less" : "Read more"}
            </button>
          )}

          {/* Scripture reference */}
          {prayer.scriptureReference && (
            <div className="p-3 bg-secondary/30 rounded-xl border border-border/50 mt-3">
              <p className="text-sm text-muted-foreground italic flex items-start gap-2">
                <BookOpen className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{prayer.scriptureReference}</span>
              </p>
            </div>
          )}

          {/* Voice note */}
          {showGroupFeatures && prayer.voiceNoteUrl && (
            <button
              onClick={(e) => e.stopPropagation()}
              className="flex items-center space-x-2 px-3 py-2 bg-secondary/50 rounded-xl hover:bg-secondary/70 border border-transparent transition-all duration-200 mt-3"
            >
              <Mic className="w-4 h-4 text-accent" />
              <span className="text-sm font-medium text-foreground">Voice note</span>
            </button>
          )}
        </>
      }
      footerAction={
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
      }
    />
  );
};
