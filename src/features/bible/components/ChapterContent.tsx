"use client";

import { useBibleChapter } from "../hooks";
import { Loader2 } from "lucide-react";
import type { BibleChapter, SupportedTranslation } from "@/core/models/bibleModels";

interface ChapterContentProps {
  chapter: BibleChapter;
  translation: SupportedTranslation;
}

export function ChapterContent({ chapter, translation }: ChapterContentProps) {
  const { data, isLoading, error } = useBibleChapter(chapter.id, translation);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data?.chapter) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Failed to load chapter content. Please try again.
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-4">
        {data.chapter.chapter.reference}
      </h2>

      {/* Render HTML content from API.Bible */}
      <div
        className="prose prose-sm dark:prose-invert max-w-none leading-relaxed bible-content"
        dangerouslySetInnerHTML={{ __html: data.chapter.content }}
      />

      {/* Copyright notice - required by API.Bible */}
      <div className="mt-8 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {data.chapter.copyright}
        </p>
      </div>
    </div>
  );
}
