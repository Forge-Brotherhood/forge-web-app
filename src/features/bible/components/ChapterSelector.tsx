"use client";

import { useBibleChapters } from "../hooks";
import { Loader2 } from "lucide-react";
import type { BibleBook, BibleChapter, SupportedTranslation } from "@/core/models/bibleModels";

interface ChapterSelectorProps {
  book: BibleBook;
  translation: SupportedTranslation;
  onSelect: (chapter: BibleChapter) => void;
}

export function ChapterSelector({
  book,
  translation,
  onSelect,
}: ChapterSelectorProps) {
  const { data, isLoading, error } = useBibleChapters(book.id, translation);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data?.chapters) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Failed to load chapters. Please try again.
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-4">{book.name}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Select a chapter to read
      </p>
      <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
        {data.chapters.map((chapter) => (
          <button
            key={chapter.id}
            onClick={() => onSelect(chapter)}
            className="aspect-square flex items-center justify-center rounded-lg border border-border hover:bg-accent hover:border-accent transition-colors font-medium"
          >
            {chapter.number}
          </button>
        ))}
      </div>
    </div>
  );
}
