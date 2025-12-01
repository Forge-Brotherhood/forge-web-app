"use client";

import { useEffect, useState, useRef } from "react";
import { X, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePrayerExperience, type Stage } from "@/hooks/use-prayer-experience";
import MuxPlayer from "@mux/mux-player-react";

interface PrayerExperienceProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PrayerExperienceNew({ isOpen, onClose }: PrayerExperienceProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showGradient, setShowGradient] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [fadeOpacity, setFadeOpacity] = useState(0);
  const [audioVolume, setAudioVolume] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const playerRef = useRef<any>(null);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    stages,
    currentStage,
    currentStageIndex,
    goToNext,
    goToPrevious,
    reset,
    isLoading,
    config,
    hasNoPrayers
  } = usePrayerExperience();

  // Handle opening/closing animation and reset
  useEffect(() => {
    if (isOpen) {
      // Check if there are no prayers
      if (hasNoPrayers) {
        onClose();
        return;
      }

      // Always reset to beginning when opening
      reset();
      setIsVisible(true);
      setShowGradient(true);
      setFadeOpacity(0);
      setAudioVolume(1);
      setIsTransitioning(false);
      setTimeout(() => setIsAnimating(true), 10);
    } else {
      setIsAnimating(false);
      // Clear any audio fade timeout
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }
      setTimeout(() => {
        setIsVisible(false);
        setShowGradient(true);
        // Reset experience to beginning when closed
        reset();
      }, 300);
    }
  }, [isOpen, reset, hasNoPrayers, onClose]);

  // Handle reflection stage
  useEffect(() => {
    if (!currentStage || currentStage.type !== "reflection") {
      setShowGradient(false);
      return;
    }

    // Show gradient overlay for reflection stage
    setShowGradient(true);
  }, [currentStage]);

  // Handle video and audio fade-out on wrap-up stage
  useEffect(() => {
    if (currentStage?.type === "wrap-up") {
      // Clear any existing fade timeout
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }

      // Start 3-second fade-out
      const startTime = Date.now();
      const fadeDuration = 3000; // 3 seconds

      const fadeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / fadeDuration);
        const volume = 1 - progress; // Volume goes from 1 to 0

        setFadeOpacity(progress);
        setAudioVolume(volume);

        // Set volume on MuxPlayer
        if (playerRef.current && !isMuted) {
          try {
            playerRef.current.volume = volume;
          } catch (e) {
            // Ignore volume setting errors
          }
        }

        if (progress >= 1) {
          clearInterval(fadeInterval);
        }
      }, 50);

      fadeTimeoutRef.current = fadeInterval;

      return () => {
        clearInterval(fadeInterval);
      };
    } else {
      // Reset fade for other stages
      setFadeOpacity(0);
      setAudioVolume(1);
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }
    }
  }, [currentStage, isMuted]);

  // Peaceful transition between stages
  const transitionToNextStage = () => {
    if (isTransitioning) return;

    setIsTransitioning(true);

    // Special handling for reflection to prayer transition
    if (currentStage?.type === "reflection") {
      // Slower, smoother fade for reflection
      setTimeout(() => {
        setShowGradient(false); // Fade out the gradient first
        setTimeout(() => {
          goToNext();
          // Longer fade-in for prayer content
          setTimeout(() => {
            setIsTransitioning(false);
          }, 500);
        }, 500);
      }, 300);
    } else {
      // Normal transition for other stages
      setTimeout(() => {
        goToNext();
        // Fade back in
        setTimeout(() => {
          setIsTransitioning(false);
        }, 300);
      }, 300);
    }
  };

  const transitionToPreviousStage = () => {
    if (isTransitioning) return;

    setIsTransitioning(true);

    // Fade out content
    setTimeout(() => {
      goToPrevious();
      // Fade back in
      setTimeout(() => {
        setIsTransitioning(false);
      }, 300);
    }, 300);
  };

  // Handle tap zones with peaceful transitions
  const handleTapZone = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    // Allow tapping to skip during reflection, prevent during transitions
    if (isTransitioning) return;

    // If on reflection stage, skip to next
    if (currentStage?.type === "reflection" && showGradient) {
      transitionToNextStage();
      return;
    }

    // Navigation with peaceful transitions
    if (x < width * 0.3) {
      transitionToPreviousStage();
    } else {
      // If on last stage and tapping forward, close modal
      if (currentStageIndex === stages.length - 1) {
        onClose();
      } else {
        transitionToNextStage();
      }
    }
  };

  // Handle mute/unmute
  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  if (!isVisible || isLoading) return null;

  // Calculate progress bar segments
  const progressSegments = stages.map((_, index) => ({
    isActive: index === currentStageIndex,
    isPassed: index < currentStageIndex
  }));

  return (
    <>
      <style jsx>{`
        @keyframes morphGradient {
          0% {
            background-position: 0% 50%, 100% 50%, 50% 100%;
            background-size: 200% 200%, 200% 200%, 200% 200%;
          }
          25% {
            background-position: 100% 50%, 0% 100%, 100% 0%;
            background-size: 300% 300%, 150% 150%, 250% 250%;
          }
          50% {
            background-position: 100% 100%, 100% 0%, 0% 100%;
            background-size: 200% 200%, 300% 300%, 200% 200%;
          }
          75% {
            background-position: 0% 100%, 50% 50%, 100% 50%;
            background-size: 250% 250%, 200% 200%, 300% 300%;
          }
          100% {
            background-position: 0% 50%, 100% 50%, 50% 100%;
            background-size: 200% 200%, 200% 200%, 200% 200%;
          }
        }

        .morphing-gradient {
          background:
            radial-gradient(ellipse at top left, rgba(99, 102, 241, 0.8), transparent 60%),
            radial-gradient(ellipse at bottom right, rgba(168, 85, 247, 0.8), transparent 60%),
            radial-gradient(ellipse at center, rgba(59, 130, 246, 0.6), transparent 70%),
            linear-gradient(135deg, #667eea 0%, #764ba2 50%, #667eea 100%);
          animation: morphGradient 8s ease-in-out infinite;
        }

        @keyframes progressFill {
          from {
            width: 0%;
          }
          to {
            width: 100%;
          }
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.8s ease-out;
        }

        .animate-fadeInUp {
          animation: fadeInUp 0.8s ease-out;
        }

      `}</style>

      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div
          className={cn(
            "absolute inset-0 bg-black backdrop-blur-sm transition-opacity duration-300",
            isAnimating ? "opacity-80" : "opacity-0"
          )}
        />

        {/* Content */}
        <div className={cn(
          "relative w-full h-full flex flex-col transition-all duration-300 ease-out overflow-hidden",
          isAnimating
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-8 scale-95 opacity-0"
        )}>
          {/* Progress bar at top */}
          <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
            {progressSegments.map((segment, index) => (
              <div
                key={index}
                className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden"
              >
                <div
                  className={cn(
                    "h-full bg-white rounded-full transition-all duration-500 ease-out",
                    segment.isPassed && "w-full",
                    segment.isActive && "w-full",
                    !segment.isActive && !segment.isPassed && "w-0"
                  )}
                />
              </div>
            ))}
          </div>

          {/* Exit button */}
          <button
            onClick={onClose}
            className="absolute top-6 right-6 z-30 flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/20 transition-all"
          >
            <X className="w-5 h-5" />
            <span className="text-sm font-light">Exit</span>
          </button>

          {/* Mute/Unmute button */}
          <button
            onClick={toggleMute}
            className="absolute bottom-6 left-6 z-30 p-3 rounded-full bg-white/10 backdrop-blur-md text-white/80 hover:text-white hover:bg-white/20 transition-all"
          >
            {isMuted ? (
              <VolumeX className="w-6 h-6" />
            ) : (
              <Volume2 className="w-6 h-6" />
            )}
          </button>

          {/* Main content area with tap zones */}
          <div
            className="flex-1 flex relative overflow-hidden cursor-pointer"
            onClick={handleTapZone}
          >
            {/* Background Video with Mux Player */}
            <div className="absolute inset-0 w-full h-full">
              <MuxPlayer
                ref={playerRef}
                playbackId={(config.settings as any).muxPlaybackId}
                autoPlay
                muted={isMuted}
                loop
                playsInline
                volume={audioVolume}
                className="absolute top-1/2 left-1/2 min-w-full min-h-full w-auto h-auto"
                style={{
                  border: 'none',
                  transform: 'translate(-50%, -50%)',
                  width: '177.77vh', /* 16:9 aspect ratio */
                  minWidth: '100%',
                  height: '56.25vw', /* 16:9 aspect ratio */
                  minHeight: '100%'
                }}
              />
            </div>

            {/* Black fade overlay for wrap-up */}
            <div
              className="absolute inset-0 bg-black pointer-events-none"
              style={{
                opacity: fadeOpacity,
                transition: 'none'
              }}
            />

            {/* Gradient overlay for reflection */}
            {currentStage?.type === "reflection" && (
              <div className={cn(
                "absolute inset-0 morphing-gradient transition-opacity",
                showGradient ? "opacity-100" : "opacity-0"
              )}
              style={{
                transitionDuration: isTransitioning ? "800ms" : "1000ms",
                transitionTimingFunction: "cubic-bezier(0.4, 0.0, 0.2, 1)"
              }}
              />
            )}

            {/* Semi-transparent overlay */}
            <div className={cn(
              "absolute inset-0 bg-black transition-all",
              currentStage?.type === "reflection" && showGradient
                ? "bg-black/20"
                : "bg-black/40"
            )}
            style={{
              transitionDuration: "800ms",
              transitionTimingFunction: "cubic-bezier(0.4, 0.0, 0.2, 1)"
            }}
            />

            {/* Stage content */}
            <div className="relative z-10 flex-1 flex items-center justify-center p-8">
              {currentStage?.type === "reflection" && showGradient && (
                <div className={cn(
                  "flex flex-col items-center justify-center max-w-4xl transition-all duration-700 ease-out",
                  isTransitioning
                    ? "opacity-0 scale-95"
                    : "opacity-100 scale-100 animate-fadeInUp"
                )}>
                  <div className="text-center space-y-6">
                    <h2 className="text-4xl font-light text-white mb-4">
                      {currentStage.content.title}
                    </h2>

                    <div className="space-y-4 max-w-3xl">
                      <p className="text-white/90 text-lg font-light italic">
                        {currentStage.content.scripture}
                      </p>
                      {currentStage.content.scripture2 && (
                        <p className="text-white/90 text-lg font-light italic">
                          {currentStage.content.scripture2}
                        </p>
                      )}
                    </div>

                    <div className="mt-8">
                      <p className="text-white/80 text-xl font-light">
                        {currentStage.content.reflection}
                      </p>
                    </div>

                    <p className="text-white/40 text-sm mt-8 animate-pulse">
                      Tap to continue
                    </p>
                  </div>
                </div>
              )}

              {currentStage?.type === "prayer" && (
                <div className="max-w-2xl w-full">
                  <div className={cn(
                    "transition-all ease-out",
                    isTransitioning
                      ? "opacity-0 translate-y-8 duration-500"
                      : "opacity-100 translate-y-0 duration-700 animate-fadeInUp"
                  )}>
                    <h2 className="text-2xl font-semibold text-white mb-6 opacity-90">
                      {currentStage.content.title}
                    </h2>
                    <div className="bg-white/5 backdrop-blur-md rounded-xl p-8 shadow-2xl border border-white/10">
                      <p className="text-white/95 text-lg leading-loose font-light">
                        {currentStage.content.prayerText}
                      </p>
                    </div>
                    <p className="text-white/40 text-sm mt-6 text-center animate-pulse">
                      Tap to continue
                    </p>
                  </div>
                </div>
              )}

              {currentStage?.type === "wrap-up" && (
                <div className="text-center max-w-md">
                  <div className={cn(
                    "transition-all duration-300 ease-out",
                    isTransitioning
                      ? "opacity-0 translate-y-4"
                      : "opacity-100 translate-y-0 animate-fadeInUp"
                  )}>
                    <h2 className="text-3xl font-light text-white mb-6 opacity-90">
                      {currentStage.content.title}
                    </h2>
                    <p className="text-white/70 text-lg mb-3 font-light">
                      {currentStage.content.subtitle}
                    </p>
                    <p className="text-white/50 font-light">
                      {currentStage.content.description}
                    </p>
                    <Button
                      onClick={() => {
                        onClose();
                      }}
                      className="mt-10 bg-white/10 backdrop-blur text-white border border-white/20 hover:bg-white/20 transition-all duration-300 px-8 py-2"
                    >
                      Complete
                    </Button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </>
  );
}