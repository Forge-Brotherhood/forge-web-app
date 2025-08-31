"use client";

import { useState } from "react";
import { FeedCard, type PrayerRequest } from "@/components/feed-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Users, Trophy, Flame, BookOpen, Mic, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

// Mock data for group prayers
const mockGroupPrayers: PrayerRequest[] = [
  {
    id: "g1",
    userId: "user5",
    userName: "John Davis",
    userAvatar: undefined,
    isAnonymous: false,
    content: "Brothers, I need accountability in my struggle with consistency in daily devotions. I want to grow closer to God but keep falling short. Please pray for discipline and a hunger for His Word.",
    createdAt: new Date(Date.now() - 1000 * 60 * 45), // 45 minutes ago
    prayerCount: 8,
    encouragementCount: 5,
    isFollowing: true,
    hasPrayed: true,
    hasEncouraged: false,
    voiceNoteUrl: "/voice/note1.mp3",
    streakDays: 12,
  },
  {
    id: "g2",
    userId: "user6",
    userName: "Mark Thompson",
    isAnonymous: false,
    content: "Praise report! Got the job I've been praying for. God showed up in a big way. Thank you all for standing with me in prayer these past 3 months. Let's celebrate God's faithfulness! 🎉",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3), // 3 hours ago
    prayerCount: 12,
    encouragementCount: 10,
    isFollowing: true,
    hasPrayed: false,
    hasEncouraged: true,
    updateStatus: "answered",
    scriptureReference: "Philippians 4:19 - And my God will meet all your needs according to the riches of his glory in Christ Jesus.",
    streakDays: 45,
  },
  {
    id: "g3",
    userId: "user7",
    userName: "Alex Chen",
    isAnonymous: false,
    content: "Marriage is going through a rough patch. We're both believers but communication has broken down. Meeting with our pastor next week. Please pray for wisdom, patience, and healing in our relationship.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12), // 12 hours ago
    prayerCount: 10,
    encouragementCount: 8,
    isFollowing: true,
    hasPrayed: true,
    hasEncouraged: true,
    voiceNoteUrl: "/voice/note2.mp3",
    streakDays: 7,
  },
];

interface GroupMember {
  id: string;
  name: string;
  avatar?: string;
  streakDays: number;
  isOnline: boolean;
}

const mockGroupMembers: GroupMember[] = [
  { id: "1", name: "John Davis", streakDays: 12, isOnline: true },
  { id: "2", name: "Mark Thompson", streakDays: 45, isOnline: true },
  { id: "3", name: "Alex Chen", streakDays: 7, isOnline: false },
  { id: "4", name: "David Kim", streakDays: 23, isOnline: true },
  { id: "5", name: "James Wilson", streakDays: 3, isOnline: false },
  { id: "6", name: "Ryan Moore", streakDays: 31, isOnline: true },
];

export default function GroupFeed() {
  const [prayers] = useState<PrayerRequest[]>(mockGroupPrayers);
  const [activeTab, setActiveTab] = useState<"feed" | "members">("feed");

  const handlePray = (id: string) => {
    console.log("Praying for:", id);
  };

  const handleEncourage = (id: string) => {
    console.log("Encouraging:", id);
  };

  const handleFollow = (id: string) => {
    console.log("Following:", id);
  };



  const groupStats = {
    totalMembers: mockGroupMembers.length,
    onlineNow: mockGroupMembers.filter(m => m.isOnline).length,
    groupStreak: Math.max(...mockGroupMembers.map(m => m.streakDays)),
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-foreground mb-2">Core Group</h1>
        </div>

        {/* Group Stats */}
        <Card className="p-6 mb-8 bg-card/50 backdrop-blur-sm border-border/50">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <Users className="h-5 w-5 text-accent" />
              </div>
              <p className="text-2xl font-bold text-foreground">{groupStats.totalMembers}</p>
              <p className="text-xs text-muted-foreground">Members</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <Flame className="h-5 w-5 text-amber-400" />
              </div>
              <p className="text-2xl font-bold text-foreground">{groupStats.onlineNow}</p>
              <p className="text-xs text-muted-foreground">Active Now</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
              </div>
              <p className="text-2xl font-bold text-foreground">{groupStats.groupStreak}d</p>
              <p className="text-xs text-muted-foreground">Best Streak</p>
            </div>
          </div>
        </Card>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-secondary/30 p-1 rounded-lg">
          <Button
            variant={activeTab === "feed" ? "default" : "ghost"}
            size="default"
            onClick={() => setActiveTab("feed")}
            className={cn(
              "flex-1 h-9 transition-all duration-200 text-xs sm:text-sm font-medium gap-1 px-2 sm:px-3",
              activeTab === "feed" 
                ? "bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:border-accent/60" 
                : "hover:bg-secondary/50 hover:border-accent/30 hover:text-foreground"
            )}
          >
            <BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Prayer Feed</span>
            <span className="sm:hidden">Feed</span>
          </Button>
          <Button
            variant={activeTab === "members" ? "default" : "ghost"}
            size="default"
            onClick={() => setActiveTab("members")}
            className={cn(
              "flex-1 h-9 transition-all duration-200 text-xs sm:text-sm font-medium gap-1 px-2 sm:px-3",
              activeTab === "members" 
                ? "bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:border-accent/60" 
                : "hover:bg-secondary/50 hover:border-accent/30 hover:text-foreground"
            )}
          >
            <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Members
          </Button>
        </div>

        {/* Content */}
        {activeTab === "feed" ? (
          <div className="space-y-6">
            {/* Voice Prayer Button */}
            <Card className="p-4 bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:border-accent/60 transition-all duration-200 cursor-pointer">
              <div className="flex items-center justify-center gap-2">
                <Mic className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                <span className="font-medium text-sm sm:text-base">Record voice prayer</span>
              </div>
            </Card>

            {/* Prayer Feed */}
            {prayers.map((prayer) => (
              <FeedCard
                key={prayer.id}
                prayer={prayer}
                onPray={handlePray}
                onEncourage={handleEncourage}
                onFollow={handleFollow}
                showGroupFeatures={true}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {mockGroupMembers.map((member) => (
              <Card key={member.id} className="p-5 bg-card/50 backdrop-blur-sm border-border/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <div className="w-12 h-12 bg-secondary rounded-full flex items-center justify-center">
                        <span className="text-sm font-semibold">
                          {member.name.split(' ').map(n => n[0]).join('')}
                        </span>
                      </div>
                      {member.isOnline && (
                        <Circle className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 fill-green-500 rounded-full border-2 border-background" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{member.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {member.isOnline ? "Online" : "Offline"}
                      </p>
                    </div>
                  </div>
                  <Badge className="forge-amber-subtle flex items-center space-x-1.5 px-3">
                    <Flame className="h-3.5 w-3.5" />
                    <span className="font-medium">{member.streakDays}d</span>
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
