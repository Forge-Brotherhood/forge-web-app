"use client";

/**
 * Bible TanStack Query Hooks
 * Hooks for fetching Bible data with caching and state management
 */

import { useQuery } from "@tanstack/react-query";
import { forgeApi } from "@/core/api/forgeApiClient";
import type {
  BibleBooksResponse,
  BibleChaptersResponse,
  BibleChapterContentResponse,
  BiblePassageResponse,
  VerseOfTheDayResponse,
} from "@/core/models/bibleModels";

// MARK: - Query Keys

export const bibleKeys = {
  all: ["bible"] as const,
  books: (translation: string) => [...bibleKeys.all, "books", translation] as const,
  chapters: (bookId: string, translation: string) =>
    [...bibleKeys.all, "chapters", bookId, translation] as const,
  chapter: (chapterId: string, translation: string) =>
    [...bibleKeys.all, "chapter", chapterId, translation] as const,
  passage: (reference: string, translation: string) =>
    [...bibleKeys.all, "passage", reference, translation] as const,
  verseOfTheDay: (translation: string) =>
    [...bibleKeys.all, "votd", translation] as const,
};

// MARK: - Hooks

/**
 * Fetch list of Bible books for a translation
 */
export function useBibleBooks(translation: string = "ESV") {
  return useQuery<BibleBooksResponse>({
    queryKey: bibleKeys.books(translation),
    queryFn: () => forgeApi.getBibleBooks(translation),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours - books don't change
    gcTime: 7 * 24 * 60 * 60 * 1000, // 7 days cache
  });
}

/**
 * Fetch chapters for a specific book
 */
export function useBibleChapters(
  bookId: string | null,
  translation: string = "ESV"
) {
  return useQuery<BibleChaptersResponse>({
    queryKey: bibleKeys.chapters(bookId || "", translation),
    queryFn: () => forgeApi.getBibleChapters(bookId!, translation),
    enabled: !!bookId,
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
    gcTime: 7 * 24 * 60 * 60 * 1000, // 7 days cache
  });
}

/**
 * Fetch chapter content
 */
export function useBibleChapter(
  chapterId: string | null,
  translation: string = "ESV"
) {
  return useQuery<BibleChapterContentResponse>({
    queryKey: bibleKeys.chapter(chapterId || "", translation),
    queryFn: () => forgeApi.getBibleChapter(chapterId!, translation),
    enabled: !!chapterId,
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 24 * 60 * 60 * 1000, // 24 hours cache
  });
}

/**
 * Fetch a passage by reference
 */
export function useBiblePassage(
  reference: string | null,
  translation: string = "ESV"
) {
  return useQuery<BiblePassageResponse>({
    queryKey: bibleKeys.passage(reference || "", translation),
    queryFn: () => forgeApi.getBiblePassage(reference!, translation),
    enabled: !!reference,
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 24 * 60 * 60 * 1000, // 24 hours cache
  });
}

/**
 * Fetch verse of the day
 */
export function useVerseOfTheDay(translation: string = "ESV") {
  return useQuery<VerseOfTheDayResponse>({
    queryKey: bibleKeys.verseOfTheDay(translation),
    queryFn: () => forgeApi.getVerseOfTheDay(translation),
    staleTime: 60 * 60 * 1000, // 1 hour (server handles daily caching)
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
  });
}
