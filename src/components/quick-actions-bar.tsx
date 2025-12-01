"use client";

import { BookmarkPlus, HandHeart, Send, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QuickActionsBarProps {
  postId: string;
  threadId: string;
  isMainPost?: boolean;
  prayerListCount: number;
  isInPrayerList: boolean;
  encouragementCount: number;
  onPrayerListToggle: () => void;
  onReplyClick: () => void;
  onSendClick?: () => void;
  onShareClick?: () => void;
  isPrayerListPending?: boolean;
}

export function QuickActionsBar({
  postId,
  threadId,
  isMainPost = false,
  prayerListCount,
  isInPrayerList,
  encouragementCount,
  onPrayerListToggle,
  onReplyClick,
  onSendClick,
  onShareClick,
  isPrayerListPending = false,
}: QuickActionsBarProps) {
  return (
    <div className="flex items-center justify-between w-full">
      {/* Prayer List Action */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onPrayerListToggle}
        disabled={isPrayerListPending}
        className="group relative h-9 px-3 text-muted-foreground hover:text-amber-600 hover:bg-amber-600/5 dark:hover:bg-amber-600/10 transition-all duration-200"
      >
        <div className="flex items-center space-x-2">
          {isPrayerListPending ? (
            <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-current rounded-full animate-spin" />
          ) : (
            <BookmarkPlus 
              className={cn(
                "w-4 h-4 transition-all duration-300",
                isInPrayerList 
                  ? "fill-amber-600 text-amber-600" 
                  : "group-hover:text-amber-600"
              )} 
            />
          )}
          <span className={cn(
            "text-sm font-medium tabular-nums",
            isInPrayerList && "text-amber-600"
          )}>
            {prayerListCount > 999
              ? `${(prayerListCount / 1000).toFixed(1)}K`
              : prayerListCount || 0
            }
          </span>
        </div>
      </Button>
      
      {/* Reply/Encourage Action */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onReplyClick}
        className="group h-9 px-3 text-muted-foreground hover:text-green-600 hover:bg-green-600/5 dark:hover:bg-green-600/10 transition-all duration-200"
      >
        <div className="flex items-center space-x-2">
          <HandHeart className="w-4 h-4 group-hover:text-green-600" />
          <span className="text-sm font-medium tabular-nums group-hover:text-green-600">
            {encouragementCount > 999 
              ? `${(encouragementCount / 1000).toFixed(1)}K`
              : encouragementCount || 0
            }
          </span>
        </div>
      </Button>

      {/* Send Action */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onSendClick}
        className="h-9 px-3 text-muted-foreground hover:text-blue-600 hover:bg-blue-600/5 dark:hover:bg-blue-600/10 transition-all duration-200"
      >
        <Send className="w-4 h-4" />
      </Button>

      {/* Share Action */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onShareClick}
        className="h-9 px-3 text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-all duration-200"
      >
        <Share className="w-4 h-4" />
      </Button>
    </div>
  );
}