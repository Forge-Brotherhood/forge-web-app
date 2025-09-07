"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { BookmarkPlus, HandHeart, Send, ArrowLeft, Users, Trophy, Clock, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { MediaGridGallery } from "@/components/photoswipe-gallery";
import { VideoPlayer } from "@/components/video-player";

interface User {
  id: string;
  displayName: string | null;
  firstName: string | null;
  profileImageUrl: string | null;
}

interface Media {
  id: string;
  type: "image" | "video" | "audio";
  url: string;
  width: number | null;
  height: number | null;
  durationS: number | null;
  muxPlaybackId?: string | null;
  uploadStatus?: string;
}

interface Reaction {
  id: string;
  type: "amen" | "emoji" | "verse_ref";
  payload: string | null;
  createdAt: string;
  user: {
    id: string;
    displayName: string | null;
    firstName: string | null;
  };
}

interface Post {
  id: string;
  kind: "request" | "update" | "testimony" | "encouragement" | "verse" | "system";
  content: string | null;
  createdAt: string;
  updatedAt: string;
  author: User | null;
  media: Media[];
  reactions: Reaction[];
  _count: {
    prayerActions: number;
  };
}

interface Group {
  id: string;
  name: string | null;
  groupType: "core" | "circle";
}

interface Thread {
  id: string;
  title: string | null;
  sharedToCommunity: boolean;
  isAnonymous: boolean;
  status: "open" | "answered" | "archived";
  createdAt: string;
  updatedAt: string;
  author: User | null;
  group: Group | null;
  posts: Post[];
  prayers: Array<{
    userId: string;
    createdAt: string;
    user: {
      id: string;
      displayName: string | null;
      firstName: string | null;
    };
  }>;
  _count: {
    posts: number;
    prayers: number;
  };
}

interface PrayerStatus {
  hasPrayed: boolean;
  prayerCount: number;
}

interface Props {
  thread: Thread;
  currentUser: User | null;
  initialPrayerStatus: PrayerStatus;
}

export function ThreadDetail({ thread, currentUser, initialPrayerStatus }: Props) {
  const [prayerStatus, setPrayerStatus] = useState(initialPrayerStatus);
  const [postText, setPostText] = useState("");
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [showPostForm, setShowPostForm] = useState(false);
  const [isSubmittingPrayer, setIsSubmittingPrayer] = useState(false);
  const [posts, setPosts] = useState(thread.posts);
  const router = useRouter();
  const { isSignedIn } = useAuth();

  // Get main post (request or testimony)
  const mainPost = posts.find(p => p.kind === "request" || p.kind === "testimony") || posts[0];
  
  // Sort all posts chronologically for feed-like experience
  const allPosts = posts.sort((a, b) => 
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const isTestimony = thread.status === "answered" || mainPost?.kind === "testimony";
  const canPost = isSignedIn && currentUser && thread.status === "open";
  const canUpdate = canPost && thread.author?.id === currentUser?.id;
  const canEncourage = canPost && thread.author?.id !== currentUser?.id;

  const handlePrayerToggle = async () => {
    if (!isSignedIn || !mainPost) return;

    setIsSubmittingPrayer(true);
    try {
      const method = prayerStatus.hasPrayed ? "DELETE" : "POST";
      const response = await fetch(`/api/threads/${thread.id}/prayers`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: mainPost.id }),
      });

      if (!response.ok) {
        throw new Error("Failed to update prayer");
      }

      if (method === "DELETE") {
        setPrayerStatus({
          hasPrayed: false,
          prayerCount: Math.max(0, prayerStatus.prayerCount - 1),
        });
      } else {
        const result = await response.json();
        setPrayerStatus({
          hasPrayed: true,
          prayerCount: prayerStatus.prayerCount + 1,
        });
      }
    } catch (error) {
      console.error("Error updating prayer:", error);
    } finally {
      setIsSubmittingPrayer(false);
    }
  };

  const handlePostSubmit = async (postKind: "encouragement" | "update" | "testimony") => {
    if (!postText.trim() || !currentUser) return;

    setIsSubmittingPost(true);
    try {
      const response = await fetch(`/api/threads/${thread.id}/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: postKind,
          content: postText.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to post");
      }

      const newPost = await response.json();
      setPosts([...posts, newPost]);
      setPostText("");
      setShowPostForm(false);
    } catch (error) {
      console.error("Error posting:", error);
    } finally {
      setIsSubmittingPost(false);
    }
  };

  const getAuthorName = (user: User | null) => {
    if (!user) return "Anonymous";
    return user.displayName || user.firstName || "Unknown";
  };

  const getAuthorInitials = (user: User | null) => {
    if (!user) return "?";
    const name = getAuthorName(user);
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const renderMedia = (media: Media[]) => {
    if (!media.length) return null;

    const videos = media.filter(item => item.type === "video");
    const audios = media.filter(item => item.type === "audio");
    const nonAudioMedia = media.filter(item => item.type !== "audio");

    return (
      <div className="mt-4 space-y-3">
        {/* Mixed Media Gallery (Images + Videos with auto-play) */}
        {nonAudioMedia.length > 0 && (
          <MediaGridGallery 
            media={nonAudioMedia} 
            maxItems={4}
          />
        )}

        {/* Videos */}
        {videos.map((video) => (
          <VideoPlayer
            key={video.id}
            video={video}
            autoPlay={true}
            muted={true}
            className="rounded-lg overflow-hidden"
          />
        ))}

        {/* Audio */}
        {audios.length > 0 && (
          <div className="space-y-2">
            {audios.map((item) => (
              <div key={item.id} className="bg-secondary/20 rounded-lg p-3">
                <audio
                  src={item.url}
                  controls
                  className="w-full"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderPost = (post: Post, isMainPost = false) => {
    const displayAuthor = (thread.isAnonymous && post.author?.id === thread.author?.id) ? null : post.author;
    const postKindLabel = {
      request: "Prayer Request",
      testimony: "Testimony",
      update: "Update",
      encouragement: "Encouragement",
      verse: "Verse",
      system: "System"
    }[post.kind];

    return (
      <Card key={post.id} className={cn(
        "w-full",
        isMainPost 
          ? "border-accent/30 bg-accent/5" 
          : "border-border/30 bg-card/30 backdrop-blur-sm"
      )}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <Avatar className="w-10 h-10">
                <AvatarImage src={displayAuthor?.profileImageUrl || undefined} />
                <AvatarFallback>
                  {getAuthorInitials(displayAuthor)}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-foreground">
                    {getAuthorName(displayAuthor)}
                  </span>
                  {post.kind === "testimony" && (
                    <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-300">
                      <Trophy className="w-3 h-3 mr-1" />
                      Testimony
                    </Badge>
                  )}
                  {post.kind === "update" && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 border-blue-200">
                      <ChevronUp className="w-3 h-3 mr-1" />
                      Update
                    </Badge>
                  )}
                  {post.kind === "encouragement" && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0.5 bg-green-50 text-green-700 border-green-200">
                      <HandHeart className="w-3 h-3 mr-1" />
                      Encouragement
                    </Badge>
                  )}
                  {isMainPost && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0.5 bg-accent/20 text-accent border-accent/40">
                      Original
                    </Badge>
                  )}
                </div>
                <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                  {thread.group && (
                    <>
                      <Users className="w-3 h-3" />
                      <span>{thread.group ? (thread.group.name || `${thread.group.groupType} group`) : "Community"}</span>
                    </>
                  )}
                  <Clock className={cn("w-3 h-3", thread.group && "ml-2")} />
                  <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</span>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {/* Content */}
          <div className="text-foreground mb-4 whitespace-pre-wrap leading-relaxed">
            {post.content}
          </div>

          {/* Media */}
          {renderMedia(post.media)}

          {/* Prayer Actions - Only for main post */}
          {isMainPost && (
            <div className="flex items-center justify-between pt-6">
              <div className="flex items-center space-x-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePrayerToggle}
                  disabled={!isSignedIn || isSubmittingPrayer}
                  className={prayerStatus.hasPrayed ? "text-red-600 hover:text-red-700" : ""}
                >
                  <BookmarkPlus className={`w-4 h-4 mr-2 ${prayerStatus.hasPrayed ? "fill-current" : ""}`} />
                  {prayerStatus.prayerCount}
                </Button>

                {isSignedIn && canEncourage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPostForm(!showPostForm)}
                    className={showPostForm ? "text-accent bg-accent/10" : ""}
                  >
                    <HandHeart className={`w-4 h-4 mr-2 ${showPostForm ? "fill-current" : ""}`} />
                    Encourage
                  </Button>
                )}
                
                <div className="flex items-center space-x-1 text-sm text-muted-foreground">
                  <HandHeart className="w-4 h-4" />
                  <span>{allPosts.length}</span>
                </div>
              </div>

              {!isSignedIn && (
                <SignInButton mode="modal">
                  <Button variant="outline" size="sm">
                    Sign in to interact
                  </Button>
                </SignInButton>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (!mainPost) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Thread not found or no posts available.</p>
          <Button variant="outline" onClick={() => router.back()} className="mt-4">
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-2xl mx-auto px-4 py-6">
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

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {thread.title || (isTestimony ? "Prayer Testimony" : "Prayer Request")}
          </h1>
          <div className="flex items-center space-x-2 text-muted-foreground">
            {thread.group && (
              <>
                <Users className="w-4 h-4" />
                <span>{thread.group ? (thread.group.name || `${thread.group.groupType} group`) : "Community"}</span>
                <span className="text-muted-foreground/60">•</span>
              </>
            )}
            <span>{allPosts.length} {allPosts.length === 1 ? 'post' : 'posts'}</span>
            <span className="text-muted-foreground/60">•</span>
            <span>{prayerStatus.prayerCount} {prayerStatus.prayerCount === 1 ? 'person' : 'people'} praying</span>
          </div>
        </div>

        {/* Post Form */}
        {showPostForm && canPost && (
          <Card className="bg-accent/10 backdrop-blur-sm border-accent/30 mb-6 animate-in slide-in-from-top-2 duration-200">
            <CardContent className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={currentUser?.profileImageUrl || undefined} />
                  <AvatarFallback className="bg-secondary text-secondary-foreground">
                    {getAuthorInitials(currentUser)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {canUpdate ? "Share an update" : "Add encouragement"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {canUpdate ? "Update everyone on this prayer request" : "Share words of encouragement and support"}
                  </p>
                </div>
                <HandHeart className="w-5 h-5 text-accent" />
              </div>
              <div className="space-y-3">
                <Textarea
                  placeholder={canUpdate ? "Share an update..." : "Write an encouraging message, share a scripture, or offer support..."}
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  maxLength={1000}
                  className="min-h-[100px] bg-background/70 border-accent/20 focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
                  autoFocus
                />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">
                    {1000 - postText.length} characters remaining
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowPostForm(false);
                        setPostText("");
                      }}
                    >
                      Cancel
                    </Button>
                    {canUpdate && (
                      <Button
                        onClick={() => handlePostSubmit("testimony")}
                        disabled={!postText.trim() || isSubmittingPost}
                        size="sm"
                        className="bg-yellow-500 hover:bg-yellow-600 text-white"
                      >
                        <Trophy className="h-4 w-4 mr-2" />
                        {isSubmittingPost ? "Posting..." : "Share Testimony"}
                      </Button>
                    )}
                    <Button
                      onClick={() => handlePostSubmit(canUpdate ? "update" : "encouragement")}
                      disabled={!postText.trim() || isSubmittingPost}
                      size="sm"
                      className="bg-accent hover:bg-accent/90 text-accent-foreground"
                    >
                      {canUpdate ? (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          {isSubmittingPost ? "Posting..." : "Send Update"}
                        </>
                      ) : (
                        <>
                          <HandHeart className="h-4 w-4 mr-2" />
                          {isSubmittingPost ? "Sending..." : "Send Encouragement"}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Feed */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {allPosts.length > 0 ? (
            <div className="space-y-0">
              {allPosts.map((post, index) => (
                <div key={post.id} className={cn(
                  index > 0 && "border-t border-border"
                )}>
                  {renderPost(post, post.id === mainPost?.id)}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <HandHeart className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground mb-1">No posts found</p>
              <p className="text-sm text-muted-foreground/70">
                This thread appears to be empty
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}