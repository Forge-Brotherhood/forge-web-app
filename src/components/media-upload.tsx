"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Image, Video, X, Upload, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { VideoPlayer } from "@/components/video-player";

interface UploadedImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  type: string;
  status?: 'uploading' | 'ready' | 'error';
  previewUrl?: string; // Local preview URL
}

interface UploadedVideo {
  mediaId: string; // Database Media record ID
  uploadId: string;
  assetId?: string;
  uploadUrl: string;
  type: string;
  filename: string;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  previewUrl?: string; // Local preview URL or video thumbnail
}

type UploadedMedia = UploadedImage | UploadedVideo;

interface MediaUploadProps {
  onMediaChange: (media: UploadedMedia[]) => void;
  maxItems?: number;
  disabled?: boolean;
  allowImages?: boolean;
  allowVideos?: boolean;
}

export function MediaUpload({ 
  onMediaChange, 
  maxItems = 4, 
  disabled = false,
  allowImages = true,
  allowVideos = true 
}: MediaUploadProps) {
  const [media, setMedia] = useState<UploadedMedia[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  
  // Extract thumbnail from video file
  const extractVideoThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      video.autoplay = true;
      video.muted = true;
      video.src = URL.createObjectURL(file);
      
      video.onloadeddata = () => {
        // Set canvas size to video dimensions
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Draw the first frame
        context?.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to data URL
        canvas.toBlob((blob) => {
          if (blob) {
            const thumbnailUrl = URL.createObjectURL(blob);
            resolve(thumbnailUrl);
          } else {
            resolve(''); // Fallback to empty string if thumbnail extraction fails
          }
          // Clean up the video URL
          URL.revokeObjectURL(video.src);
        }, 'image/jpeg', 0.8);
      };
      
      video.onerror = () => {
        // If video can't be loaded, return empty string
        URL.revokeObjectURL(video.src);
        resolve('');
      };
    });
  };
  
  // Cleanup object URLs when component unmounts or media changes
  useEffect(() => {
    return () => {
      media.forEach(item => {
        if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, [media]);

  // Poll for video upload status via database
  useEffect(() => {
    const videosUploading = media.filter(item => 
      'mediaId' in item && 
      (item.status === 'uploading' || item.status === 'processing') &&
      !item.mediaId.startsWith('temp-') // Skip temporary placeholders
    );

    if (videosUploading.length === 0) return;

    const interval = setInterval(async () => {
      const mediaIds = videosUploading.map(v => 'mediaId' in v ? v.mediaId : '').filter(Boolean).join(',');
      
      try {
        const response = await fetch(`/api/upload/status?mediaIds=${mediaIds}`);
        if (response.ok) {
          const data = await response.json();
          const updatedMedia = [...media];
          let hasUpdates = false;

          data.media.forEach((dbMedia: any) => {
            const videoIndex = media.findIndex(m => 'mediaId' in m && m.mediaId === dbMedia.id);
            if (videoIndex !== -1) {
              const currentVideo = media[videoIndex] as UploadedVideo;
              
              if (dbMedia.uploadStatus === 'ready' && currentVideo.status !== 'ready') {
                // Update status but preserve preview URL
                updatedMedia[videoIndex] = { 
                  ...currentVideo, 
                  status: 'ready',
                  previewUrl: currentVideo.previewUrl // Explicitly preserve preview URL
                };
                hasUpdates = true;
              } else if (dbMedia.uploadStatus === 'error' && currentVideo.status !== 'error') {
                updatedMedia[videoIndex] = { 
                  ...currentVideo, 
                  status: 'error',
                  previewUrl: currentVideo.previewUrl // Explicitly preserve preview URL
                };
                hasUpdates = true;
              } else if (dbMedia.uploadStatus === 'processing' && currentVideo.status === 'uploading') {
                updatedMedia[videoIndex] = { 
                  ...currentVideo, 
                  status: 'processing',
                  previewUrl: currentVideo.previewUrl // Explicitly preserve preview URL
                };
                hasUpdates = true;
              }
            }
          });

          if (hasUpdates) {
            console.log('MediaUpload - Status update:', {
              before: media,
              after: updatedMedia,
              changes: data.media
            });
            setMedia(updatedMedia);
            onMediaChange(updatedMedia);
          }
        }
      } catch (error) {
        console.error('Error checking media status:', error);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [media, onMediaChange]);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    
    // Check if adding these files would exceed the limit
    if (media.length + fileArray.length > maxItems) {
      toast({
        title: "Too many files",
        description: `Maximum ${maxItems} items allowed per post`,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    
    // Create placeholders with preview URLs for both images and videos
    const placeholders: UploadedMedia[] = [];
    const previewPromises = fileArray.map(async (file, index) => {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      
      if (isVideo) {
        // Extract video thumbnail
        const previewUrl = await extractVideoThumbnail(file);
        return {
          mediaId: `temp-${Date.now()}-${index}`,
          uploadId: '',
          assetId: undefined,
          uploadUrl: '',
          type: 'video',
          filename: file.name,
          status: 'uploading',
          previewUrl,
        } as UploadedVideo;
      } else if (isImage) {
        // Create object URL for image preview
        const previewUrl = URL.createObjectURL(file);
        return {
          url: '',
          publicId: `temp-${Date.now()}-${index}`,
          width: 0,
          height: 0,
          format: file.type.split('/')[1] || 'unknown',
          bytes: file.size,
          type: 'image',
          status: 'uploading',
          previewUrl,
        } as UploadedImage;
      }
      return null;
    });
    
    const resolvedPlaceholders = (await Promise.all(previewPromises)).filter(p => p !== null) as UploadedMedia[];
    
    // Immediately update state with placeholders
    if (resolvedPlaceholders.length > 0) {
      const immediateMedia = [...media, ...resolvedPlaceholders];
      setMedia(immediateMedia);
      onMediaChange(immediateMedia);
      console.log('MediaUpload - Immediate placeholders set:', resolvedPlaceholders);
    }
    
    try {
      const uploadPromises = fileArray.map(async (file, fileIndex) => {
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');

        if (isVideo && !allowVideos) {
          throw new Error(`Videos not allowed`);
        }

        if (isImage && !allowImages) {
          throw new Error(`Images not allowed`);
        }

        if (!isVideo && !isImage) {
          throw new Error(`${file.name} is not a valid media file`);
        }

        if (isVideo) {
          const result = await uploadVideo(file);
          // Find and replace the placeholder
          const tempId = `temp-${Date.now()}-${fileIndex}`;
          return { ...result, tempId };
        } else {
          return await uploadImage(file);
        }
      });

      const uploadResults = await Promise.all(uploadPromises);
      
      // Replace placeholders with real upload data, preserving preview URLs
      let newMedia = [...media];
      
      // Find and replace placeholders
      uploadResults.forEach((result, index) => {
        // Find the corresponding placeholder
        let placeholderIndex = -1;
        let placeholderPreviewUrl: string | undefined;
        
        if ('mediaId' in result) {
          // For videos, find by temp mediaId pattern
          placeholderIndex = newMedia.findIndex(m => 
            'mediaId' in m && m.mediaId.startsWith('temp-') && 
            m.filename === fileArray[index].name
          );
        } else {
          // For images, find by temp publicId pattern
          placeholderIndex = newMedia.findIndex(m => 
            'publicId' in m && m.publicId.startsWith('temp-')
          );
        }
        
        if (placeholderIndex !== -1) {
          // Preserve the preview URL from the placeholder
          const placeholder = newMedia[placeholderIndex];
          placeholderPreviewUrl = placeholder.previewUrl;
          
          // Replace placeholder with real data, keeping the preview URL
          newMedia[placeholderIndex] = {
            ...result,
            status: 'mediaId' in result ? 'uploading' : 'ready',
            previewUrl: placeholderPreviewUrl
          };
        } else {
          // Shouldn't happen, but add as fallback
          newMedia.push(result);
        }
      });
      
      console.log('MediaUpload - Setting media:', {
        uploadResults,
        newMedia,
        hasVideos: uploadResults.some(r => 'status' in r),
        statuses: uploadResults.map(r => ('status' in r) ? r.status : 'image')
      });
      
      setMedia(newMedia);
      onMediaChange(newMedia);

      toast({
        title: "Media uploaded",
        description: `Successfully started upload of ${uploadResults.length} file${uploadResults.length > 1 ? 's' : ''}`,
      });
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload media",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const uploadImage = async (file: File): Promise<UploadedImage> => {
    // Validate file size
    if (file.size > 10 * 1024 * 1024) { // 10MB
      throw new Error(`Image ${file.name} exceeds 10MB limit`);
    }

    const formData = new FormData();
    formData.append('images', file);

    const response = await fetch('/api/upload/images', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Image upload failed');
    }

    const result = await response.json();
    return { ...result.images[0], status: 'ready' as const };
  };

  const uploadVideo = async (file: File): Promise<UploadedVideo> => {
    // Validate file size
    if (file.size > 500 * 1024 * 1024) { // 500MB
      throw new Error(`Video ${file.name} exceeds 500MB limit`);
    }

    // Step 1: Get upload URL from our API
    const uploadResponse = await fetch('/api/upload/videos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: file.name,
        fileSize: file.size,
        contentType: file.type,
      }),
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.json();
      throw new Error(error.error || 'Failed to get upload URL');
    }

    const { uploadUrl, uploadId, assetId, mediaId } = await uploadResponse.json();

    // Step 2: Upload directly to MUX
    const muxResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type,
      },
    });

    if (!muxResponse.ok) {
      throw new Error('Failed to upload video to MUX');
    }

    return {
      mediaId,
      uploadId,
      assetId,
      uploadUrl,
      type: 'video',
      filename: file.name,
      status: 'uploading',
    };
  };

  const removeMedia = (index: number) => {
    const itemToRemove = media[index];
    // Clean up object URL if it exists
    if (itemToRemove.previewUrl && itemToRemove.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(itemToRemove.previewUrl);
    }
    const newMedia = media.filter((_, i) => i !== index);
    setMedia(newMedia);
    onMediaChange(newMedia);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    if (disabled || isUploading) return;
    
    const files = e.dataTransfer.files;
    handleFileSelect(files);
  };

  const getAcceptedTypes = () => {
    const types = [];
    if (allowImages) types.push('image/*');
    if (allowVideos) types.push('video/*');
    return types.join(',');
  };

  const renderMediaPreview = (item: UploadedMedia, index: number) => {
    const isVideo = 'mediaId' in item;
    const isUploading = item.status === 'uploading';
    const previewUrl = item.previewUrl;
    const displayUrl = isVideo ? previewUrl : (item.url || previewUrl);

    return (
      <Card key={isVideo ? item.mediaId : item.publicId} className="relative overflow-hidden bg-gray-50 dark:bg-gray-900">
        <div className="aspect-square relative">
          {/* Background preview image/video thumbnail */}
          {displayUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={displayUrl}
              alt={`Upload ${index + 1}`}
              className={`w-full h-full object-cover ${isUploading ? 'opacity-50' : ''}`}
            />
          )}
          
          {/* Video icon if no thumbnail available */}
          {isVideo && !displayUrl && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
              <Video className="w-12 h-12 text-gray-400 dark:text-gray-600" />
            </div>
          )}
          
          {/* Status overlay */}
          {isVideo ? (
            <div className={`absolute inset-0 flex items-center justify-center ${
              displayUrl ? 'bg-black/40' : ''
            }`}>
              {item.status === 'uploading' ? (
                <div className="flex flex-col items-center space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-white drop-shadow-lg" />
                  <p className="text-xs text-white font-semibold drop-shadow-lg">Uploading...</p>
                </div>
              ) : item.status === 'processing' ? (
                <div className="flex flex-col items-center space-y-2">
                  <Video className="w-8 h-8 text-white drop-shadow-lg" />
                  <p className="text-xs text-white font-semibold drop-shadow-lg">Processing...</p>
                </div>
              ) : item.status === 'error' ? (
                <div className="flex flex-col items-center space-y-2">
                  <AlertCircle className="w-8 h-8 text-red-400 drop-shadow-lg" />
                  <p className="text-xs text-red-400 font-semibold drop-shadow-lg">Failed</p>
                </div>
              ) : (
                <div className="absolute bottom-2 left-2">
                  <Video className="w-5 h-5 text-white drop-shadow-lg" />
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Image status overlay */}
              {isUploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="flex flex-col items-center space-y-2">
                    <Loader2 className="w-8 h-8 animate-spin text-white drop-shadow-lg" />
                    <p className="text-xs text-white font-semibold drop-shadow-lg">Uploading...</p>
                  </div>
                </div>
              )}
              {!isUploading && (
                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors" />
              )}
            </>
          )}
          
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2 w-6 h-6"
            onClick={() => removeMedia(index)}
            disabled={disabled}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="p-2 bg-secondary/50">
          <p className="text-xs text-muted-foreground truncate">
            {isVideo ? (
              `${item.filename} • ${item.status}`
            ) : (
              `${item.width}×${item.height} • ${(item.bytes / 1024).toFixed(0)}KB`
            )}
          </p>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-3">
      {/* Upload Area */}
      {media.length < maxItems && (
        <Card
          className={`border-2 border-dashed transition-colors ${
            dragOver 
              ? 'border-accent bg-accent/5' 
              : 'border-border hover:border-accent/50'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !disabled && !isUploading && fileInputRef.current?.click()}
        >
          <div className="p-6 text-center">
            {isUploading ? (
              <div className="flex flex-col items-center space-y-2">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
                <p className="text-sm text-muted-foreground">Uploading media...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-2">
                <Upload className="w-8 h-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {allowImages && allowVideos && "Images up to 10MB, Videos up to 500MB"}
                    {allowImages && !allowVideos && "PNG, JPG, WEBP up to 10MB"}
                    {!allowImages && allowVideos && "MP4, MOV, WEBM up to 500MB"}
                    {" "}({maxItems - media.length} remaining)
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={getAcceptedTypes()}
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files)}
        disabled={disabled || isUploading}
      />

      {/* Media Previews */}
      {media.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {media.map((item, index) => renderMediaPreview(item, index))}
        </div>
      )}

    </div>
  );
}