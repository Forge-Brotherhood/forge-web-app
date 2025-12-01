"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import {
  MoreHorizontal,
  Share2,
  Pencil,
  Trash2,
  LogOut,
  Loader2,
  Copy,
  Check,
  ChevronRight,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { UnifiedFeed } from "@/components/unified-feed";
import { useGroupFeed } from "@features/groups";
import { useCreateThreadMutation } from "@features/prayer";
import { useProfile, profileKeys } from "@/core/hooks/useProfile";
import { forgeApi } from "@/core/api/forgeApiClient";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { FacePile } from "@/components/ui/face-pile";
import { BackButton } from "@/components/ui/back-button";
import { cn } from "@/lib/utils";

interface GroupDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function GroupDetailPage({ params }: GroupDetailPageProps) {
  const { id: groupId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { userId, isLoaded: isAuthLoaded } = useAuth();
  const { profile, getActiveGroups, isLoadingProfile } = useProfile();

  // Find the group in user's memberships
  const memberships = getActiveGroups();
  const membership = memberships.find((m) => m.groupId === groupId);
  const group = membership?.group;
  const isMember = !!membership;

  // Get members directly from group (included in profile API response)
  const members = group?.members ?? [];

  // Fetch feed for this specific group
  const feed = useGroupFeed(20, true, groupId);

  // Dialog states
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
  const [isCannotLeaveDialogOpen, setIsCannotLeaveDialogOpen] = useState(false);
  const [isMemberListOpen, setIsMemberListOpen] = useState(false);
  const [isCreatePrayerOpen, setIsCreatePrayerOpen] = useState(false);

  // Create prayer state
  const [prayerTitle, setPrayerTitle] = useState("");
  const [prayerContent, setPrayerContent] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const createThreadMutation = useCreateThreadMutation();

  // Share state
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // Loading states
  const [isSharing, setIsSharing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState(group?.name || "");

  // Update edit name when group loads
  useEffect(() => {
    if (group?.name) {
      setEditName(group.name);
    }
  }, [group?.name]);

  // Permission logic
  const currentUserId = profile?.id;
  const isLeader = membership?.role === "leader";

  // Creator is the first leader by join date
  const leaders = members.filter((m) => m.role === "leader");
  const sortedLeaders = [...leaders].sort(
    (a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
  );
  const isCreator = isLeader && sortedLeaders[0]?.userId === currentUserId;

  // Can leave: not sole leader with other members
  const otherMembers = members.filter((m) => m.userId !== currentUserId);
  const hasOtherLeaders = leaders.some((l) => l.userId !== currentUserId);
  const canLeave = !isLeader || hasOtherLeaders || otherMembers.length === 0;

  // Handlers
  const handleShareClick = async () => {
    setIsShareDialogOpen(true);
    setShareUrl(null);
    setIsCopied(false);
    setIsSharing(true);
    try {
      const response = await forgeApi.createGroupShareLink(groupId);
      setShareUrl(response.url);
    } catch (err) {
      toast({
        title: "Failed to generate link",
        description: "Please try again.",
        variant: "destructive",
      });
      setIsShareDialogOpen(false);
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      toast({
        title: "Link copied",
        description: "Share link has been copied to clipboard.",
      });
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      toast({
        title: "Failed to copy",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUpdate = async () => {
    if (!editName.trim()) return;

    setIsUpdating(true);
    try {
      await forgeApi.updateGroup(groupId, { name: editName.trim() });
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast({
        title: "Group updated",
        description: "Group name has been updated.",
      });
      setIsEditDialogOpen(false);
    } catch (err) {
      toast({
        title: "Failed to update group",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await forgeApi.deleteGroup(groupId);
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast({
        title: "Group deleted",
        description: "The group has been deleted.",
      });
      router.push("/groups");
    } catch (err) {
      toast({
        title: "Failed to delete group",
        description: "Please try again.",
        variant: "destructive",
      });
      setIsDeleting(false);
    }
  };

  const handleLeave = async () => {
    setIsLeaving(true);
    try {
      await forgeApi.leaveGroup(groupId);
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      toast({
        title: "Left group",
        description: "You have left the group.",
      });
      router.push("/groups");
    } catch (err) {
      toast({
        title: "Failed to leave group",
        description: "Please try again.",
        variant: "destructive",
      });
      setIsLeaving(false);
    }
  };

  const handleLeaveClick = () => {
    if (canLeave) {
      setIsLeaveDialogOpen(true);
    } else {
      setIsCannotLeaveDialogOpen(true);
    }
  };

  const handleCreatePrayer = async () => {
    if (!prayerContent.trim()) return;

    try {
      await createThreadMutation.mutateAsync({
        groupId: groupId,
        title: prayerTitle.trim() || undefined,
        content: prayerContent.trim(),
        isAnonymous: isAnonymous,
        sharedToCommunity: false,
        postKind: "request",
      });

      // Reset form and close dialog
      setPrayerTitle("");
      setPrayerContent("");
      setIsAnonymous(false);
      setIsCreatePrayerOpen(false);

      toast({
        title: "Prayer request posted",
        description: "Your prayer has been shared with the group.",
      });
    } catch (err) {
      toast({
        title: "Failed to post prayer",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCloseCreatePrayer = () => {
    setIsCreatePrayerOpen(false);
    setPrayerTitle("");
    setPrayerContent("");
    setIsAnonymous(false);
  };

  // Loading state - check both auth loading and profile loading
  if (!isAuthLoaded || isLoadingProfile) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            <BackButton fallbackPath="/groups" />
          </div>
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    );
  }

  // Not found state (don't distinguish between "not found" and "not a member")
  if (!isMember) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            <BackButton fallbackPath="/groups" />
          </div>
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Group Not Found
            </h2>
            <p className="text-muted-foreground max-w-sm">
              This group doesn&apos;t exist or you don&apos;t have access to it.
            </p>
            <Button
              variant="outline"
              onClick={() => router.push("/groups")}
              className="mt-6"
            >
              Back to Groups
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Navigation Bar */}
        <div className="flex items-center gap-3 mb-4">
          <BackButton fallbackPath="/groups" />
          <div className="flex-1" />

          {/* Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "p-2 rounded-xl transition-colors duration-200",
                  "hover:bg-accent/10 text-muted-foreground hover:text-foreground"
                )}
                aria-label="Group options"
              >
                {isSharing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <MoreHorizontal className="w-5 h-5" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleShareClick} disabled={isSharing}>
                <Share2 className="w-4 h-4 mr-2" />
                Share Group
              </DropdownMenuItem>

              {isLeader && (
                <DropdownMenuItem onClick={() => setIsEditDialogOpen(true)}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit Group
                </DropdownMenuItem>
              )}

              {isCreator && (
                <DropdownMenuItem
                  onClick={() => setIsDeleteDialogOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Group
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={handleLeaveClick}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Leave Group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Hero Section */}
        <div className="flex flex-col items-center text-center mb-8 pt-2">
          {/* Group Name */}
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {group?.name || "Group"}
          </h1>

          {/* Description */}
          {group?.description && (
            <p className="text-muted-foreground mb-4 max-w-md">
              {group.description}
            </p>
          )}

          {/* Tappable Facepile with Member Count */}
          {members.length > 0 && (
            <button
              onClick={() => setIsMemberListOpen(true)}
              className={cn(
                "flex items-center gap-2 py-2 px-3 rounded-full",
                "hover:bg-accent/10 transition-colors duration-200"
              )}
            >
              <FacePile
                members={members}
                maxVisible={4}
                avatarSize={32}
                overlap={10}
              />
              <span className="text-sm text-muted-foreground">
                {members.length} {members.length === 1 ? "member" : "members"}
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Feed */}
        <UnifiedFeed feed={feed} />
      </div>

      {/* FAB - Create Prayer */}
      <button
        onClick={() => setIsCreatePrayerOpen(true)}
        className={cn(
          "fixed right-6 w-14 h-14 rounded-full",
          "bg-primary text-primary-foreground shadow-lg",
          "hover:bg-primary/90 transition-colors",
          "flex items-center justify-center",
          "z-50",
          "bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-6"
        )}
        aria-label="Create prayer request"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Share Group Dialog */}
      <Dialog open={isShareDialogOpen} onOpenChange={setIsShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Group</DialogTitle>
            <DialogDescription>
              Invite others to join {group?.name || "this group"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Members FacePile */}
            {members.length > 0 && (
              <div className="flex flex-col items-center gap-2">
                <FacePile
                  members={members}
                  maxVisible={5}
                  avatarSize={40}
                  overlap={12}
                />
                <p className="text-sm text-muted-foreground">
                  {members.length} {members.length === 1 ? "member" : "members"}
                </p>
              </div>
            )}

            {/* Share Link */}
            {isSharing ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : shareUrl ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={shareUrl}
                    readOnly
                    className="flex-1 text-sm bg-muted"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyLink}
                    className="shrink-0"
                  >
                    {isCopied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  This link expires in 7 days
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              onClick={handleCopyLink}
              disabled={!shareUrl || isSharing}
              className="w-full"
            >
              {isCopied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Link
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-group-name">Group Name</Label>
              <Input
                id="edit-group-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editName.trim()) {
                    handleUpdate();
                  }
                }}
                disabled={isUpdating}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={!editName.trim() || isUpdating}
            >
              {isUpdating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Group Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Group</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this group? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave Group Dialog */}
      <Dialog open={isLeaveDialogOpen} onOpenChange={setIsLeaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave Group</DialogTitle>
            <DialogDescription>
              Are you sure you want to leave this group?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsLeaveDialogOpen(false)}
              disabled={isLeaving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleLeave}
              disabled={isLeaving}
            >
              {isLeaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Leaving...
                </>
              ) : (
                "Leave"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cannot Leave Dialog */}
      <Dialog
        open={isCannotLeaveDialogOpen}
        onOpenChange={setIsCannotLeaveDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cannot Leave Group</DialogTitle>
            <DialogDescription>
              You are the only leader in this group. Please assign another
              leader before leaving, or delete the group.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setIsCannotLeaveDialogOpen(false)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Member List Dialog */}
      <Dialog open={isMemberListOpen} onOpenChange={setIsMemberListOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Members</DialogTitle>
            <DialogDescription>
              {members.length} {members.length === 1 ? "member" : "members"} in this group
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto -mx-6 px-6">
            <div className="space-y-1">
              {members.map((member) => {
                const displayName =
                  member.user?.displayName ||
                  member.user?.firstName ||
                  "Member";
                const initials = displayName.substring(0, 2).toUpperCase();
                const isLeaderMember = member.role === "leader";

                return (
                  <div
                    key={member.userId}
                    className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-accent/5"
                  >
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                        {member.user?.profileImageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={member.user.profileImageUrl}
                            alt={displayName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-sm font-medium text-muted-foreground">
                            {initials}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {displayName}
                      </p>
                      {isLeaderMember && (
                        <p className="text-xs text-muted-foreground">Leader</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Prayer Dialog */}
      <Dialog open={isCreatePrayerOpen} onOpenChange={setIsCreatePrayerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Prayer Request</DialogTitle>
            <DialogDescription>
              Share your prayer request with {group?.name || "the group"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Title (optional) */}
            <div className="space-y-2">
              <Label htmlFor="prayer-title">Title (optional)</Label>
              <Input
                id="prayer-title"
                placeholder="Brief title for your prayer"
                value={prayerTitle}
                onChange={(e) => setPrayerTitle(e.target.value)}
                disabled={createThreadMutation.isPending}
              />
            </div>

            {/* Prayer Content */}
            <div className="space-y-2">
              <Label htmlFor="prayer-content">Prayer Request</Label>
              <Textarea
                id="prayer-content"
                placeholder="What would you like prayer for?"
                value={prayerContent}
                onChange={(e) => setPrayerContent(e.target.value)}
                disabled={createThreadMutation.isPending}
                className="min-h-[120px] resize-none"
              />
            </div>

            {/* Anonymous Toggle */}
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label htmlFor="anonymous-toggle">Post anonymously</Label>
                <p className="text-xs text-muted-foreground">
                  Your name won&apos;t be shown to others
                </p>
              </div>
              <Switch
                id="anonymous-toggle"
                checked={isAnonymous}
                onCheckedChange={setIsAnonymous}
                disabled={createThreadMutation.isPending}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCloseCreatePrayer}
              disabled={createThreadMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreatePrayer}
              disabled={!prayerContent.trim() || createThreadMutation.isPending}
            >
              {createThreadMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Posting...
                </>
              ) : (
                "Post Prayer"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
