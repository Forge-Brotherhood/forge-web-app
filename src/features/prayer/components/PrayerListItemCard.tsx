"use client";

import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@core/models/models";

interface PrayerListItemCardProps {
  // Data
  item: FeedItem;

  // Behavior
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;

  // Slots for composition
  headerAction?: React.ReactNode;
  contentExtra?: React.ReactNode;
  footerAction?: React.ReactNode;

  // Display options
  contentLineClamp?: number;
  showTimestamp?: boolean;
  className?: string;
}

// Status chip component - exported for use in other components
export function StatusChip({ status }: { status: string }) {
  const statusStyles = {
    open: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    answered: "bg-green-500/15 text-green-600 dark:text-green-400",
    archived: "bg-muted text-muted-foreground",
  };

  const style = statusStyles[status as keyof typeof statusStyles] || statusStyles.open;

  return (
    <span
      className={cn(
        "px-2 py-1 rounded-full text-[10px] font-medium capitalize",
        style
      )}
    >
      {status === "answered" ? "Answered" : status}
    </span>
  );
}

export function PrayerListItemCard({
  item,
  onClick,
  onMouseEnter,
  onMouseLeave,
  headerAction,
  contentExtra,
  footerAction,
  contentLineClamp = 2,
  showTimestamp = true,
  className,
}: PrayerListItemCardProps) {
  const router = useRouter();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      router.push(`/threads/${item.id}`);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const displayName = item.isAnonymous ? "Anonymous" : item.userName;

  return (
    <div
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        "w-full text-left p-4 rounded-xl bg-card cursor-pointer",
        "shadow-sm dark:shadow-none", // Subtle shadow in light mode
        "hover:bg-accent/5 transition-colors duration-200",
        "focus:outline-none focus:ring-2 focus:ring-accent/20",
        className
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <Avatar className="w-8 h-8 flex-shrink-0">
          {!item.isAnonymous && item.userAvatar ? (
            <AvatarImage src={item.userAvatar} alt={displayName} />
          ) : null}
          <AvatarFallback className="text-xs bg-accent/20 text-accent">
            {item.isAnonymous ? "?" : getInitials(displayName)}
          </AvatarFallback>
        </Avatar>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header row with optional action */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-foreground truncate">
                {displayName}
              </span>
              {showTimestamp && (
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                </span>
              )}
            </div>
            {headerAction}
          </div>

          {/* Title if exists */}
          {item.title && (
            <p className="text-sm font-medium text-foreground mb-1 line-clamp-1">
              {item.title}
            </p>
          )}

          {/* Content preview */}
          <p
            className={cn(
              "text-sm text-muted-foreground",
              contentLineClamp && `line-clamp-${contentLineClamp}`
            )}
          >
            {item.content}
          </p>

          {/* Content extra slot */}
          {contentExtra}

          {/* Footer action slot */}
          {footerAction && (
            <div className="mt-3" onClick={(e) => e.stopPropagation()}>
              {footerAction}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
