"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2 } from "lucide-react";
import { useBibleTranslations } from "../hooks/useBible";

interface TranslationPickerProps {
  value: string;
  onChange: (translation: string) => void;
  compact?: boolean;
}

export function TranslationPicker({
  value,
  onChange,
  compact = false,
}: TranslationPickerProps) {
  const { data, isLoading, error } = useBibleTranslations();

  // Show loading state
  if (isLoading) {
    return (
      <Button variant="outline" size={compact ? "sm" : "default"} disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    );
  }

  // Fallback if error or no data - includes all supported translations
  const translations = data?.translations ?? [
    { code: "NLT", name: "New Living Translation" },
    { code: "BSB", name: "Berean Standard Bible" },
    { code: "KJV", name: "King James Version" },
    { code: "WEB", name: "World English Bible" },
    { code: "ASV", name: "American Standard Version" },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={compact ? "sm" : "default"}>
          {value}
          <ChevronDown className="ml-1 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {translations.map(({ code, name }) => (
          <DropdownMenuItem
            key={code}
            onClick={() => onChange(code)}
            className={value === code ? "bg-accent" : ""}
          >
            <span className="font-medium mr-2">{code}</span>
            <span className="text-muted-foreground text-sm">{name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
