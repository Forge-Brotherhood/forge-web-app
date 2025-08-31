"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Heart, MessageCircle, Send, ArrowLeft, Trash2, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { PrayerThreadDropdown } from "@/components/prayer-thread-dropdown";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { FeedCard, type PrayerRequest } from "@/components/feed-card";

interface User {
  id: string;
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
}

interface ThreadEntry {
  id: string;
  body: string;
  createdAt: string;
  author: User;
  type: 'encouragement' | 'update';
}

interface Encouragement {
  id: string;
  body: string;
  createdAt: string;
  author: User;
}

interface ThreadUpdate {
  id: string;
  body: string;
  createdAt: string;
  author: User;
}

interface PrayerThread {
  id: string;
  title: string;
  body: string;
  tags: string[];
  status: string;
  isAnonymous: boolean;
  createdAt: string;
  expiresAt: string;
  author: User | null;
  encouragements: Encouragement[];
  updates: ThreadUpdate[];
  _count: {
    prayers: number;
    encouragements: number;
    updates: number;
  };
}

interface PrayerStatus {
  hasPrayed: boolean;
  prayerCount: number;
}

interface Props {
  thread: PrayerThread;
  currentUser: User | null;
  initialPrayerStatus: PrayerStatus;
}

export function ThreadDetail({ thread, currentUser, initialPrayerStatus }: Props) {
  const [prayerStatus, setPrayerStatus] = useState(initialPrayerStatus);
  const [encouragementText, setEncouragementText] = useState("");
  const [isSubmittingEncouragement, setIsSubmittingEncouragement] = useState(false);
  const [showEncouragementForm, setShowEncouragementForm] = useState(false);
  const [isSubmittingPrayer, setIsSubmittingPrayer] = useState(false);
  const [encouragements, setEncouragements] = useState(thread.encouragements);
  const [updates, setUpdates] = useState(thread.updates);

  // Create combined thread entries sorted by creation date
  const threadEntries: ThreadEntry[] = [...encouragements.map(e => ({...e, type: 'encouragement' as const})), ...updates.map(u => ({...u, type: 'update' as const}))]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const [updateText, setUpdateText] = useState("");
  const [isSubmittingUpdate, setIsSubmittingUpdate] = useState(false);
  const [deletingEncouragement, setDeletingEncouragement] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [encouragementToDelete, setEncouragementToDelete] = useState<Encouragement | null>(null);
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const router = useRouter();
  const { isSignedIn } = useAuth();

  // Convert thread to PrayerRequest format for FeedCard
  const prayerRequest: PrayerRequest = {
    id: thread.id,
    userId: thread.author?.id || "anonymous",
    userName: thread.author?.displayName || "Anonymous",
    userAvatar: thread.author?.avatarUrl || undefined,
    isAnonymous: thread.isAnonymous,
    title: thread.title,
    content: thread.body,
    createdAt: new Date(thread.createdAt),
    prayerCount: prayerStatus.prayerCount,
    encouragementCount: thread._count.encouragements,
    isFollowing: false, // Not used in thread detail
    hasPrayed: prayerStatus.hasPrayed,
    hasEncouraged: false, // We'll handle encouragement differently
    updateStatus: thread.status === "answered" ? "answered" : null,
  };

  const handlePrayerToggle = async (id?: string) => {
    if (!isSignedIn) return;

    setIsSubmittingPrayer(true);
    try {
      const method = prayerStatus.hasPrayed ? "DELETE" : "POST";
      const response = await fetch(`/api/threads/${thread.id}/prayers`, {
        method,
      });

      if (!response.ok) {
        throw new Error("Failed to update prayer");
      }

      const result = await response.json();
      setPrayerStatus({
        hasPrayed: result.hasPrayed,
        prayerCount: result.prayerCount,
      });
    } catch (error) {
      console.error("Error updating prayer:", error);
    } finally {
      setIsSubmittingPrayer(false);
    }
  };

  const handleEncouragementSubmit = async () => {
    if (!encouragementText.trim() || !currentUser) return;

    setIsSubmittingEncouragement(true);
    try {
      const response = await fetch(`/api/threads/${thread.id}/encouragements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: encouragementText.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to post encouragement");
      }

      const newEncouragement = await response.json();
      setEncouragements([newEncouragement, ...encouragements]);
      setEncouragementText("");
    } catch (error) {
      console.error("Error posting encouragement:", error);
    } finally {
      setIsSubmittingEncouragement(false);
    }
  };

  const handleDeleteEncouragement = async (encouragement: Encouragement) => {
    if (!currentUser) return;

    setDeletingEncouragement(encouragement.id);
    try {
      const response = await fetch(`/api/threads/${thread.id}/encouragements/${encouragement.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete encouragement");
      }

      // Remove encouragement from list
      setEncouragements(encouragements.filter(e => e.id !== encouragement.id));
      setDeleteDialogOpen(false);
      setEncouragementToDelete(null);
    } catch (error) {
      console.error("Error deleting encouragement:", error);
      // You could add a toast notification here
    } finally {
      setDeletingEncouragement(null);
    }
  };

  const openDeleteDialog = (encouragement: Encouragement) => {
    setEncouragementToDelete(encouragement);
    setDeleteDialogOpen(true);
  };

  const handleDeleteThread = async (id?: string) => {
    if (!currentUser) return;

    setIsDeletingThread(true);
    try {
      const response = await fetch(`/api/threads/${thread.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete thread");
      }

      // Redirect to home page after successful deletion
      router.push("/");
    } catch (error) {
      console.error("Error deleting thread:", error);
      // You could add a toast notification here
    } finally {
      setIsDeletingThread(false);
    }
  };

  const handleUpdateSubmit = async () => {
    if (!updateText.trim() || !currentUser) return;

    setIsSubmittingUpdate(true);
    try {
      const response = await fetch(`/api/threads/${thread.id}/updates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: updateText.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to post update");
      }

      const newUpdate = await response.json();
      setUpdates([newUpdate, ...updates]);
      setUpdateText("");
    } catch (error) {
      console.error("Error posting update:", error);
    } finally {
      setIsSubmittingUpdate(false);
    }
  };

  const getAuthorInitials = (user: User | null) => {
    if (!user || !user.displayName) return "?";
    return user.displayName
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-6">
        <div className="space-y-8">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="mb-6 -ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {/* Thread as Feed Card */}
          <FeedCard
            prayer={prayerRequest}
            onPray={handlePrayerToggle}
            onEncourage={() => setShowEncouragementForm(!showEncouragementForm)}
            currentUserId={currentUser?.id}
            isSignedIn={isSignedIn}
            onDelete={handleDeleteThread}
            isDeletingId={isDeletingThread ? thread.id : undefined}
            onCardClick={() => {}} // Disable card click on detail page
          />


          {/* Add encouragement form (inline) */}
          {isSignedIn && currentUser && thread.status === "open" && thread.author?.id !== currentUser.id && showEncouragementForm && (
            <Card className="bg-card/50 backdrop-blur-sm border-border/50 -mt-4">
              <CardContent className="p-6">
                <div className="flex items-center space-x-3 mb-4">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={currentUser.avatarUrl || undefined} />
                    <AvatarFallback className="bg-secondary text-secondary-foreground">{getAuthorInitials(currentUser)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">Share encouragement</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <Textarea
                    placeholder="Write an encouraging message..."
                    value={encouragementText}
                    onChange={(e) => setEncouragementText(e.target.value)}
                    maxLength={300}
                    className="min-h-[80px] bg-secondary/50 border-border/50 focus:border-accent/50"
                    autoFocus
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">
                      {300 - encouragementText.length} characters remaining
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowEncouragementForm(false);
                          setEncouragementText("");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => {
                          handleEncouragementSubmit();
                          setShowEncouragementForm(false);
                        }}
                        disabled={
                          !encouragementText.trim() || isSubmittingEncouragement
                        }
                        size="sm"
                        className="bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:border-accent/60"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        {isSubmittingEncouragement ? "Sending..." : "Send"}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Add update (thread authors only) */}
          {isSignedIn && currentUser && thread.status === "open" && thread.author?.id === currentUser.id && (
            <Card className="bg-card/50 backdrop-blur-sm border-border/50">
              <CardContent className="p-6">
                <div className="flex items-center space-x-3 mb-4">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={currentUser.avatarUrl || undefined} />
                    <AvatarFallback className="bg-secondary text-secondary-foreground">{getAuthorInitials(currentUser)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">Share an update</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <Textarea
                    placeholder="Share an update..."
                    value={updateText}
                    onChange={(e) => setUpdateText(e.target.value)}
                    maxLength={1000}
                    className="min-h-[80px] bg-secondary/50 border-border/50 focus:border-accent/50"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">
                      {1000 - updateText.length} characters remaining
                    </span>
                    <Button
                      onClick={handleUpdateSubmit}
                      disabled={
                        !updateText.trim() || isSubmittingUpdate
                      }
                      size="sm"
                      className="bg-accent/20 text-accent border-accent/40 hover:bg-accent/30 hover:border-accent/60"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {isSubmittingUpdate ? "Sending..." : "Send"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Thread entries */}
          {threadEntries.length > 0 ? (
            <div className="space-y-3">
              {threadEntries.map((entry) => (
                <div key={entry.id} className="flex space-x-3 p-4 bg-card/30 backdrop-blur-sm border border-border/30 rounded-lg hover:bg-card/40 transition-colors">
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarImage src={entry.author.avatarUrl || undefined} />
                    <AvatarFallback className="bg-secondary text-secondary-foreground">
                      {getAuthorInitials(entry.author)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium truncate">
                          {entry.author.displayName || "Unknown"}
                        </span>
                        {entry.type === 'update' && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0.5 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
                            Update
                          </Badge>
                        )}
                        <span className="text-muted-foreground text-xs">
                          {formatDistanceToNow(new Date(entry.createdAt))} ago
                        </span>
                      </div>
                      {currentUser && entry.author.id === currentUser.id && entry.type === 'encouragement' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => openDeleteDialog(entry as Encouragement)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <p className="text-sm mt-1 leading-relaxed whitespace-pre-wrap break-words">
                      {entry.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <MessageCircle className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground mb-1">No responses yet</p>
              <p className="text-sm text-muted-foreground/70">
                Be the first to encourage this prayer request
              </p>
            </div>
          )}
        </div>
      </main>


      <ConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Encouragement"
        description="Are you sure you want to delete this encouragement? This action cannot be undone."
        confirmText="Delete"
        confirmVariant="destructive"
        loading={deletingEncouragement === encouragementToDelete?.id}
        loadingText="Deleting..."
        onConfirm={() => encouragementToDelete && handleDeleteEncouragement(encouragementToDelete)}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setEncouragementToDelete(null);
        }}
      />

    </div>
  );
}