"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  label?: string;
  fallbackPath?: string;
}

export function BackButton({ label = "Back", fallbackPath }: BackButtonProps) {
  const router = useRouter();

  const handleBack = () => {
    if (fallbackPath && typeof window !== "undefined" && window.history.length <= 1) {
      router.push(fallbackPath);
    } else {
      router.back();
    }
  };

  return (
    <button
      onClick={handleBack}
      className="flex items-center gap-2 py-2 pl-2 pr-3 -ml-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors duration-200"
    >
      <ArrowLeft className="h-5 w-5" />
      <span className="text-sm">{label}</span>
    </button>
  );
}
