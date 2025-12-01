"use client";

import { useState } from "react";
import { BellOff } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

type ActivityFilter = "forYou" | "groups";

export default function ActivityPage() {
  const [filter, setFilter] = useState<ActivityFilter>("forYou");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">
            Activity
          </h1>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setFilter("forYou")}
            disabled
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-medium transition-colors duration-200",
              filter === "forYou"
                ? "bg-accent text-accent-foreground"
                : "bg-card text-muted-foreground",
              "opacity-50 cursor-not-allowed"
            )}
          >
            For You
          </button>
          <button
            onClick={() => setFilter("groups")}
            disabled
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-medium transition-colors duration-200",
              filter === "groups"
                ? "bg-accent text-accent-foreground"
                : "bg-card text-muted-foreground",
              "opacity-50 cursor-not-allowed"
            )}
          >
            Groups
          </button>
        </div>

        {/* Coming Soon Empty State */}
        <EmptyState
          icon={BellOff}
          title="No Activity Yet"
          message="Activity feed coming soon! Check back for updates on prayers, encouragements, and testimonies."
        />
      </div>
    </div>
  );
}
