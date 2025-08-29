"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, Heart, MessageCircle, Clock, Trash2, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { useProfile } from "@/hooks/use-profile";

interface ThreadAuthor {
  id: string;
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
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
  author: ThreadAuthor | null;
  _count: {
    prayers: number;
    encouragements: number;
    updates: number;
  };
}

export function PrayerThreadList() {
  const [threads, setThreads] = useState<PrayerThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingThread, setDeletingThread] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [threadToDelete, setThreadToDelete] = useState<PrayerThread | null>(null);
  const { profile } = useProfile();

  useEffect(() => {
    fetchThreads();
  }, []);

  const fetchThreads = async () => {
    try {
      const response = await fetch("/api/threads?status=open");
      if (!response.ok) {
        throw new Error("Failed to fetch threads");
      }
      const data = await response.json();
      setThreads(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteThread = async (thread: PrayerThread) => {
    if (!profile) return;

    setDeletingThread(thread.id);
    try {
      const response = await fetch(`/api/threads/${thread.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete thread");
      }

      // Remove thread from list
      setThreads(threads.filter(t => t.id !== thread.id));
      setDeleteDialogOpen(false);
      setThreadToDelete(null);
    } catch (error) {
      console.error("Error deleting thread:", error);
      // You could add a toast notification here
    } finally {
      setDeletingThread(null);
    }
  };

  const openDeleteDialog = (thread: PrayerThread, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setThreadToDelete(thread);
    setDeleteDialogOpen(true);
  };

  const getAuthorInitials = (author: ThreadAuthor | null) => {
    if (!author || !author.displayName) {
      return "?";
    }
    return author.displayName
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-3">
              <div className="flex items-start space-x-3">
                <div className="h-10 w-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="h-3 bg-muted rounded" />
                <div className="h-3 bg-muted rounded w-5/6" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Failed to load prayer requests</p>
          <Button onClick={fetchThreads} variant="outline" size="sm" className="mt-4">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (threads.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No prayer requests yet</p>
          <p className="text-sm text-muted-foreground mt-2">
            Be the first to share a prayer request
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {threads.map((thread) => (
        <Link key={thread.id} href={`/threads/${thread.id}`} className="block">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="pb-3">
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
                    <h3 className="font-semibold text-sm">{thread.title}</h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
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
                <div className="flex items-center gap-2">
                  {thread.status === "answered" && (
                    <Badge variant="secondary" className="text-xs">
                      Answered
                    </Badge>
                  )}
                  {profile && thread.author?.id === profile.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem 
                          className="text-destructive"
                          onClick={(e) => openDeleteDialog(thread, e)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground line-clamp-2">{thread.body}</p>
              
              {thread.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {thread.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              
              <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Heart className="h-3 w-3" />
                  <span>{thread._count.prayers} praying</span>
                </div>
                <div className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  <span>{thread._count.encouragements} encouragements</span>
                </div>
                {thread._count.updates > 0 && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{thread._count.updates} updates</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}

      <ConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Prayer Request"
        description={
          <>
            Are you sure you want to delete this prayer request? This action cannot be undone.
            <br /><br />
            All encouragements and prayers associated with this request will also be removed.
          </>
        }
        confirmText="Delete"
        confirmVariant="destructive"
        loading={deletingThread === threadToDelete?.id}
        loadingText="Deleting..."
        onConfirm={() => threadToDelete && handleDeleteThread(threadToDelete)}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setThreadToDelete(null);
        }}
      />
    </div>
  );
}