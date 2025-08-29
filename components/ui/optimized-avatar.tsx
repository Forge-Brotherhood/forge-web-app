"use client";

import { useState, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface OptimizedAvatarProps {
  userId: string;
  avatarUrl?: string | null;
  size?: "thumbnail" | "avatar" | "large";
  fallbackText: string;
  className?: string;
}

export function OptimizedAvatar({ 
  userId, 
  avatarUrl, 
  size = "avatar", 
  fallbackText, 
  className 
}: OptimizedAvatarProps) {
  const [currentSrc, setCurrentSrc] = useState<string | undefined>();

  // Generate image-resizer API URL
  useEffect(() => {
    if (!avatarUrl || !avatarUrl.includes(process.env.NEXT_PUBLIC_S3_BUCKET_NAME || '')) {
      setCurrentSrc(avatarUrl || undefined);
      return;
    }

    try {
      const urlParts = avatarUrl.split('/');
      const filename = urlParts[urlParts.length - 1];
      const userPath = `profile-pictures/${userId}`;
      const imagePath = `${userPath}/${filename}`;

      const sizeConfig = {
        thumbnail: { width: 50, height: 50 },
        avatar: { width: 200, height: 200 },
        large: { width: 400, height: 400 }
      };

      const config = sizeConfig[size];
      
      // Use image-resizer API for resized versions
      const imageResizerUrl = process.env.NEXT_PUBLIC_IMAGE_RESIZER_API_URL || 
                             'https://fe1l5p9vy1.execute-api.us-east-1.amazonaws.com/production';
      
      const resizedUrl = `${imageResizerUrl}/${imagePath}?width=${config.width}&height=${config.height}`;
      setCurrentSrc(resizedUrl);
      
    } catch (error) {
      console.error('Error generating resized URL:', error);
      setCurrentSrc(avatarUrl || undefined);
    }
  }, [avatarUrl, userId, size]);

  return (
    <Avatar className={className}>
      {currentSrc && (
        <AvatarImage 
          src={currentSrc} 
          alt={`${fallbackText}'s avatar`}
        />
      )}
      <AvatarFallback>
        {fallbackText.substring(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}