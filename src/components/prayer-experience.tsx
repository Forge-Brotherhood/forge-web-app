"use client";

import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PrayerExperienceProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PrayerExperience({ isOpen, onClose }: PrayerExperienceProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showBreathing, setShowBreathing] = useState(true);
  const [breathingProgress, setBreathingProgress] = useState(100);
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [showCounter, setShowCounter] = useState(false);
  const [breathInstruction, setBreathInstruction] = useState("");
  const [showGradient, setShowGradient] = useState(true);

  // Manage timers to avoid blur/backdrop flicker on rapid close/open
  const closeTimeoutRef = useRef<number | null>(null);
  const animateInTimeoutRef = useRef<number | null>(null);
  const showCounterTimeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    // Helper clear functions
    const clearTimers = () => {
      if (animateInTimeoutRef.current) {
        clearTimeout(animateInTimeoutRef.current);
        animateInTimeoutRef.current = null;
      }
      if (showCounterTimeoutRef.current) {
        clearTimeout(showCounterTimeoutRef.current);
        showCounterTimeoutRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };

    if (isOpen) {
      // Cancel any pending close fade-out to avoid backdrop blur flicker
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }

      setIsVisible(true);
      setShowBreathing(true);
      setShowCounter(false);
      setShowGradient(true);
      setBreathingProgress(100);
      setSecondsLeft(5);
      setBreathInstruction("");
      animateInTimeoutRef.current = window.setTimeout(() => setIsAnimating(true), 10);

      // Wait 1.5 seconds before showing counter and instructions
      showCounterTimeoutRef.current = window.setTimeout(() => {
        setShowCounter(true);
      }, 1500);

      // Start breathing countdown after settle time
      const startTime = Date.now();
      const duration = 10000; // 10 seconds for countdown
      const totalDuration = 11500; // 1.5s settle + 10s countdown

      intervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startTime;

        if (elapsed >= 1500) { // After settle period
          const countdownElapsed = elapsed - 1500;
          const progress = Math.max(0, 100 - (countdownElapsed / duration) * 100);
          const seconds = Math.max(0, Math.ceil((duration - countdownElapsed) / 1000));

          setBreathingProgress(progress);
          setSecondsLeft(seconds);

          // Update breathing instructions
          const breathCycle = (countdownElapsed / 1000) % 4; // 4-second breath cycle
          if (breathCycle < 2) {
            setBreathInstruction("Breathe in");
          } else {
            setBreathInstruction("Breathe out");
          }
        }

        if (elapsed >= totalDuration) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          // Fade out gradient to reveal video
          setShowGradient(false);
          // Don't transition away from breathing, keep video playing
        }
      }, 50);

      return () => clearTimers();
    } else {
      // Prepare to close: stop counters but delay backdrop fade-out to avoid flicker in rapid reopen
      if (animateInTimeoutRef.current) {
        clearTimeout(animateInTimeoutRef.current);
        animateInTimeoutRef.current = null;
      }
      if (showCounterTimeoutRef.current) {
        clearTimeout(showCounterTimeoutRef.current);
        showCounterTimeoutRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      setShowCounter(false);
      setShowGradient(true);

      closeTimeoutRef.current = window.setTimeout(() => {
        setIsAnimating(false);
        setIsVisible(false);
        setShowBreathing(true);
        closeTimeoutRef.current = null;
      }, 300);
    }
  }, [isOpen]);

  if (!isVisible) return null;

  // Calculate stroke-dashoffset for circular progress
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (breathingProgress / 100) * circumference;

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

        @keyframes breathPulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.05);
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

        .breathing-scale {
          animation: breathPulse 4s ease-in-out infinite;
        }
      `}</style>

      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div
          className="fixed inset-0"
          style={{
            backgroundColor: `rgba(0, 0, 0, ${isOpen ? 0.8 : 0})`,
            backdropFilter: isOpen ? "blur(24px)" : "none",
            WebkitBackdropFilter: "blur(24px)",
            transition: "background-color 300ms ease",
            willChange: "background-color",
            transform: "translateZ(0)",
            backfaceVisibility: "hidden",
            contain: "paint",
            pointerEvents: isOpen ? "auto" : "none"
          }}
          onClick={onClose}
        />

        {/* Content */}
        <div className={cn(
          "relative w-full h-full flex flex-col transition-all duration-300 ease-out overflow-hidden",
          isAnimating
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-8 scale-95 opacity-0"
        )}>
          {/* Close button */}
          <Button
            onClick={onClose}
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-10 text-white/80 hover:text-white"
          >
            <X className="w-6 h-6" />
          </Button>

          {/* Reflection Experience */}
          {showBreathing ? (
            <div className="flex-1 flex items-center justify-center relative overflow-hidden">
              {/* Background Video with Mux Player */}
              <div className="absolute inset-0 w-full h-full">
                <iframe
                  className="absolute top-1/2 left-1/2 min-w-full min-h-full w-auto h-auto"
                  src="https://player.mux.com/3ghrhZ9999sCFTFm00wHJx02iKdUdvAHcKb700fD7IDLOU?autoplay=true&muted=true&loop=true&controls=false&playsinline=true"
                  allow="autoplay; fullscreen"
                  allowFullScreen
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

              {/* Gradient overlay that fades away */}
              <div className={cn(
                "absolute inset-0 morphing-gradient transition-opacity duration-1000",
                showGradient ? "opacity-100" : "opacity-0"
              )} />

              {/* Semi-transparent overlay for better text visibility */}
              <div className={cn(
                "absolute inset-0 bg-black transition-opacity duration-1000",
                showGradient ? "bg-black/20" : "bg-black/40"
              )} />

              <div className={cn(
                "relative z-10 flex flex-col items-center justify-center transition-all duration-1000",
                showCounter && showGradient ? "opacity-100" : "opacity-0"
              )}>
                {/* Circular Progress */}
                <div className="relative w-40 h-40 mb-8">
                  <svg className="w-full h-full transform -rotate-90">
                    {/* Background circle */}
                    <circle
                      cx="80"
                      cy="80"
                      r={radius}
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.2)"
                      strokeWidth="4"
                    />
                    {/* Progress circle */}
                    <circle
                      cx="80"
                      cy="80"
                      r={radius}
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.9)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      style={{
                        transition: "stroke-dashoffset 0.05s linear"
                      }}
                    />
                  </svg>
                  {/* Counter in center */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-5xl font-light text-white">
                      {secondsLeft}
                    </span>
                  </div>
                </div>

                {/* Breathing instruction */}
                <div className="text-center">
                  <h2 className={cn(
                    "text-3xl font-light text-white mb-2 transition-opacity duration-500",
                    breathInstruction ? "opacity-100" : "opacity-0"
                  )}>
                    {breathInstruction || "Take a moment"}
                  </h2>
                  <p className="text-white/60 text-lg">
                    Center yourself in peace
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Prayer content area - empty scaffold for now */
            <div className="flex-1 flex items-center justify-center p-8 bg-background">
              <div className={cn(
                "text-center max-w-md transition-all duration-500",
                !showBreathing
                  ? "translate-y-0 opacity-100"
                  : "translate-y-4 opacity-0"
              )}>
                <h2 className="text-2xl font-semibold mb-4 text-foreground">
                  Prayer Experience
                </h2>
                <p className="text-muted-foreground">
                  Your prayer experience will appear here
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}