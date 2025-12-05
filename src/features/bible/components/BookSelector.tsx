"use client";

import { useBibleBooks } from "../hooks";
import { Loader2 } from "lucide-react";
import type { BibleBook, SupportedTranslation } from "@/core/models/bibleModels";

interface BookSelectorProps {
  translation: SupportedTranslation;
  onSelect: (book: BibleBook) => void;
}

export function BookSelector({ translation, onSelect }: BookSelectorProps) {
  const { data, isLoading, error } = useBibleBooks(translation);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data?.books) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Failed to load Bible books. Please try again.
      </div>
    );
  }

  const oldTestament = data.books.filter((b) => b.testament === "OT");
  const newTestament = data.books.filter((b) => b.testament === "NT");

  return (
    <div className="space-y-6 p-4">
      {/* Old Testament */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
          Old Testament
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {oldTestament.map((book) => (
            <button
              key={book.id}
              onClick={() => onSelect(book)}
              className="p-3 text-left rounded-lg border border-border hover:bg-accent hover:border-accent transition-colors"
            >
              <span className="font-medium text-sm">{book.abbreviation}</span>
              <span className="block text-xs text-muted-foreground truncate">
                {book.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* New Testament */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
          New Testament
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {newTestament.map((book) => (
            <button
              key={book.id}
              onClick={() => onSelect(book)}
              className="p-3 text-left rounded-lg border border-border hover:bg-accent hover:border-accent transition-colors"
            >
              <span className="font-medium text-sm">{book.abbreviation}</span>
              <span className="block text-xs text-muted-foreground truncate">
                {book.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
