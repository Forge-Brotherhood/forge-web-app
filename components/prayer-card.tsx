"use client";

import { Heart, MessageCircle, MoreHorizontal } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

interface PrayerCardProps {
  id: string;
  author: {
    name: string;
  };
  content: string;
  prayerCount: number;
  commentCount: number;
  createdAt: string;
  isAnonymous?: boolean;
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
  }
  return name.charAt(0).toUpperCase();
}

export function PrayerCard({
  id,
  author,
  content,
  prayerCount,
  commentCount,
  createdAt,
  isAnonymous = false,
}: PrayerCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center space-y-0 pb-3">
        <div className="flex items-center space-x-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback>
              {isAnonymous ? "?" : getInitials(author.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium leading-none">
              {isAnonymous ? "Anonymous" : author.name}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{createdAt}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="ml-auto h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        <p className="text-sm leading-6">{content}</p>
      </CardContent>
      <CardFooter className="flex justify-between pt-0">
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2">
          <Heart className="h-4 w-4 mr-1" />
          <span className="text-sm">{prayerCount}</span>
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -mr-2">
          <MessageCircle className="h-4 w-4 mr-1" />
          <span className="text-sm">{commentCount}</span>
        </Button>
      </CardFooter>
    </Card>
  );
}