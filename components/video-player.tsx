"use client";

import { useRef, useEffect, useState } from "react";
import { Loader2, Play, Pause, Volume2, VolumeX } from "lucide-react";
import dynamic from "next/dynamic";

// Dynamically import MuxPlayer to reduce initial bundle size
const MuxPlayer = dynamic(() => import("@mux/mux-player-react"), {
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

interface VideoPlayerProps {
  video: MediaItem;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
  onFullscreenClick?: () => void;
}

export function VideoPlayer({ 
  video, 
  autoPlay = false, 
  muted = true, 
  className = "",
  onFullscreenClick: _onFullscreenClick 
}: VideoPlayerProps) {
  console.log('VideoPlayer: Rendering with MUX player, video data:', video);
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(muted);
  const [showControls, setShowControls] = useState(false);
  const [wasUnmutedBeforeLeaving, setWasUnmutedBeforeLeaving] = useState(false);

  // Calculate aspect ratio from video dimensions
  const getAspectRatio = () => {
    console.log('VideoPlayer: Video dimensions:', { 
      width: video.width, 
      height: video.height, 
      id: video.id 
    });
    
    if (video.width && video.height && video.width > 0 && video.height > 0) {
      const ratio = `${video.width}/${video.height}`;
      console.log('VideoPlayer: Using calculated aspect ratio:', ratio);
      return ratio;
    }
    // Fallback to 16:9 for videos without dimension data
    console.log('VideoPlayer: Using fallback aspect ratio: 16/9');
    return '16/9';
  };

  const aspectRatio = getAspectRatio();

  // Get the playback ID - this is what MuxPlayer needs
  const getPlaybackId = () => {
    if (video.muxPlaybackId) {
      console.log('VideoPlayer: Using MUX playback ID:', video.muxPlaybackId);
      return video.muxPlaybackId;
    }
    
    console.log('VideoPlayer: No MUX playback ID found', { 
      muxPlaybackId: video.muxPlaybackId, 
      url: video.url,
      uploadStatus: video.uploadStatus 
    });
    return null;
  };

  const playbackId = getPlaybackId();

  // Control functions
  const togglePlayPause = () => {
    if (playerRef.current) {
      if (isPlaying) {
        playerRef.current.pause();
      } else {
        playerRef.current.play();
      }
    }
  };

  const toggleMute = () => {
    if (playerRef.current) {
      playerRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  // Ensure controls remain hidden using official CSS custom properties
  useEffect(() => {
    if (playerRef.current) {
      // Apply official MUX CSS custom properties to hide controls
      const element = playerRef.current;
      element.style.setProperty('--controls', 'none');
      element.style.setProperty('--top-controls', 'none');
      element.style.setProperty('--bottom-controls', 'none');
      element.style.setProperty('--center-controls', 'none');
    }
  }, [playbackId]);

  // Auto-play when scrolling into view, pause when out of view
  useEffect(() => {
    if (!playerRef.current || !containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsIntersecting(entry.isIntersecting);
        
        if (entry.isIntersecting) {
          // Coming into view
          if (autoPlay && playerRef.current) {
            try {
              // If video was unmuted before leaving, mute it when coming back
              if (wasUnmutedBeforeLeaving) {
                playerRef.current.muted = true;
                setIsMuted(true);
                setWasUnmutedBeforeLeaving(false);
              }
              (playerRef.current as any).play();
            } catch (err) {
              console.log('Auto-play prevented:', err);
            }
          }
        } else {
          // Going out of view
          if (playerRef.current && isPlaying) {
            // Remember if video was unmuted before pausing
            if (!isMuted) {
              setWasUnmutedBeforeLeaving(true);
            }
            (playerRef.current as any).pause();
          }
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [autoPlay, isPlaying, isMuted, wasUnmutedBeforeLeaving]);

  // MuxPlayer handles events through React props, so no manual event listeners needed

  // Show loading state for processing videos or when no playback ID
  if (video.uploadStatus === 'processing' || video.uploadStatus === 'uploading' || !playbackId) {
    return (
      <div className={`relative bg-gray-100 rounded-lg overflow-hidden ${className}`}>
        <div className="aspect-video flex items-center justify-center">
          <div className="flex flex-col items-center space-y-2">
            <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
            <p className="text-sm text-gray-500">
              {video.uploadStatus === 'uploading' ? 'Uploading...' : 
               video.uploadStatus === 'processing' ? 'Processing video...' :
               'Loading video...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error || video.uploadStatus === 'error') {
    return (
      <div className={`relative bg-gray-100 rounded-lg overflow-hidden ${className}`}>
        <div className="aspect-video flex items-center justify-center">
          <div className="flex flex-col items-center space-y-2">
            <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white text-sm">!</span>
            </div>
            <p className="text-sm text-gray-500">
              {error || "Failed to load video"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={`relative rounded-lg overflow-hidden ${className}`}
      style={{ aspectRatio: aspectRatio }}
    >
      <MuxPlayer
        ref={playerRef}
        playbackId={playbackId}
        metadata={{
          video_id: video.id,
          video_title: `Video ${video.id}`,
        }}
        streamType="on-demand"
        autoPlay={autoPlay ? "muted" : false}
        muted={muted}
        loop
        nohotkeys
        className="mux-player-no-controls"
        style={{ 
          width: '100%',
          height: '100%',
          '--controls': 'none',
          '--top-controls': 'none',
          '--bottom-controls': 'none',
          '--center-controls': 'none',
          '--media-object-fit': 'contain',
          '--media-object-position': 'center',
        } as any}
        onLoadStart={() => {
          console.log('MuxPlayer: Load start');
          setIsLoading(true);
        }}
        onLoadedData={() => {
          console.log('MuxPlayer: Loaded data');
          setIsLoading(false);
        }}
        onPlay={() => {
          console.log('MuxPlayer: Play');
          setIsPlaying(true);
        }}
        onPause={() => {
          console.log('MuxPlayer: Pause');
          setIsPlaying(false);
        }}
        onVolumeChange={(e: any) => {
          setIsMuted(e.target.muted);
        }}
        onError={(e: any) => {
          console.error('MuxPlayer: Error:', e);
          setError("Failed to load video");
          setIsLoading(false);
        }}
      />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-white" />
        </div>
      )}

      {/* Custom Controls Overlay */}
      {!isLoading && !error && (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-transparent cursor-pointer"
          onClick={togglePlayPause}
          onMouseEnter={() => setShowControls(true)}
          onMouseLeave={() => setShowControls(false)}
        >
          {/* Controls that show on hover or when paused */}
          <div className={`transition-opacity duration-300 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}>
            <div className="flex items-center space-x-4">
              {/* Play/Pause Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayPause();
                }}
                className="bg-black/60 hover:bg-black/80 rounded-full p-3 text-white transition-colors"
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6" />
                ) : (
                  <Play className="w-6 h-6" />
                )}
              </button>
              
              {/* Mute/Unmute Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute();
                }}
                className="bg-black/60 hover:bg-black/80 rounded-full p-2 text-white transition-colors"
              >
                {isMuted ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}