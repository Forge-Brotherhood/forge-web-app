"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Users, Star, ChevronRight, Plus, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useProfile, profileKeys } from "@/core/hooks/useProfile";
import { forgeApi } from "@/core/api/forgeApiClient";
import { EmptyState } from "@/components/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { APIGroupMembership } from "@/core/models/apiModels";

// Loading skeleton for group cards
function GroupCardSkeleton() {
  return (
    <div className="p-4 rounded-xl bg-card shadow-sm dark:shadow-none animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-muted flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 bg-muted rounded" />
          <div className="h-3 w-24 bg-muted rounded" />
        </div>
        <div className="w-5 h-5 bg-muted rounded" />
      </div>
    </div>
  );
}

// Group card component
function GroupCard({
  membership,
  onClick
}: {
  membership: APIGroupMembership;
  onClick: () => void;
}) {
  const group = membership.group;
  if (!group) return null;

  const isCore = group.groupType === 'core';

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-4 rounded-xl bg-card shadow-sm dark:shadow-none",
        "hover:bg-accent/5 transition-colors duration-200",
        "focus:outline-none focus:ring-2 focus:ring-accent/20",
        "flex items-center gap-3 text-left"
      )}
    >
      {/* Icon */}
      <div className={cn(
        "w-10 h-10 rounded-full flex items-center justify-center",
        isCore
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
      )}>
        {isCore ? (
          <Star className="w-5 h-5" />
        ) : (
          <Users className="w-5 h-5" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground truncate">
            {group.name || 'Unnamed Group'}
          </span>
          {isCore && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              Core
            </span>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {membership.role === 'leader' ? 'Leader' : 'Member'}
        </span>
      </div>

      {/* Chevron */}
      <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

export default function GroupsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isLoaded: isAuthLoaded } = useAuth();
  const {
    isLoadingProfile,
    getCoreGroups,
    getCircleGroups,
    error
  } = useProfile();

  // Combined loading state - check both auth and profile loading
  const isLoading = !isAuthLoaded || isLoadingProfile;

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const coreGroups = getCoreGroups();
  const circleGroups = getCircleGroups();
  const allGroups = [...coreGroups, ...circleGroups];
  const isEmpty = !isLoading && allGroups.length === 0;

  const handleGroupClick = (groupId: string) => {
    router.push(`/groups/${groupId}`);
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) return;

    setIsCreating(true);
    try {
      const newGroup = await forgeApi.createGroup({
        name: groupName.trim(),
        groupType: "circle",
      });

      // Invalidate profile to refresh groups list
      queryClient.invalidateQueries({ queryKey: profileKeys.all });

      toast({
        title: "Group created",
        description: `"${newGroup.name}" has been created.`,
      });

      setIsCreateDialogOpen(false);
      setGroupName("");

      // Navigate to the new group
      router.push(`/groups/${newGroup.id}`);
    } catch (err) {
      toast({
        title: "Failed to create group",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-foreground">
            Groups
          </h1>
          <button
            onClick={() => setIsCreateDialogOpen(true)}
            className={cn(
              "p-2 rounded-xl transition-colors duration-200",
              "hover:bg-accent/10 text-muted-foreground hover:text-foreground"
            )}
            aria-label="Create group"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-3">
            <GroupCardSkeleton />
            <GroupCardSkeleton />
            <GroupCardSkeleton />
          </div>
        )}

        {/* Empty State */}
        {isEmpty && !error && (
          <EmptyState
            icon={Users}
            title="No Groups Yet"
            message="Create a group to start sharing prayer requests with others."
            action={{
              label: "Create Group",
              onClick: () => setIsCreateDialogOpen(true),
            }}
          />
        )}

        {/* Error State */}
        {error && (
          <EmptyState
            icon={Users}
            title="Failed to Load"
            message={error}
          />
        )}

        {/* Groups List */}
        {!isLoading && !isEmpty && !error && (
          <div className="space-y-3">
            {/* Core Groups */}
            {coreGroups.length > 0 && (
              <>
                {coreGroups.map((membership) => (
                  <GroupCard
                    key={membership.groupId}
                    membership={membership}
                    onClick={() => handleGroupClick(membership.groupId)}
                  />
                ))}
              </>
            )}

            {/* Circle Groups */}
            {circleGroups.length > 0 && (
              <>
                {circleGroups.map((membership) => (
                  <GroupCard
                    key={membership.groupId}
                    membership={membership}
                    onClick={() => handleGroupClick(membership.groupId)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Group Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                placeholder="Enter group name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && groupName.trim()) {
                    handleCreateGroup();
                  }
                }}
                disabled={isCreating}
                autoFocus
              />
            </div>
            <Button
              onClick={handleCreateGroup}
              disabled={!groupName.trim() || isCreating}
              className="w-full"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Group"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
