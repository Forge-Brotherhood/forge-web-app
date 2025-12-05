"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useBiblePassage } from "../hooks";
import { Search, Loader2, X } from "lucide-react";
import type { SupportedTranslation } from "@/core/models/bibleModels";
import { DEFAULT_TRANSLATION } from "@/core/models/bibleModels";

interface VerseLookupProps {
  translation?: SupportedTranslation;
  onClose?: () => void;
  className?: string;
}

export function VerseLookup({
  translation = DEFAULT_TRANSLATION,
  onClose,
  className,
}: VerseLookupProps) {
  const [reference, setReference] = useState("");
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  const { data, isLoading, error } = useBiblePassage(submittedRef, translation);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reference.trim()) {
      setSubmittedRef(reference.trim());
    }
  };

  const handleClear = () => {
    setReference("");
    setSubmittedRef(null);
  };

  return (
    <div className={className}>
      {/* Search Form */}
      <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Input
            type="text"
            placeholder="Enter reference (e.g., John 3:16)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="pr-8"
          />
          {reference && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button type="submit" disabled={!reference.trim() || isLoading}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </Button>
        {onClose && (
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
      </form>

      {/* Results */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">
              Could not find that reference. Try a format like &quot;John 3:16&quot; or
              &quot;Genesis 1:1-3&quot;
            </p>
          </CardContent>
        </Card>
      )}

      {data?.passage && (
        <Card>
          <CardContent className="pt-4">
            <h3 className="font-semibold mb-2">
              {data.passage.reference} ({data.passage.translationAbbreviation})
            </h3>
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: data.passage.content }}
            />
            <p className="text-xs text-muted-foreground mt-4">
              {data.passage.copyright}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
