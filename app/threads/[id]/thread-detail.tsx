"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Heart, MessageCircle, Clock, Send, ArrowLeft, Trash2, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { SignInButton, useAuth } from "@clerk/nextjs";

interface User {
  id: string;
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
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
  const [isSubmittingPrayer, setIsSubmittingPrayer] = useState(false);
  const [encouragements, setEncouragements] = useState(thread.encouragements);
  const [updates, setUpdates] = useState(thread.updates);
  const [updateText, setUpdateText] = useState("");
  const [isSubmittingUpdate, setIsSubmittingUpdate] = useState(false);
  const [deletingEncouragement, setDeletingEncouragement] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [encouragementToDelete, setEncouragementToDelete] = useState<Encouragement | null>(null);
  const [deleteThreadDialogOpen, setDeleteThreadDialogOpen] = useState(false);
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const router = useRouter();
  const { isSignedIn } = useAuth();

  const handlePrayerToggle = async () => {
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

  const handleDeleteThread = async () => {
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
      setDeleteThreadDialogOpen(false);
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
      <Navbar />
      <main className="container max-w-2xl mx-auto py-6 px-4">
        <div className="space-y-6">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {/* Thread header */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  <Avatar className="h-10 w-10">
                    {thread.author ? (
                      <>
                        <AvatarImage src={thread.author.avatarUrl || undefined} />
                        <AvatarFallback>{getAuthorInitials(thread.author)}</AvatarFallback>
                      </>
                    ) : (
                      <AvatarFallback>?</AvatarFallback>
                    )}
                  </Avatar>
                  <div className="flex-1">
                    <h1 className="text-lg font-semibold">{thread.title}</h1>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                      <span>
                        {thread.isAnonymous
                          ? "Anonymous"
                          : thread.author?.displayName || "Unknown"}
                      </span>
                      <span>•</span>
                      <span>{formatDistanceToNow(new Date(thread.createdAt))} ago</span>
                    </div>
                  </div>
                </div>
                {thread.status === "answered" && (
                  <Badge variant="secondary">
                    Answered
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 whitespace-pre-wrap">{thread.body}</p>
              
              {thread.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-4">
                  {thread.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Prayer button or Thread actions */}
              <div className="flex items-center justify-between mt-6">
                <div>
                  {/* Prayer button - only show for non-authors */}
                  {isSignedIn && currentUser && thread.author?.id !== currentUser.id ? (
                    <Button
                      variant={prayerStatus.hasPrayed ? "default" : "outline"}
                      size="sm"
                      onClick={handlePrayerToggle}
                      disabled={isSubmittingPrayer || thread.status !== "open"}
                      className="flex items-center gap-2"
                    >
                      <Heart
                        className={`h-4 w-4 ${
                          prayerStatus.hasPrayed ? "fill-current" : ""
                        }`}
                      />
                      {prayerStatus.hasPrayed ? "Praying" : "Pray"}
                      <span>({prayerStatus.prayerCount})</span>
                    </Button>
                  ) : !isSignedIn ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Heart className="h-4 w-4" />
                      <span>{prayerStatus.prayerCount} praying</span>
                      <SignInButton mode="redirect">
                        <Button variant="outline" size="sm">
                          Sign in to pray
                        </Button>
                      </SignInButton>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Heart className="h-4 w-4" />
                      <span>{prayerStatus.prayerCount} praying</span>
                    </div>
                  )}
                </div>
                
                {/* Delete button for thread authors */}
                {isSignedIn && currentUser && thread.author?.id === currentUser.id && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteThreadDialogOpen(true)}
                    className="flex items-center gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Request
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Add encouragement (signed-in users only, but not thread authors) */}
          {isSignedIn && currentUser && thread.status === "open" && thread.author?.id !== currentUser.id && (
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={currentUser.avatarUrl || undefined} />
                    <AvatarFallback>{getAuthorInitials(currentUser)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">Share encouragement</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3">
                  <Textarea
                    placeholder="Write an encouraging message..."
                    value={encouragementText}
                    onChange={(e) => setEncouragementText(e.target.value)}
                    maxLength={300}
                    className="min-h-[80px]"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">
                      {300 - encouragementText.length} characters remaining
                    </span>
                    <Button
                      onClick={handleEncouragementSubmit}
                      disabled={
                        !encouragementText.trim() || isSubmittingEncouragement
                      }
                      size="sm"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {isSubmittingEncouragement ? "Posting..." : "Post"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Add update (thread authors only) */}
          {isSignedIn && currentUser && thread.status === "open" && thread.author?.id === currentUser.id && (
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={currentUser.avatarUrl || undefined} />
                    <AvatarFallback>{getAuthorInitials(currentUser)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">Post an update</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3">
                  <Textarea
                    placeholder="Share an update about this prayer request..."
                    value={updateText}
                    onChange={(e) => setUpdateText(e.target.value)}
                    maxLength={1000}
                    className="min-h-[80px]"
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
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {isSubmittingUpdate ? "Posting..." : "Post Update"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Encouragements */}
          {encouragements.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                Encouragements ({encouragements.length})
              </h2>
              
              <div className="space-y-3">
                {encouragements.map((encouragement) => (
                  <Card key={encouragement.id}>
                    <CardContent className="pt-4">
                      <div className="flex space-x-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={encouragement.author.avatarUrl || undefined} />
                          <AvatarFallback>
                            {getAuthorInitials(encouragement.author)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium">
                                {encouragement.author.displayName || "Unknown"}
                              </span>
                              <span className="text-muted-foreground">
                                {formatDistanceToNow(new Date(encouragement.createdAt))} ago
                              </span>
                            </div>
                            {currentUser && encouragement.author.id === currentUser.id && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem 
                                    className="text-destructive"
                                    onClick={() => openDeleteDialog(encouragement)}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                          <p className="text-sm mt-1 leading-5">
                            {encouragement.body}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Updates */}
          {updates.length > 0 && (
            <div className="space-y-4">
              <Separator />
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Updates ({updates.length})
              </h2>
              
              <div className="space-y-3">
                {updates.map((update) => (
                  <Card key={update.id}>
                    <CardContent className="pt-4">
                      <div className="flex space-x-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={update.author.avatarUrl || undefined} />
                          <AvatarFallback>
                            {getAuthorInitials(update.author)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium">
                              {update.author.displayName || "Unknown"}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              Update
                            </Badge>
                            <span className="text-muted-foreground">
                              {formatDistanceToNow(new Date(update.createdAt))} ago
                            </span>
                          </div>
                          <p className="text-sm mt-1 leading-5 whitespace-pre-wrap">
                            {update.body}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* No encouragements message */}
          {encouragements.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">No encouragements yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Be the first to encourage this prayer request
                </p>
              </CardContent>
            </Card>
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

      <ConfirmationDialog
        open={deleteThreadDialogOpen}
        onOpenChange={setDeleteThreadDialogOpen}
        title="Delete Prayer Request"
        description={
          <>
            Are you sure you want to delete this prayer request? This action cannot be undone.
            <br /><br />
            All encouragements, updates, and prayers associated with this request will be permanently removed.
          </>
        }
        confirmText="Delete Prayer Request"
        confirmVariant="destructive"
        loading={isDeletingThread}
        loadingText="Deleting..."
        onConfirm={handleDeleteThread}
      />
    </div>
  );
}