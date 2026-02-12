/**
 * Bible Reading Sessions Fetcher
 *
 * Fetches recent Bible reading sessions from BibleChapterDailyRollup.
 */

import { prisma } from "@/lib/prisma";
import { getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";
import { computeDateBounds } from "@/lib/memory/intentClassifier";
import type { ChapterCompletionStatus } from "@/lib/bible/readingCompletion";
import type { ContextCandidate, FetcherOptions } from "./types";
import { calculateRecencyScore, createRedactedPreview } from "./helpers";

type ParsedReadRange = { verseStart: number; verseEnd: number } | null;

const parseFirstVerseRangeFromReadRange = (
  readRange: string
): ParsedReadRange => {
  const raw = readRange.trim();
  if (!raw) return null;

  // Expect chapter-local strings like:
  // - "2:1-10"
  // - "2:1"
  // - "1-10"
  // - "1"
  const afterColon = raw.includes(":") ? raw.split(":").slice(1).join(":") : raw;
  const m = afterColon.match(/^(\d{1,3})(?:-(\d{1,3}))?$/);
  if (!m) return null;

  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const start = Math.max(1, Math.min(a, b));
  const end = Math.max(1, Math.max(a, b));
  return { verseStart: start, verseEnd: end };
};

/**
 * Fetch Bible reading session candidates.
 */
export async function fetchBibleReadingSessions(
  options: FetcherOptions
): Promise<ContextCandidate[]> {
  const { userId, temporalRange = "last_week", limit = 10 } = options;

  let endedAfter: Date | undefined;
  let endedBefore: Date | undefined;
  if (temporalRange) {
    const bounds = computeDateBounds(temporalRange);
    endedAfter = bounds.after;
    endedBefore = bounds.before;
  }

  const rollups = await prisma.bibleChapterDailyRollup.findMany({
    where: {
      userId,
      ...(endedAfter || endedBefore
        ? {
            lastReadAt: {
              ...(endedAfter ? { gte: endedAfter } : {}),
              ...(endedBefore ? { lte: endedBefore } : {}),
            },
          }
        : {}),
    },
    orderBy: { lastReadAt: "desc" },
    take: limit,
  });

  return rollups.map((r) => {
    const bookName =
      r.bookName ?? getBookDisplayNameFromCode(r.bookId) ?? r.bookId;
    const firstReadRange = r.readRanges[0] ?? null;
    const ref = firstReadRange
      ? `${bookName} ${firstReadRange}`
      : `${bookName} ${r.chapter}`;
    const firstRange = firstReadRange
      ? parseFirstVerseRangeFromReadRange(firstReadRange)
      : null;

    const durationText = (() => {
      const seconds = r.durationSeconds;
      if (!Number.isFinite(seconds) || seconds < 0) return null;
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      if (mins <= 0) return `${secs}s`;
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    })();

    const label = `Reading — ${ref}`;
    const previewParts: string[] = [];
    if (r.translation) previewParts.push(r.translation);
    if (durationText) previewParts.push(durationText);
    const completion = r.completionStatus as ChapterCompletionStatus | null;
    const completionLabel = completion?.status ?? null;
    if (completionLabel) previewParts.push(completionLabel);
    const preview = previewParts.length > 0 ? previewParts.join(" · ") : ref;

    return {
      id: `bible_chapter_daily_rollup:${r.bookId}:${r.chapter}:${r.localDate}`,
      source: "bible_reading_session" as const,
      label,
      preview: createRedactedPreview(preview),
      metadata: {
        translation: r.translation,
        readRanges: r.readRanges,
        startRef: {
          bookId: r.bookId,
          book: bookName,
          chapter: r.chapter,
          verse: firstRange?.verseStart ?? null,
        },
        endRef: {
          bookId: r.bookId,
          book: bookName,
          chapter: r.chapter,
          verse: firstRange?.verseEnd ?? null,
        },
        durationSeconds: r.durationSeconds,
        completionStatus: r.completionStatus,
        localDate: r.localDate,
        timeZone: r.timeZone,
        endedAt: r.lastReadAt?.toISOString() ?? null,
      },
      features: {
        recencyScore: calculateRecencyScore(r.lastReadAt ?? r.updatedAt),
        createdAt: (r.lastReadAt ?? r.updatedAt).toISOString(),
      },
    };
  });
}
