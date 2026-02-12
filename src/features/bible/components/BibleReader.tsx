"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, BookOpen } from "lucide-react";
import { TranslationPicker } from "./TranslationPicker";
import { BookSelector } from "./BookSelector";
import { ChapterSelector } from "./ChapterSelector";
import { ChapterContent } from "./ChapterContent";
import type {
  BibleBook,
  BibleChapter,
  SupportedTranslation,
} from "@/core/models/bibleModels";
import { DEFAULT_TRANSLATION } from "@/core/models/bibleModels";

type ReaderState =
  | { view: "books" }
  | { view: "chapters"; book: BibleBook }
  | { view: "reading"; book: BibleBook; chapter: BibleChapter };

interface BibleReaderProps {
  initialTranslation?: SupportedTranslation;
  className?: string;
}

export function BibleReader({
  initialTranslation = DEFAULT_TRANSLATION,
  className,
}: BibleReaderProps) {
  const [translation, setTranslation] =
    useState<SupportedTranslation>(initialTranslation);
  const [state, setState] = useState<ReaderState>({ view: "books" });

  const handleBookSelect = (book: BibleBook) => {
    setState({ view: "chapters", book });
  };

  const handleChapterSelect = (chapter: BibleChapter) => {
    if (state.view === "chapters") {
      setState({ view: "reading", book: state.book, chapter });
    }
  };

  const handleBack = () => {
    if (state.view === "reading") {
      setState({ view: "chapters", book: state.book });
    } else if (state.view === "chapters") {
      setState({ view: "books" });
    }
  };

  const getTitle = () => {
    switch (state.view) {
      case "books":
        return "Bible";
      case "chapters":
        return state.book.name;
      case "reading":
        return state.chapter.reference;
    }
  };

  return (
    <div className={`flex flex-col h-full ${className || ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-2">
          {state.view !== "books" ? (
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <span className="font-semibold">Bible</span>
            </div>
          )}

          {state.view !== "books" && (
            <span className="text-muted-foreground">{getTitle()}</span>
          )}
        </div>

        <TranslationPicker
          value={translation}
          onChange={(t) => setTranslation(t as SupportedTranslation)}
          compact
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {state.view === "books" && (
          <BookSelector translation={translation} onSelect={handleBookSelect} />
        )}
        {state.view === "chapters" && (
          <ChapterSelector
            book={state.book}
            translation={translation}
            onSelect={handleChapterSelect}
          />
        )}
        {state.view === "reading" && (
          <ChapterContent chapter={state.chapter} translation={translation} />
        )}
      </div>
    </div>
  );
}
