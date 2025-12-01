"use client";

import { HandHeart } from "lucide-react";
import { cn } from "@/lib/utils";

interface StartSessionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  prayerCount?: number;
}

export function StartSessionButton({
  onClick,
  disabled = false,
  prayerCount = 0,
}: StartSessionButtonProps) {
  const isEmpty = prayerCount === 0;
  const isDisabled = disabled || isEmpty;

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        "w-full flex items-center justify-center gap-3",
        "p-4 rounded-xl font-semibold text-base",
        "transition-all duration-200",
        "focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2",
        isDisabled
          ? "bg-muted text-muted-foreground cursor-not-allowed"
          : "bg-accent text-accent-foreground hover:bg-accent/90 active:scale-[0.98]"
      )}
    >
      <HandHeart className="w-5 h-5" />
      <span>
        {isEmpty ? "No Prayers Saved" : "Start Prayer Session"}
      </span>
    </button>
  );
}
