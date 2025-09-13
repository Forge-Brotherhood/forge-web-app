"use client";
import { UnifiedFeed } from "@/components/unified-feed";
import { useCommunityFeed } from "@/hooks/use-community-feed-query";

export default function CommunityPage() {
  const feed = useCommunityFeed("all", 20);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="mb-8">
          <h1 className="text-foreground mb-2 flex items-center gap-2">
            Community
          </h1>
        </div>
        <UnifiedFeed feed={feed} />
      </div>
    </div>
  );
}