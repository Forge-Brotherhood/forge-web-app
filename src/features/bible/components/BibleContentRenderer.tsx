"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BibleContentElement, BibleFootnote, BibleInline } from "@/core/models/bibleModels";

type BibleContentRendererProps = {
  elements: BibleContentElement[];
  footnotes: BibleFootnote[];
  className?: string;
};

const getFootnoteMarker = (footnote: BibleFootnote | undefined, noteId: number) => {
  const caller = footnote?.caller ?? null;
  if (caller && caller !== "+") return caller;
  return String(noteId);
};

const renderInline = (
  inline: BibleInline,
  onFootnoteClick: (noteId: number) => void,
  footnoteById: Map<number, BibleFootnote>
) => {
  switch (inline.type) {
    case "text":
      return <span>{inline.text}</span>;
    case "formatted_text": {
      const className = inline.wordsOfJesus
        ? "text-red-600 dark:text-red-400"
        : undefined;

      const style =
        inline.poem && inline.poem > 0
          ? ({ paddingLeft: inline.poem * 12 } as const)
          : undefined;

      return (
        <span className={className} style={style}>
          {inline.text}
        </span>
      );
    }
    case "inline_heading":
      return <span className="font-semibold">{inline.heading}</span>;
    case "inline_line_break":
      return <br />;
    case "footnote_ref": {
      const footnote = footnoteById.get(inline.noteId);
      const marker = getFootnoteMarker(footnote, inline.noteId);
      return (
        <button
          type="button"
          className="align-super text-[10px] font-semibold text-primary hover:underline"
          onClick={() => onFootnoteClick(inline.noteId)}
          aria-label={`Open footnote ${marker}`}
        >
          {marker}
        </button>
      );
    }
  }
};

export const getPlainTextFromElements = (elements: BibleContentElement[]) => {
  const parts: string[] = [];

  for (const el of elements) {
    if (el.type === "line_break") {
      parts.push("\n");
      continue;
    }

    if (el.type === "heading" || el.type === "hebrew_subtitle") {
      const text = el.inline
        .filter((x) => x.type === "text" || x.type === "formatted_text")
        .map((x) => (x.type === "text" ? x.text : x.text))
        .join(" ");
      if (text.trim()) parts.push(text.trim());
      continue;
    }

    // verse
    const verseText = el.inline
      .filter((x) => x.type === "text" || x.type === "formatted_text")
      .map((x) => (x.type === "text" ? x.text : x.text))
      .join(" ");
    if (verseText.trim()) parts.push(verseText.trim());
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
};

export const BibleContentRenderer = ({ elements, footnotes, className }: BibleContentRendererProps) => {
  const [openFootnoteId, setOpenFootnoteId] = useState<number | null>(null);

  const footnoteById = useMemo(() => {
    return new Map<number, BibleFootnote>(footnotes.map((f) => [f.noteId, f]));
  }, [footnotes]);

  const openFootnote = openFootnoteId === null ? undefined : footnoteById.get(openFootnoteId);

  return (
    <>
      <div className={className}>
        {elements.map((el, idx) => {
          if (el.type === "line_break") {
            return <div key={`lb-${idx}`} className="h-3" />;
          }

          if (el.type === "heading") {
            return (
              <h3 key={`h-${idx}`} className="mt-6 mb-2 text-base font-semibold">
                {el.inline.map((inl, j) => (
                  <span key={`h-${idx}-${j}`}>
                    {renderInline(inl, setOpenFootnoteId, footnoteById)}{" "}
                  </span>
                ))}
              </h3>
            );
          }

          if (el.type === "hebrew_subtitle") {
            return (
              <p key={`hs-${idx}`} className="mt-4 mb-2 italic text-sm text-muted-foreground">
                {el.inline.map((inl, j) => (
                  <span key={`hs-${idx}-${j}`}>
                    {renderInline(inl, setOpenFootnoteId, footnoteById)}{" "}
                  </span>
                ))}
              </p>
            );
          }

          // verse
          return (
            <p key={`v-${el.number}`} className="leading-relaxed text-sm">
              <span className="select-none align-super text-[10px] text-muted-foreground mr-1">
                {el.number}
              </span>
              {el.inline.map((inl, j) => (
                <span key={`v-${el.number}-${j}`}>
                  {renderInline(inl, setOpenFootnoteId, footnoteById)}{" "}
                </span>
              ))}
            </p>
          );
        })}
      </div>

      <Dialog
        open={openFootnoteId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenFootnoteId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Footnote</DialogTitle>
            <DialogDescription>
              {openFootnote ? `#${getFootnoteMarker(openFootnote, openFootnote.noteId)}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm leading-relaxed">
            {openFootnote?.text ?? "Footnote not found."}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};


