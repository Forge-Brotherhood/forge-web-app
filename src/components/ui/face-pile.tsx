"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface FacePileMember {
  userId: string;
  user?: {
    id: string;
    displayName?: string;
    firstName?: string;
    profileImageUrl?: string | null;
  };
}

interface FacePileProps {
  members: FacePileMember[];
  maxVisible?: number;
  avatarSize?: number;
  overlap?: number;
  className?: string;
}

export function FacePile({
  members,
  maxVisible = 3,
  avatarSize = 32,
  overlap = 10,
  className,
}: FacePileProps) {
  const visibleMembers = members.slice(0, maxVisible);
  const overflowCount = Math.max(0, members.length - maxVisible);
  const hasOverflow = overflowCount > 0;

  // Calculate total width: first avatar full width + (remaining avatars * (size - overlap))
  const itemCount = visibleMembers.length + (hasOverflow ? 1 : 0);
  const totalWidth = itemCount > 0
    ? avatarSize + (itemCount - 1) * (avatarSize - overlap)
    : 0;

  const getInitials = (member: FacePileMember) => {
    const name = member.user?.displayName || member.user?.firstName || "?";
    return name.substring(0, 2).toUpperCase();
  };

  const getName = (member: FacePileMember) => {
    return member.user?.displayName || member.user?.firstName || "Member";
  };

  if (members.length === 0) return null;

  return (
    <div
      className={cn("relative flex-shrink-0", className)}
      style={{ width: totalWidth, height: avatarSize }}
    >
      {visibleMembers.map((member, index) => (
        <Avatar
          key={member.userId}
          className="ring-2 ring-background absolute"
          style={{
            width: avatarSize,
            height: avatarSize,
            left: index * (avatarSize - overlap),
            zIndex: visibleMembers.length - index + 1,
          }}
        >
          {member.user?.profileImageUrl && (
            <AvatarImage
              src={member.user.profileImageUrl}
              alt={getName(member)}
            />
          )}
          <AvatarFallback
            className="text-xs font-medium"
            style={{ fontSize: avatarSize * 0.35 }}
          >
            {getInitials(member)}
          </AvatarFallback>
        </Avatar>
      ))}
      {hasOverflow && (
        <div
          className="flex items-center justify-center rounded-full bg-muted ring-2 ring-background font-semibold text-muted-foreground absolute"
          style={{
            width: avatarSize,
            height: avatarSize,
            left: visibleMembers.length * (avatarSize - overlap),
            fontSize: avatarSize * 0.35,
            zIndex: 0,
          }}
        >
          +{overflowCount}
        </div>
      )}
    </div>
  );
}
