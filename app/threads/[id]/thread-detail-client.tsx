"use client";

import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { Send, ArrowLeft, Users, Trophy, Clock, BookOpen, MoreHorizontal, Edit, Trash2, Share, Flag } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MediaGridGallery } from "@/components/photoswipe-gallery";
import { VideoPlayer } from "@/components/video-player";
import { useThreadDetail } from "@/hooks/use-thread-detail-query";
import { useAddPostMutation, useDeletePostMutation, useDeleteThreadMutation, usePrayerListToggleMutation } from "@/hooks/use-thread-mutations";
import { FeedCard, type PrayerRequest as FeedCardPrayer } from "@/components/feed-card";

interface Props {
  threadId: string;
}

export function ThreadDetailClient({ threadId }: Props) {
  const [postText, setPostText] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
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

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

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
    if (!data?.thread || !confirm("Are you sure you want to delete this entire thread? This action cannot be undone.")) return;

    try {
      await deleteThreadMutation.mutateAsync({
        threadId: data.thread.id,
      });
      
      // Navigate back to community after successful deletion
      router.push("/community");
    } catch (error) {
      console.error("Error deleting thread:", error);
      alert(`Failed to delete thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [data?.thread, deleteThreadMutation, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => router.back()}
              className="hover:bg-secondary/80 dark:hover:bg-secondary/60 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </div>
          <div className="bg-card/50 backdrop-blur-sm border border-border/60 dark:border-border/40 rounded-xl overflow-hidden shadow-sm dark:shadow-lg">
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center space-y-4">
                <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <p className="text-muted-foreground font-medium">Loading prayer thread...</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => router.back()}
              className="hover:bg-secondary/80 dark:hover:bg-secondary/60 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </div>
          <div className="bg-card/50 backdrop-blur-sm border border-border/60 dark:border-border/40 rounded-xl overflow-hidden shadow-sm dark:shadow-lg">
            <div className="flex flex-col items-center justify-center py-16 px-6 space-y-6">
              <div className="p-4 rounded-full bg-muted/50 dark:bg-muted/30">
                <BookOpen className="w-8 h-8 text-muted-foreground" />
              </div>
              <div className="text-center space-y-3">
                <p className="text-foreground font-semibold text-lg">Thread not found</p>
                <p className="text-muted-foreground text-sm max-w-md leading-relaxed">
                  {error instanceof Error ? error.message : error || "This prayer thread may have been removed or you don't have access to it"}
                </p>
                <Button 
                  onClick={() => router.back()} 
                  variant="outline" 
                  className="mt-4 px-6 py-2 font-medium border-border/60 dark:border-border/40 hover:bg-secondary/80 dark:hover:bg-secondary/60 transition-colors"
                >
                  Go Back
                </Button>
              </div>
            </div>
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
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            
            {thread.group && (
              <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-300">
                <Users className="w-3 h-3 mr-1" />
                {thread.group.name || `${thread.group.groupType} group`}
              </Badge>
            )}
          </div>
        </div>


        {/* Thread Content - outer bordered container */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {!mainPost ? (
            <div className="text-center py-12">
              <div className="mb-4">
                <BookOpen className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              </div>
              <p className="text-muted-foreground text-lg mb-2">No posts found</p>
              <p className="text-muted-foreground text-sm">This thread doesn&apos;t have any posts yet</p>
            </div>
          ) : (
            
              <FeedCard
                prayer={{
                  id: (thread as any).shortId || thread.id,
                  postId: mainPost.id,
                  userId: thread.isAnonymous ? "" : ((thread.author?.id || mainPost.author?.id) || ""),
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
              />
          )}
          
          {/* Inline Compose Form */}
          {thread.status === "open" ? (
            <Card className="w-full no-border border-t border-border">
              <CardContent className="text-card-foreground p-8 bg-card/50 backdrop-blur-sm border-border/50 hover:border-border/80 transition-all duration-200 cursor-pointer hover:bg-card/60">
                <div className="flex space-x-3">
                  <Avatar className="w-10 h-10 flex-shrink-0">
                    <AvatarImage src={currentUser?.profileImageUrl || undefined} />
                    <AvatarFallback>
                      {getAuthorInitials(currentUser)}
                    </AvatarFallback>
                  </Avatar>
                  <div 
                    className="flex-1 min-w-0"
                    onBlur={(e) => {
                      // Check if focus is moving outside the form area
                      const currentTarget = e.currentTarget;
                      const relatedTarget = e.relatedTarget as Node | null;
                      
                      // If focus is moving to an element outside this container, collapse if empty
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
                      placeholder={canUpdate ? "Share an update..." : "Add your encouragement..."}
                      className={cn(
                        "min-h-[80px] resize-none bg-card/50 border border-border/50 rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground/70",
                        "focus-visible:ring-1 focus-visible:ring-accent/20 focus-visible:border-accent/40 focus-visible:ring-offset-0",
                        isComposing && "min-h-[120px]"
                      )}
                    />
                    
                    {/* Action Buttons - Only show when composing or has content */}
                    {(isComposing || postText.trim()) && (
                      <div className="flex justify-end items-center mt-3">
                        <div className="flex space-x-2">
                          {isComposing && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => {
                                setPostText("");
                                setIsComposing(false);
                              }}
                              disabled={addPostMutation.isPending}
                              className="h-9 px-3 text-muted-foreground hover:text-foreground"
                            >
                              <span className="text-sm font-medium">Cancel</span>
                            </Button>
                          )}
                          <Button 
                            size="sm" 
                            onClick={handleSubmitPost}
                            disabled={!postText.trim() || addPostMutation.isPending}
                            className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-md shadow-sm hover:shadow-md disabled:opacity-50"
                          >
                            {addPostMutation.isPending ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                                <span className="text-sm">Posting...</span>
                              </>
                            ) : (
                              <span className="text-sm">{canUpdate ? "Update" : "Post"}</span>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
          
          {/* Response Posts (Updates/Encouragements) - Most Recent First */}
          {sortedResponses.length > 0 && sortedResponses.map((post: any) => (
            <Card 
              key={post.id} 
              data-post-id={post.id}
              className="text-card-foreground p-8 bg-card/50 backdrop-blur-sm border-border/50 hover:border-border/80 transition-all duration-200 cursor-pointer hover:bg-card/60"
            >
              <CardHeader className="p-0 pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <Avatar className="w-9 h-9">
                      <AvatarImage src={(thread.isAnonymous && post.author?.id === thread.author?.id ? null : post.author)?.profileImageUrl || undefined} />
                      <AvatarFallback>
                        {thread.isAnonymous && post.author?.id === thread.author?.id ? "?" : getAuthorInitials(post.author)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-foreground">
                          {getAuthorName(thread.isAnonymous && post.author?.id === thread.author?.id ? null : post.author)}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Three dot menu for response posts */}
                  {currentUser && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem className="flex items-center">
                          <Send className="w-4 h-4 mr-2" />
                          Send
                        </DropdownMenuItem>
                        <DropdownMenuItem className="flex items-center">
                          <Share className="w-4 h-4 mr-2" />
                          Share
                        </DropdownMenuItem>
                        <DropdownMenuItem className="flex items-center">
                          <Flag className="w-4 h-4 mr-2" />
                          Flag
                        </DropdownMenuItem>
                        {post.author?.id === currentUser.id && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="flex items-center">
                              <Edit className="w-4 h-4 mr-2" />
                              Edit post
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              className="flex items-center text-red-600 hover:text-red-700"
                              onClick={() => handleDeletePost(post.id)}
                              disabled={deletingPostId === post.id}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete post
                              {deletingPostId === post.id && (
                                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin ml-2" />
                              )}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="text-foreground whitespace-pre-wrap text-base leading-7">
                  {post.content}
                </div>
              </CardContent>
              
              {/* Media for response post */}
              {post.attachments && (post.attachments as any[]).length > 0 && (
                <CardContent className="p-0 pt-3 pb-0">
                  {post.attachments.filter((m: any) => m.type === "image").length > 0 && (
                    <div>
                      <MediaGridGallery 
                        media={post.attachments.filter((m: any) => m.type === "image")} 
                        maxItems={4}
                        className=""
                      />
                    </div>
                  )}
                  {post.attachments.filter((m: any) => m.type === "video").map((media: any) => (
                    <div key={media.id}>
                      <VideoPlayer
                        video={media}
                        autoPlay={true}
                        muted={true}
                        className=""
                      />
                    </div>
                  ))}
                  {post.attachments.filter((m: any) => m.type === "audio").map((media: any) => (
                    <div key={media.id} className="bg-secondary/50 rounded-lg p-4 h-32 flex items-center justify-center">
                      <audio
                        src={media.url}
                        controls
                        className="w-full"
                      />
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}