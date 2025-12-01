"use client";

import { useState, useCallback, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Send, Users, BookOpen, MoreHorizontal, Edit, Trash2, Share, Flag } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MediaGridGallery } from "@/components/photoswipe-gallery";
import { VideoPlayer } from "@/components/video-player";
import { useThreadDetail, useAddPostMutation, useDeletePostMutation, useDeleteThreadMutation, usePrayerListToggleMutation } from "@features/prayer";
import { FeedCard, FeedCardSkeleton, type PrayerRequest as FeedCardPrayer } from "@/components/feed-card";
import { EmptyState } from "@/components/empty-state";

interface Props {
  threadId: string;
}

export function ThreadDetailClient({ threadId }: Props) {
  const [postText, setPostText] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // TanStack Query hooks
  const { data, isLoading, error } = useThreadDetail(threadId);
  const addPostMutation = useAddPostMutation();
  const deletePostMutation = useDeletePostMutation();
  const deleteThreadMutation = useDeleteThreadMutation();
  const prayerListMutation = usePrayerListToggleMutation();

  // All hooks must be called before any conditional logic
  const handlePrayerListToggle = useCallback(async () => {
    if (!data?.thread?.entries) return;

    const mainPost = data.thread.entries.find((p: any) => p.kind === "request" || p.kind === "testimony") || data.thread.entries[0];
    if (!mainPost) return;

    try {
      await prayerListMutation.mutateAsync({
        threadId,
        postId: mainPost.id,
      });
    } catch (error) {
      console.error("Error updating prayer list:", error);
    }
  }, [data, prayerListMutation, threadId]);

  const handleSubmitPost = useCallback(async () => {
    if (!postText.trim() || !data?.thread || !data?.currentUser) return;

    const canPost = data.currentUser && data.thread.status === "open";
    const canUpdate = canPost && data.thread.author?.id === data.currentUser?.id;
    
    if (!canPost) return;

    // Store the current text before clearing (for rollback if needed)
    const currentText = postText.trim();
    
    try {
      // Clear form immediately for better UX (optimistic update)
      setPostText("");
      setIsComposing(false);

      await addPostMutation.mutateAsync({
        threadId,
        content: currentText,
        kind: canUpdate ? "update" : "encouragement",
      });
      
    } catch (error) {
      console.error("Error adding post:", error);
      // Restore the text if there was an error
      setPostText(currentText);
      setIsComposing(true);
      alert(`Failed to add post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [postText, data, addPostMutation, threadId]);


  const handleDeletePost = useCallback(async (postId: string) => {
    if (!data?.thread || !confirm("Are you sure you want to delete this post?")) return;

    setDeletingPostId(postId);
    
    try {
      await deletePostMutation.mutateAsync({
        threadId,
        postId,
      });
    } catch (error) {
      console.error("Error deleting post:", error);
      alert(`Failed to delete post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDeletingPostId(null);
    }
  }, [data?.thread, deletePostMutation, threadId]);

  const handleDeleteThread = useCallback(async () => {
    if (!data?.thread) return;

    setIsDeletingThread(true);

    try {
      await deleteThreadMutation.mutateAsync({
        threadId: data.thread.id,
      });

      // Navigate back after successful deletion
      router.push("/groups");
    } catch (error) {
      console.error("Error deleting thread:", error);
      setIsDeletingThread(false);
    }
  }, [data?.thread, deleteThreadMutation, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="mb-6">
            <BackButton fallbackPath="/groups" />
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <FeedCardSkeleton />
            <FeedCardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="mb-6">
            <BackButton fallbackPath="/groups" />
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <EmptyState
              icon={BookOpen}
              title="Thread Not Found"
              message={error instanceof Error ? error.message : error || "This prayer thread may have been removed or you don't have access to it"}
              action={{ label: "Back", onClick: () => router.back() }}
            />
          </div>
        </div>
      </div>
    );
  }

  const { thread, currentUser } = data;

  // Use the live prayer status from cache, falling back to initial status
  // This ensures the UI reflects optimistic updates
  const currentPrayerStatus = data.initialPrayerStatus as {
    hasPrayed: boolean;
    prayerCount: number;
    isInPrayerList: boolean;
    prayerListCount: number;
  };

  // Filter out any null/undefined entries and get main entry
  const validPosts = ((thread as any).entries || []).filter((post: any) => post && post.id);
  const mainPost = validPosts.find((p: any) => p.kind === "request" || p.kind === "testimony") || validPosts[0];
  
  // Separate main post from responses
  const responsePosts = validPosts.filter((post: any) => post.id !== mainPost?.id);
  
  // Sort responses from most recent to oldest
  const sortedResponses = (responsePosts as any[]).sort((a: any, b: any) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const isTestimony = thread.status === "answered" || mainPost?.kind === "testimony";
  const canPost = currentUser && thread.status === "open";
  const canUpdate = canPost && thread.author?.id === currentUser?.id;
  const canEncourage = canPost && thread.author?.id !== currentUser?.id;

  const getAuthorName = (user: any) => {
    if (!user) return "Anonymous";
    return user.displayName || user.firstName || "Unknown";
  };

  const getAuthorInitials = (user: any) => {
    if (!user) return "?";
    const name = getAuthorName(user);
    return name
      .split(" ")
      .map((word: string) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <BackButton fallbackPath="/groups" />
            
            {thread.group && (
              <Badge variant="secondary" className="bg-blue-500/15 text-blue-600 dark:text-blue-400 rounded-full">
                <Users className="w-3 h-3 mr-1" />
                {thread.group.name || `${thread.group.groupType} group`}
              </Badge>
            )}
          </div>
        </div>


        {/* Thread Content */}
        <div className="space-y-3">
          {!mainPost ? (
            <EmptyState
              icon={BookOpen}
              title="No Posts Found"
              message="This thread doesn't have any posts yet"
            />
          ) : (
              <FeedCard
                prayer={{
                  id: (thread as any).shortId || thread.id,
                  postId: mainPost.id,
                  userId: (thread.author?.id || mainPost.author?.id) || "",
                  userName: thread.isAnonymous ? "Anonymous" : ((thread.author?.displayName || mainPost.author?.displayName || "Unknown")),
                  userAvatar: thread.isAnonymous ? undefined : ((thread.author?.profileImageUrl || mainPost.author?.profileImageUrl) || undefined),
                  isAnonymous: thread.isAnonymous,
                  title: thread.title || undefined,
                  content: mainPost.content || "",
                  createdAt: new Date(mainPost.createdAt),
                  prayerCount: (thread as any)._count?.actions || 0,
                  prayerListCount: currentPrayerStatus.prayerListCount,
                  encouragementCount: responsePosts.length,
                  isFollowing: false,
                  hasPrayed: currentPrayerStatus.hasPrayed,
                  isInPrayerList: currentPrayerStatus.isInPrayerList,
                  hasEncouraged: false,
                  updateStatus: (thread.status === "answered" || mainPost.kind === "testimony") ? "answered" : null,
                  groupName: thread.group?.name,
                  groupId: thread.group?.id,
                  sharedToCommunity: thread.sharedToCommunity,
                } as FeedCardPrayer}
                onPrayerListToggle={() => handlePrayerListToggle()}
                onCardClick={() => {}}
                currentUserId={currentUser?.id}
                isSignedIn={!!currentUser}
                onDelete={handleDeleteThread}
                isDeletingId={isDeletingThread ? ((thread as any).shortId || thread.id) : undefined}
              />
          )}
          
          {/* Inline Compose Form */}
          {thread.status === "open" && currentUser ? (
            <div className="p-4 rounded-xl bg-card">
              <div className="flex gap-3">
                <Avatar className="w-8 h-8 flex-shrink-0">
                  <AvatarImage src={currentUser?.profileImageUrl || undefined} />
                  <AvatarFallback className="text-xs">
                    {getAuthorInitials(currentUser)}
                  </AvatarFallback>
                </Avatar>
                <div
                  className="flex-1 min-w-0"
                  onBlur={(e) => {
                    const currentTarget = e.currentTarget;
                    const relatedTarget = e.relatedTarget as Node | null;
                    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
                      if (!postText.trim()) {
                        setIsComposing(false);
                      }
                    }
                  }}
                >
                  <Textarea
                    ref={composeRef}
                    value={postText}
                    onChange={(e) => {
                      setPostText(e.target.value);
                      if (!isComposing && e.target.value.length > 0) {
                        setIsComposing(true);
                      }
                    }}
                    onFocus={() => setIsComposing(true)}
                    placeholder={canUpdate ? "Share an update..." : "Leave an encouragement..."}
                    className={cn(
                      "min-h-[44px] resize-none border-0 bg-muted/50 rounded-xl px-4 py-3 text-sm",
                      "placeholder:text-muted-foreground/60",
                      "focus-visible:ring-1 focus-visible:ring-primary/20 focus-visible:ring-offset-0",
                      "transition-all duration-200",
                      isComposing && "min-h-[100px]"
                    )}
                  />

                  {/* Action Buttons */}
                  {(isComposing || postText.trim()) && (
                    <div className="flex justify-end items-center gap-2 mt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPostText("");
                          setIsComposing(false);
                        }}
                        disabled={addPostMutation.isPending}
                        className="text-muted-foreground"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSubmitPost}
                        disabled={!postText.trim() || addPostMutation.isPending}
                      >
                        {addPostMutation.isPending ? (
                          <>
                            <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2" />
                            Posting...
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4 mr-2" />
                            {canUpdate ? "Update" : "Send"}
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          
          {/* Response Posts (Updates/Encouragements) - Most Recent First */}
          {sortedResponses.length > 0 && sortedResponses.map((post: any) => {
            const isAuthorAnonymous = thread.isAnonymous && post.author?.id === thread.author?.id;
            const postAuthor = isAuthorAnonymous ? null : post.author;

            return (
              <div
                key={post.id}
                data-post-id={post.id}
                className="p-4 rounded-xl bg-card"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={postAuthor?.profileImageUrl || undefined} />
                      <AvatarFallback className="text-xs">
                        {isAuthorAnonymous ? "?" : getAuthorInitials(postAuthor)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {getAuthorName(postAuthor)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>

                  {/* Menu */}
                  {currentUser && post.author?.id === currentUser.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className={cn(
                            "p-2 -mr-2 rounded-xl transition-colors duration-200",
                            "text-muted-foreground hover:text-foreground hover:bg-accent/10"
                          )}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => handleDeletePost(post.id)}
                          disabled={deletingPostId === post.id}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                          {deletingPostId === post.id && (
                            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin ml-auto" />
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Content */}
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {post.content}
                </p>

                {/* Media */}
                {post.attachments && (post.attachments as any[]).length > 0 && (
                  <div className="mt-3">
                    {post.attachments.filter((m: any) => m.type === "image").length > 0 && (
                      <MediaGridGallery
                        media={post.attachments.filter((m: any) => m.type === "image")}
                        maxItems={4}
                        className=""
                      />
                    )}
                    {post.attachments.filter((m: any) => m.type === "video").map((media: any) => (
                      <VideoPlayer
                        key={media.id}
                        video={media}
                        autoPlay={true}
                        muted={true}
                        className=""
                      />
                    ))}
                    {post.attachments.filter((m: any) => m.type === "audio").map((media: any) => (
                      <div key={media.id} className="bg-muted/50 rounded-xl p-4 flex items-center justify-center">
                        <audio src={media.url} controls className="w-full" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}