"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import "photoswipe/dist/photoswipe.css";

// Dynamically import PhotoSwipe components to reduce initial bundle size
const Gallery = dynamic(() => import("react-photoswipe-gallery").then((mod) => ({ default: mod.Gallery })), {
  ssr: false,
});

const Item = dynamic(() => import("react-photoswipe-gallery").then((mod) => ({ default: mod.Item })), {
  ssr: false,
});

// Dynamically import VideoPlayer to reduce initial bundle size
const VideoPlayer = dynamic(() => import("@/components/video-player").then((mod) => ({ default: mod.VideoPlayer })), {
  ssr: false,
  loading: () => (
    <div className="aspect-video flex items-center justify-center bg-gray-100 rounded-lg">
      <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
    </div>
  ),
});

interface MediaItem {
  id: string;
  type: "image" | "video" | "audio";
  url: string;
  width?: number | null;
  height?: number | null;
  durationS?: number | null;
  muxPlaybackId?: string | null;
  uploadStatus?: string;
}

interface PhotoSwipeGalleryProps {
  media: MediaItem[];
  onItemClick?: (index: number) => void;
  className?: string;
}

export function PhotoSwipeGallery({ media, onItemClick, className }: PhotoSwipeGalleryProps) {
  if (!media || media.length === 0) return null;

  // PhotoSwipe options to disable unwanted features
  const options = {
    showHideAnimationType: 'zoom' as const,
    showAnimationDuration: 250,
    hideAnimationDuration: 250,
    bgOpacity: 0.95,
    padding: { top: 40, bottom: 40, left: 20, right: 20 },
    allowPanToNext: true,
    pinchToClose: true,
    closeOnVerticalDrag: true,
    // Disable unwanted features
    clickToCloseNonZoomable: true,
    imageClickAction: 'close' as const,
    tapAction: 'toggle-controls' as const,
    doubleTapAction: 'zoom' as const,
    // Remove download button and other UI elements
    zoom: true,
    close: true,
    counter: true,
    arrowPrev: true,
    arrowNext: true,
  };

  // Separate images and videos for different handling
  const images = media.filter(item => item.type === "image");
  const videos = media.filter(item => item.type === "video");
  const hasImages = images.length > 0;
  const hasVideos = videos.length > 0;

  return (
    <div className={className}>
      {/* Video Grid - Videos auto-play and handle their own fullscreen */}
      {hasVideos && (
        <div className="grid grid-cols-1 gap-4 mb-4">
          {videos.map((video, index) => (
            <VideoPlayer
              key={video.id}
              video={video}
              autoPlay={true}
              className=""
              onFullscreenClick={() => onItemClick?.(media.indexOf(video))}
            />
          ))}
        </div>
      )}

      {/* Image Gallery with PhotoSwipe */}
      {hasImages && (
        <Gallery options={options}>
          <div className={`grid grid-cols-2 gap-2 ${hasVideos ? 'mt-4' : ''}`}>
            {images.map((image, index) => (
              <Item
                key={image.id}
                original={image.url}
                thumbnail={image.url}
                width={image.width || 1200}
                height={image.height || 800}
              >
                {({ ref, open }) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    ref={ref}
                    onClick={(e) => {
                      e.stopPropagation();
                      open(e);
                      onItemClick?.(media.indexOf(image));
                    }}
                    src={image.url}
                    alt={`Image ${index + 1}`}
                    className="cursor-pointer w-full h-32 object-cover rounded-lg"
                  />
                )}
              </Item>
            ))}
          </div>
          
          {/* Include all images in gallery for swiping, even if some are not displayed */}
          {images.length > 4 && images.slice(4).map((image) => (
            <Item
              key={`hidden-${image.id}`}
              original={image.url}
              thumbnail={image.url}
              width={image.width || 1200}
              height={image.height || 800}
            >
              {() => <div style={{display: 'none'}} />}
            </Item>
          ))}
        </Gallery>
      )}
    </div>
  );
}

// Component for displaying media in a grid with mixed content
interface MediaGridGalleryProps {
  media: MediaItem[];
  maxItems?: number;
  className?: string;
}

export function MediaGridGallery({ media, maxItems = 4, className = "" }: MediaGridGalleryProps) {
  const displayMedia = media.slice(0, maxItems);
  const remainingCount = media.length - maxItems;

  if (media.length === 0) return null;

  const images = media.filter(item => item.type === "image");
  const videos = media.filter(item => item.type === "video");
  const displayImages = images.slice(0, maxItems);
  const displayVideos = videos.slice(0, maxItems);


  return (
    <div className={className}>
      {/* Videos */}
      {displayVideos.length > 0 && (
        <div className="grid grid-cols-1 gap-2 mb-4">
          {displayVideos.map((video, index) => (
            <VideoPlayer
              key={video.id}
              video={video}
              autoPlay={true}
              className=""
            />
          ))}
        </div>
      )}

      {/* Images with single PhotoSwipe Gallery */}
      {images.length > 0 && (
        <Gallery options={{
          showHideAnimationType: 'fade' as const,
          bgOpacity: 0.95,
          clickToCloseNonZoomable: true,
          imageClickAction: 'close' as const,
          tapAction: 'toggle-controls' as const,
          doubleTapAction: 'zoom' as const,
          zoom: true,
          close: true,
          counter: true,
          arrowPrev: true,
          arrowNext: true,
        }}>
          <div className="grid grid-cols-2 gap-2">
            {displayImages.map((image, index) => (
              <Item
                key={image.id}
                original={image.url}
                thumbnail={image.url}
                width={image.width || 1200}
                height={image.height || 800}
              >
                {({ ref, open }) => (
                  <div className="relative group" ref={ref}>
                    <div
                      className="w-full h-32 overflow-hidden rounded-lg cursor-pointer"
                      onClick={open}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={`Image ${index + 1}`}
                        className="w-full h-full object-cover transition-opacity group-hover:opacity-90"
                        onError={(e) => {
                          console.warn('Failed to load image:', image.url);
                        }}
                      />
                    </div>
                    {index === maxItems - 1 && remainingCount > 0 && (
                      <div 
                        className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center cursor-pointer"
                        onClick={open}
                      >
                        <span className="text-white text-sm font-medium">
                          +{remainingCount} more
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </Item>
            ))}
          </div>
          
          {/* Hidden images for gallery swiping */}
          {images.slice(maxItems).map((image) => (
            <Item
              key={`hidden-${image.id}`}
              original={image.url}
              thumbnail={image.url}
              width={image.width || 1200}
              height={image.height || 800}
            >
              {() => <div style={{display: 'none'}} />}
            </Item>
          ))}
        </Gallery>
      )}
    </div>
  );
}