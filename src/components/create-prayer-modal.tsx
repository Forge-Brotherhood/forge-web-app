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

export function CreatePrayerModal({ onClose }: CreatePrayerModalProps) {
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [prayerText, setPrayerText] = useState("");
  const [uploadedMedia, setUploadedMedia] = useState<any[]>([]);
  const { user } = useUser();
  const { profile } = useProfile();
  const router = useRouter();
  const createThreadMutation = useCreateThreadMutation();

  // Check if any media is still uploading or processing
  const hasUploadingMedia = uploadedMedia.some(media =>
    media.status === 'uploading' || media.status === 'processing'
  );

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
        sharedToCommunity: true,
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
              Share with the community
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