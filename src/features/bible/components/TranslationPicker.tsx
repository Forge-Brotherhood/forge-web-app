"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { BIBLE_TRANSLATIONS, type SupportedTranslation } from "@/core/models/bibleModels";

interface TranslationPickerProps {
  value: SupportedTranslation;
  onChange: (translation: SupportedTranslation) => void;
  compact?: boolean;
}

export function TranslationPicker({
  value,
  onChange,
  compact = false,
}: TranslationPickerProps) {
  const translations = Object.entries(BIBLE_TRANSLATIONS) as [
    SupportedTranslation,
    { id: string; name: string }
  ][];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={compact ? "sm" : "default"}>
          {value}
          <ChevronDown className="ml-1 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {translations.map(([abbr, { name }]) => (
          <DropdownMenuItem
            key={abbr}
            onClick={() => onChange(abbr)}
            className={value === abbr ? "bg-accent" : ""}
          >
            <span className="font-medium mr-2">{abbr}</span>
            <span className="text-muted-foreground text-sm">{name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
