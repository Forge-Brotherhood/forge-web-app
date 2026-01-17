import { getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";

export const getBookIdFromRefKey = (refKey: string): string | null => {
  const book = refKey.split(":")[0]?.trim();
  return book ? book : null;
};

export const formatRefKeyForDisplay = (refKey: string): string => {
  const [bookId, chapterStr] = refKey.split(":");
  const chapter = Number.parseInt(chapterStr ?? "", 10);
  if (!bookId || !Number.isFinite(chapter)) return refKey;

  const displayName = getBookDisplayNameFromCode(bookId) ?? bookId;
  return `${displayName} ${chapter}`;
};

export const formatAnchorForDisplay = (refKey: string, verseStart: number): string => {
  const base = formatRefKeyForDisplay(refKey);
  const v = Math.max(1, Math.floor(verseStart));
  return `${base}:${v}`;
};


