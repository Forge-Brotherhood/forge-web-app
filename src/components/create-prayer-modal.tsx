"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, Eye, EyeOff, Loader2 } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { useProfile } from "@core/hooks";
import { useCreateThreadMutation } from "@features/prayer";
import { useRouter } from "next/navigation";
import { MediaUpload } from "@/components/media-upload";

interface CreatePrayerModalProps {
  onClose: () => void;
}

type PostingScope = "community" | "group" | "both";

export function CreatePrayerModal({ onClose }: CreatePrayerModalProps) {
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [prayerText, setPrayerText] = useState("");
  const [uploadedMedia, setUploadedMedia] = useState<any[]>([]);
  const [postingScope, setPostingScope] = useState<PostingScope>("community");
  const [hasUserSelectedScope, setHasUserSelectedScope] = useState(false);
  const { user } = useUser();
  const { profile, getPostingOptions } = useProfile();
  const router = useRouter();
  const createThreadMutation = useCreateThreadMutation();

  // Check if any media is still uploading or processing
  const hasUploadingMedia = uploadedMedia.some(media => 
    media.status === 'uploading' || media.status === 'processing'
  );

  // Get posting options based on user's group memberships
  const postingOptions = getPostingOptions();

  // Initialize posting scope based on available options
  React.useEffect(() => {
    // Only set initial value if user hasn't made a manual selection
    if (!hasUserSelectedScope) {
      if (postingOptions.communityOnly) {
        setPostingScope("community");
      } else if (postingOptions.canPostToGroups) {
        setPostingScope("both"); // Default to sharing with both group and community
      }
    }
  }, [postingOptions, hasUserSelectedScope]);

  // Handle posting scope changes
  const handleScopeChange = (newScope: PostingScope) => {
    console.log('Scope change requested:', newScope, 'Current scope:', postingScope);
    setPostingScope(newScope);
    setHasUserSelectedScope(true);
  };

  const getInitials = () => {
    // Use profile displayName first, then fall back to Clerk data
    if (profile?.displayName) {
      return profile.displayName
        .split(" ")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (user?.firstName) {
      return user.firstName.charAt(0).toUpperCase();
    }
    return <User className="h-4 w-4" />;
  };

  const handleSubmit = async () => {
    if (!prayerText.trim() || createThreadMutation.isPending) return;

    try {
      // Process media for API
      const mediaIds: string[] = [];
      const mediaUrls: any[] = [];

      uploadedMedia.forEach(media => {
        if ('mediaId' in media) {
          // Video with database record
          mediaIds.push(media.mediaId);
        } else {
          // Image
          mediaUrls.push({
            url: media.url,
            type: media.type || 'image',
            width: media.width,
            height: media.height,
          });
        }
      });

      const result = await createThreadMutation.mutateAsync({
        content: prayerText.trim(),
        isAnonymous,
        sharedToCommunity: postingScope === "community" || postingScope === "both",
        groupId: postingScope === "group" || postingScope === "both" ? 
          postingOptions.groups[0]?.groupId : null,
        mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
      });
      
      // Close modal and navigate to the thread
      onClose();
      router.push(`/threads/${result.id}`);
    } catch (error) {
      console.error("Error creating prayer request:", error);
      // TODO: Show error toast
    }
  };

  return (
    <div className="space-y-6">
      {/* Author Section */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={profile?.profileImageUrl || undefined} alt="You" />
            <AvatarFallback>
              {isAnonymous ? "?" : getInitials()}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">
              {isAnonymous ? "Post anonymously" : (profile?.displayName || user?.firstName || "You")}
            </p>
            <p className="text-sm text-muted-foreground">
              {postingOptions.communityOnly 
                ? "Share with the community"
                : postingScope === "both" 
                  ? "Share with your group and community"
                  : postingScope === "group"
                    ? "Share with your group only"
                    : "Share with the community"}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsAnonymous(!isAnonymous)}
          className="text-muted-foreground hover:text-foreground"
        >
          {isAnonymous ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>

      {/* Form Fields */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Textarea
            placeholder="What&apos;s on your heart? Share your prayer request..."
            className="min-h-[120px] resize-none text-base leading-relaxed"
            value={prayerText}
            onChange={(e) => setPrayerText(e.target.value)}
          />
          {prayerText.length > 0 && (
            <p className="text-xs text-muted-foreground px-1">
              {prayerText.split(/\s+/).filter(word => word.length > 0).length} words
            </p>
          )}
        </div>

        {/* Media Upload */}
        <div className="space-y-2">
          <MediaUpload 
            onMediaChange={setUploadedMedia}
            maxItems={3}
            disabled={createThreadMutation.isPending}
          />
        </div>

        {/* Posting Scope Selection */}
        {postingOptions.canPostToGroups && (
          <div className="space-y-3">
            <label className="text-sm font-medium">Share with:</label>
            <div className="grid gap-2">
              <Button
                type="button"
                variant={postingScope === "both" ? "default" : "outline"}
                size="sm"
                onClick={() => handleScopeChange("both")}
                className="justify-start h-10 text-sm"
                disabled={createThreadMutation.isPending}
              >
                My group and community
              </Button>
              <Button
                type="button"
                variant={postingScope === "group" ? "default" : "outline"}
                size="sm"
                onClick={() => handleScopeChange("group")}
                className="justify-start h-10 text-sm"
                disabled={createThreadMutation.isPending}
              >
                My group only
              </Button>
              <Button
                type="button"
                variant={postingScope === "community" ? "default" : "outline"}
                size="sm"
                onClick={() => handleScopeChange("community")}
                className="justify-start h-10 text-sm"
                disabled={createThreadMutation.isPending}
              >
                Community only
              </Button>
            </div>
          </div>
        )}

        {/* Community-Only Notice for Non-Group Users */}
        {postingOptions.communityOnly && (
          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <span className="font-medium">Posting to community:</span> You&apos;re not part of a prayer group yet, so this will be shared with the community.
            </p>
          </div>
        )}
      </div>

      {/* Privacy Notice */}
      <div className="bg-muted/50 rounded-lg p-3">
        <p className="text-sm text-muted-foreground">
          {isAnonymous ? (
            <>
              <span className="font-medium text-foreground">Anonymous post:</span> Your identity will be hidden from other users.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Public post:</span> Your name and profile will be visible to the community.
            </>
          )}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between items-center pt-2">
        <Button 
          variant="ghost" 
          onClick={onClose}
          disabled={createThreadMutation.isPending}
        >
          Cancel
        </Button>
        <Button 
          onClick={handleSubmit} 
          disabled={!prayerText.trim() || createThreadMutation.isPending || hasUploadingMedia}
          className="min-w-[100px]"
        >
          {createThreadMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sharing...
            </>
          ) : hasUploadingMedia ? (
            "Uploading Media..."
          ) : (
            "Share Request"
          )}
        </Button>
      </div>
    </div>
  );
}