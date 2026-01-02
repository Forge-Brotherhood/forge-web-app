"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useVerseOfTheDay } from "../hooks";
import { BookOpen, Loader2 } from "lucide-react";
import type { SupportedTranslation } from "@/core/models/bibleModels";
import { DEFAULT_TRANSLATION } from "@/core/models/bibleModels";
import { getPlainTextFromElements } from "./BibleContentRenderer";

interface VerseOfTheDayProps {
  translation?: SupportedTranslation;
  onVerseTap?: (reference: string) => void;
  className?: string;
}

export function VerseOfTheDay({
  translation = DEFAULT_TRANSLATION,
  onVerseTap,
  className,
}: VerseOfTheDayProps) {
  const { data, isLoading, error } = useVerseOfTheDay(translation);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5" />
            Verse of the Day
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data?.verseOfTheDay) {
    return null;
  }

  const { verseOfTheDay } = data;
  const quote = getPlainTextFromElements(verseOfTheDay.verse.elements);

  return (
    <Card
      className={`${className} ${onVerseTap ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}`}
      onClick={() => onVerseTap?.(verseOfTheDay.verse.reference)}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BookOpen className="h-5 w-5 text-primary" />
          Verse of the Day
        </CardTitle>
        {verseOfTheDay.devotionalTheme && (
          <p className="text-sm text-muted-foreground">
            {verseOfTheDay.devotionalTheme}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <blockquote className="italic text-foreground/90 mb-3 leading-relaxed">
          &ldquo;{quote}&rdquo;
        </blockquote>
        <p className="text-sm font-medium text-primary">
          {verseOfTheDay.verse.reference} ({verseOfTheDay.verse.translation})
        </p>
      </CardContent>
    </Card>
  );
}
