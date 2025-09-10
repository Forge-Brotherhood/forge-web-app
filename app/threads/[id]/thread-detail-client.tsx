"use client";

import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { useThreadDetail, threadKeys } from "@/hooks/use-thread-detail-query";
import { useAddPostMutation, useReactionMutation, useDeletePostMutation, useDeleteThreadMutation, usePrayerListToggleMutation } from "@/hooks/use-thread-mutations";
import { QuickActionsBar } from "@/components/quick-actions-bar";
import { useScrollPreservation } from "@/hooks/use-scroll-preservation";

interface Props {
  threadId: string;
}

export function ThreadDetailClient({ threadId }: Props) {
  const [postText, setPostText] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  // TanStack Query hooks
  const { data, isLoading, error } = useThreadDetail(threadId);
  const addPostMutation = useAddPostMutation();
  const reactionMutation = useReactionMutation();
  const deletePostMutation = useDeletePostMutation();
  const deleteThreadMutation = useDeleteThreadMutation();
  const prayerListMutation = usePrayerListToggleMutation();

  // Scroll preservation
  const { navigateWithScroll } = useScrollPreservation([], false);

  // All hooks must be called before any conditional logic
  const handlePrayerListToggle = useCallback(async () => {
    if (!data?.thread?.posts) return;

    const mainPost = data.thread.posts.find(p => p.kind === "request" || p.kind === "testimony") || data.thread.posts[0];
    if (!mainPost) return;

    try {
      await prayerListMutation.mutateAsync({
        threadId: data.thread.id,
        postId: mainPost.id
      });
    } catch (error) {
      console.error("Error updating prayer list:", error);
    }
  }, [data, prayerListMutation]);

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
        threadId: data.thread.id,
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
  }, [postText, data, addPostMutation]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleDeletePost = useCallback(async (postId: string) => {
    if (!data?.thread || !confirm("Are you sure you want to delete this post?")) return;

    setDeletingPostId(postId);
    
    try {
      await deletePostMutation.mutateAsync({
        threadId: data.thread.id,
        postId,
      });
    } catch (error) {
      console.error("Error deleting post:", error);
      alert(`Failed to delete post: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDeletingPostId(null);
    }
  }, [data?.thread, deletePostMutation]);

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

  const handleReplyClick = useCallback(() => {
    // Scroll to and focus the compose textarea
    if (composeRef.current) {
      composeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        composeRef.current?.focus();
        setIsComposing(true);
      }, 300);
    }
  }, []);

  const handleShareClick = useCallback(() => {
    // TODO: Implement share functionality
    console.log("Share clicked");
  }, []);

  const handleSendClick = useCallback(() => {
    // TODO: Implement send to core group functionality
    console.log("Send to core group clicked");
  }, []);

  if (isLoading) {
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

  const { thread, currentUser, initialPrayerStatus } = data;

  // Use the live prayer status from cache, falling back to initial status
  // This ensures the UI reflects optimistic updates
  const currentPrayerStatus = data.initialPrayerStatus as {
    hasPrayed: boolean;
    prayerCount: number;
    isInPrayerList: boolean;
    prayerListCount: number;
  };

  // Filter out any null/undefined posts and get main post
  const validPosts = (thread.posts || []).filter(post => post && post.id);
  const mainPost = validPosts.find(p => p.kind === "request" || p.kind === "testimony") || validPosts[0];
  
  // Separate main post from responses
  const responsePosts = validPosts.filter(post => post.id !== mainPost?.id);
  
  // Sort responses from most recent to oldest
  const sortedResponses = responsePosts.sort((a, b) => 
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
          
          <h1 className="text-3xl font-bold text-foreground mb-2">Prayer Thread</h1>
          <p className="text-muted-foreground">
            {isTestimony ? "Celebrating God's faithfulness" : "Join in prayer and encouragement"}
          </p>
        </div>


        {/* Posts */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {!mainPost ? (
            <div className="text-center py-12">
              <div className="mb-4">
                <BookOpen className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              </div>
              <p className="text-muted-foreground text-lg mb-2">No posts found</p>
              <p className="text-muted-foreground text-sm">
                This thread doesn't have any posts yet
              </p>
            </div>
          ) : (
            <>
              {/* Main Post (Request/Testimony) */}
              <Card 
                key={mainPost.id} 
                data-post-id={mainPost.id}
                className="w-full no-border transition-colors"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={(thread.isAnonymous ? null : (thread.author || mainPost.author))?.profileImageUrl || undefined} />
                        <AvatarFallback>
                          {thread.isAnonymous ? "?" : getAuthorInitials(thread.author || mainPost.author)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-foreground">
                            {getAuthorName(thread.isAnonymous ? null : (thread.author || mainPost.author))}
                          </span>
                          {mainPost.kind === "testimony" && (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                              <Trophy className="w-3 h-3 mr-1" />
                              Testimony
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>{formatDistanceToNow(new Date(mainPost.createdAt), { addSuffix: true })}</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Three dot menu for main post */}
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
                          {(thread.author?.id === currentUser.id || mainPost.author?.id === currentUser.id) && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="flex items-center">
                                <Edit className="w-4 h-4 mr-2" />
                                Edit post
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="flex items-center text-red-600 hover:text-red-700"
                                onClick={() => {
                                  // Check if this is the main post - if so, delete entire thread
                                  if (mainPost.kind === "request") {
                                    handleDeleteThread();
                                  } else {
                                    handleDeletePost(mainPost.id);
                                  }
                                }}
                                disabled={deletingPostId === mainPost.id || deleteThreadMutation.isPending}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                {mainPost.kind === "request" ? "Delete thread" : "Delete post"}
                                {(deletingPostId === mainPost.id || deleteThreadMutation.isPending) && (
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

                <CardContent className="pt-0 pb-0">
                  <div className="text-foreground whitespace-pre-wrap">
                    {mainPost.content}
                  </div>
                </CardContent>
                
                {/* Media for main post */}
                {mainPost.media && mainPost.media.length > 0 && (
                  <CardContent className="pt-3 pb-0">
                    {mainPost.media.filter(m => m.type === "image").length > 0 && (
                      <div>
                        <MediaGridGallery 
                          media={mainPost.media.filter(m => m.type === "image")} 
                          maxItems={4}
                          className=""
                        />
                      </div>
                    )}
                    {mainPost.media.filter(m => m.type === "video").map((media: any) => (
                      <div key={media.id}>
                        <VideoPlayer
                          video={media}
                          autoPlay={true}
                          muted={true}
                          className=""
                        />
                      </div>
                    ))}
                    {mainPost.media.filter(m => m.type === "audio").map((media: any) => (
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

                {/* Quick Actions Bar */}
                <CardContent className="pt-4 pb-4">
                  <QuickActionsBar
                    postId={mainPost.id}
                    threadId={thread.id}
                    isMainPost={true}
                    prayerListCount={currentPrayerStatus.prayerListCount}
                    isInPrayerList={currentPrayerStatus.isInPrayerList}
                    encouragementCount={responsePosts.length}
                    onPrayerListToggle={handlePrayerListToggle}
                    onReplyClick={handleReplyClick}
                    onSendClick={handleSendClick}
                    onShareClick={handleShareClick}
                    isPrayerListPending={prayerListMutation.isPending}
                  />
                </CardContent>
              </Card>
            </>
          )}
          
          {/* Inline Compose Form - Twitter-like */}
          {thread.status === "open" ? (
            <Card className="w-full no-border border-t border-border">
              <CardContent className="p-4">
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
                        "min-h-[60px] resize-none border-none shadow-none p-0 text-base placeholder:text-muted-foreground/60",
                        "focus-visible:ring-0 focus-visible:ring-offset-0",
                        isComposing && "min-h-[100px]"
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
                              className="group relative h-9 px-4 text-muted-foreground hover:text-foreground transition-colors duration-200"
                            >
                              <span className="text-sm font-medium">Cancel</span>
                            </Button>
                          )}
                          <Button 
                            size="sm" 
                            onClick={handleSubmitPost}
                            disabled={!postText.trim() || addPostMutation.isPending}
                            className="group relative h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-all duration-200 rounded-md shadow-sm hover:shadow-md disabled:opacity-50"
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
          {sortedResponses.length > 0 && sortedResponses.map((post) => (
            <Card 
              key={post.id} 
              data-post-id={post.id}
              className="w-full no-border border-t border-border transition-colors"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <Avatar className="w-10 h-10">
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

              <CardContent className="pt-0 pb-6">
                <div className="text-foreground whitespace-pre-wrap">
                  {post.content}
                </div>
              </CardContent>
              
              {/* Media for response post */}
              {post.media && post.media.length > 0 && (
                <CardContent className="pt-3 pb-0">
                  {post.media.filter(m => m.type === "image").length > 0 && (
                    <div>
                      <MediaGridGallery 
                        media={post.media.filter(m => m.type === "image")} 
                        maxItems={4}
                        className=""
                      />
                    </div>
                  )}
                  {post.media.filter(m => m.type === "video").map((media: any) => (
                    <div key={media.id}>
                      <VideoPlayer
                        video={media}
                        autoPlay={true}
                        muted={true}
                        className=""
                      />
                    </div>
                  ))}
                  {post.media.filter(m => m.type === "audio").map((media: any) => (
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