"use client";

import { HandHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PrayNowButtonProps {
  onClick: () => void;
  disabled?: boolean;
  prayerCount?: number;
}

export function PrayNowButton({ onClick, disabled = false, prayerCount = 0 }: PrayNowButtonProps) {
  return (
    <Button
      onClick={onClick}
      size="lg"
      disabled={disabled}
      className={cn(
        "w-full mb-6 shadow-lg",
        disabled ? "bg-muted hover:bg-muted cursor-not-allowed" : "bg-accent hover:bg-accent/90",
        "flex items-center gap-2"
      )}
    >
      <HandHeart className="w-5 h-5" />
      {disabled ? "No Prayers Saved" : "Pray Now"}
    </Button>
  );
}