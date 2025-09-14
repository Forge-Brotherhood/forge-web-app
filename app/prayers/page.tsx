"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { UnifiedFeed } from "@/components/unified-feed";
import { usePrayerFeed } from "@/hooks/use-prayer-list-query";
import { PrayNowButton } from "@/components/pray-now-button";
import { PrayerExperienceNew } from "@/components/prayer-experience-new";

type FilterType = "all" | "community" | "groups";

export default function BookmarkedPrayers() {
  const feed = usePrayerFeed(20);
  const [isPrayerExperienceOpen, setIsPrayerExperienceOpen] = useState(false);

  const stats = useMemo(() => {
    const total = feed.items.length;
    const community = feed.items.filter(p => p.sharedToCommunity).length;
    const groups = feed.items.filter(p => p.groupId && !p.sharedToCommunity).length;
    return { total, community, groups };
  }, [feed.items]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-foreground mb-2 flex items-center gap-2">
            My Prayers
          </h1>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          <Card 
            className={cn(
              "p-3 sm:p-4 text-center cursor-pointer transition-all duration-200",
              "bg-card/50 backdrop-blur-sm border-border/50",
              "bg-accent/20 text-accent border-accent/40"
            )}
          >
            <p className={cn(
              "text-lg sm:text-2xl font-bold mb-0.5",
              "text-accent"
            )}>{stats.total}</p>
            <p className={cn(
              "text-[10px] sm:text-xs",
              "text-accent/80"
            )}>All</p>
          </Card>
          <Card 
            className={cn(
              "p-3 sm:p-4 text-center cursor-pointer transition-all duration-200",
              "bg-card/50 backdrop-blur-sm border-border/50",
              ""
            )}
          >
            <p className={cn(
              "text-lg sm:text-2xl font-bold mb-0.5",
              "text-blue-600 dark:text-blue-400"
            )}>{stats.community}</p>
            <p className={cn(
              "text-[10px] sm:text-xs",
              "text-muted-foreground"
            )}>Community</p>
          </Card>
          <Card 
            className={cn(
              "p-3 sm:p-4 text-center cursor-pointer transition-all duration-200",
              "bg-card/50 backdrop-blur-sm border-border/50",
              ""
            )}
          >
            <p className={cn(
              "text-lg sm:text-2xl font-bold mb-0.5",
              "text-green-600 dark:text-green-400"
            )}>{stats.groups}</p>
            <p className={cn(
              "text-[10px] sm:text-xs",
              "text-muted-foreground"
            )}>Groups</p>
          </Card>
        </div>

        {/* Pray Now Button */}
        <PrayNowButton
          onClick={() => setIsPrayerExperienceOpen(true)}
          disabled={stats.total === 0}
          prayerCount={stats.total}
        />

        {/* Feed */}
        <UnifiedFeed feed={feed} />
      </div>

      {/* Prayer Experience Fullscreen */}
      <PrayerExperienceNew
        isOpen={isPrayerExperienceOpen}
        onClose={() => setIsPrayerExperienceOpen(false)}
      />
    </div>
  );
}