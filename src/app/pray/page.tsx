"use client";

import { useState } from "react";
import { Bookmark } from "lucide-react";
import { usePrayerFeed } from "@features/prayer";
import { PrayerListItemCard, StartSessionButton } from "@features/prayer/components";
import { EmptyState } from "@/components/empty-state";
import { PrayerExperienceNew } from "@/components/prayer-experience-new";
import { cn } from "@/lib/utils";

// Loading skeleton for prayer cards
function PrayerCardSkeleton() {
  return (
    <div className="p-4 rounded-xl bg-card shadow-sm dark:shadow-none animate-pulse">
      <div className="flex items-start gap-3">
        {/* Avatar skeleton */}
        <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0" />

        {/* Content skeleton */}
        <div className="flex-1 space-y-2">
          {/* Header */}
          <div className="flex items-center gap-2">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-3 w-16 bg-muted rounded" />
          </div>

          {/* Content lines */}
          <div className="h-4 w-full bg-muted rounded" />
          <div className="h-4 w-3/4 bg-muted rounded" />

          {/* Timestamp */}
          <div className="h-3 w-20 bg-muted rounded mt-2" />
        </div>
      </div>
    </div>
  );
}

export default function PrayPage() {
  const feed = usePrayerFeed(20);
  const [isPrayerExperienceOpen, setIsPrayerExperienceOpen] = useState(false);

  const { items, isLoading, error, hasMore, loadMore, isLoadingMore } = feed;
  const isEmpty = !isLoading && items.length === 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">
            Pray
          </h1>
        </div>

        {/* Start Session Button */}
        <div className="mb-6">
          <StartSessionButton
            onClick={() => setIsPrayerExperienceOpen(true)}
            disabled={isLoading}
            prayerCount={items.length}
          />
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-3">
            <PrayerCardSkeleton />
            <PrayerCardSkeleton />
            <PrayerCardSkeleton />
          </div>
        )}

        {/* Empty State */}
        {isEmpty && !error && (
          <EmptyState
            icon={Bookmark}
            title="No Prayers Saved"
            message="Save prayers from the community or your group to build your personal prayer list."
          />
        )}

        {/* Error State */}
        {error && (
          <EmptyState
            icon={Bookmark}
            title="Failed to Load"
            message={error}
            action={{
              label: "Try Again",
              onClick: () => feed.refetch(),
            }}
          />
        )}

        {/* Prayer List */}
        {!isLoading && !isEmpty && !error && (
          <div className="space-y-3">
            {items.map((item) => (
              <PrayerListItemCard key={item.id} item={item} />
            ))}

            {/* Load More */}
            {hasMore && (
              <button
                onClick={() => loadMore()}
                disabled={isLoadingMore}
                className={cn(
                  "w-full py-3 text-sm text-muted-foreground",
                  "hover:text-foreground transition-colors",
                  "disabled:opacity-50"
                )}
              >
                {isLoadingMore ? "Loading..." : "Load more"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Prayer Experience Modal */}
      <PrayerExperienceNew
        isOpen={isPrayerExperienceOpen}
        onClose={() => setIsPrayerExperienceOpen(false)}
      />
    </div>
  );
}
