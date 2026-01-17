import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { bibleService } from "@/lib/bible";
import { computeChapterCompletionStatus } from "@/lib/bible/readingCompletion";

function getLocalDateYYYYMMDD(args: { date: Date; timeZone: string }): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: args.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(args.date);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) throw new Error("Failed to compute localDate parts");
  return `${y}-${m}-${d}`;
}

type VerseInterval = { start: number; end: number };

function parseReadRangeToken(args: {
  token: string;
  chapter: number;
}): VerseInterval | null {
  const raw = args.token.trim();
  if (!raw) return null;

  // Accept chapter-local tokens like:
  // - "1:1-17" / "1:17" (with chapter)
  // - "1-17" / "17" (without chapter; assume args.chapter)
  const [maybeChapterRaw, afterColonRaw] = raw.includes(":")
    ? (() => {
        const parts = raw.split(":");
        return [parts[0] ?? "", parts.slice(1).join(":")];
      })()
    : [null, raw];

  if (maybeChapterRaw != null) {
    const tokenChapter = Number.parseInt(maybeChapterRaw, 10);
    if (!Number.isFinite(tokenChapter) || tokenChapter <= 0) return null;
    if (tokenChapter !== args.chapter) return null;
  }

  const m = afterColonRaw.match(/^(\d{1,3})(?:-(\d{1,3}))?$/);
  if (!m) return null;
  const a = Number.parseInt(m[1]!, 10);
  const b = m[2] ? Number.parseInt(m[2], 10) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;

  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return { start, end };
}

function normalizeAndMergeReadRanges(args: {
  chapter: number;
  readRanges: string[];
}): string[] {
  // Split entries that may contain comma-separated lists like "1:1-4, 1:16-20"
  const tokens = args.readRanges
    .flatMap((r) => r.split(","))
    .map((t) => t.trim())
    .filter(Boolean);

  const intervals: VerseInterval[] = [];
  for (const token of tokens) {
    const iv = parseReadRangeToken({ token, chapter: args.chapter });
    if (iv) intervals.push(iv);
  }
  if (intervals.length === 0) return [];

  intervals.sort((a, b) => (a.start - b.start) || (a.end - b.end));

  const merged: VerseInterval[] = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...iv });
      continue;
    }
    // Merge overlaps and adjacency (e.g. 1:1-17 + 1:17-25 => 1:1-25)
    if (iv.start <= last.end + 1) {
      last.end = Math.max(last.end, iv.end);
      continue;
    }
    merged.push({ ...iv });
  }

  return merged.map((iv) => {
    if (iv.start === iv.end) return `${args.chapter}:${iv.start}`;
    return `${args.chapter}:${iv.start}-${iv.end}`;
  });
}

const segmentSchema = z
  .object({
    segmentId: z.string().min(1),
    bookId: z.string().min(1),
    bookName: z.string().min(1).optional(),
    chapterId: z.string().min(1).optional(),
    chapter: z.number().int().positive(),
    // Optional: clients may omit this and rely on the top-level translation.
    translation: z.string().min(1).optional(),

    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    durationSeconds: z.number().int().nonnegative(),

    readRanges: z.array(z.string().min(1)).optional(),
  })
  .strict();

const uploadSchema = z
  .object({
    sessionId: z.string().min(1),
    startedAt: z.string().datetime().optional(),
    contextType: z.string().min(1).default("standalone"),
    contextSourceId: z.string().nullable().optional(),
    entryPoint: z.string().nullable().optional(),
    translation: z.string().min(1),
    timeZone: z.string().min(1),
    isFinal: z.boolean().optional(),
    segments: z.array(segmentSchema).min(1),
  })
  .strict();

// POST /api/bible/reading-session/segments
export async function POST(request: NextRequest) {
  let body: unknown = undefined;
  try {
    const authResult = await getAuth();
    if (!authResult)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const contentLengthHeader = request.headers.get("content-length");
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : undefined;
    if (contentLength === 0) {
      return NextResponse.json(
        { error: "Empty request body. Expected JSON." },
        { status: 400 }
      );
    }

    try {
      body = await request.json();
    } catch (err) {
      // This commonly happens when the client sends an empty body or truncates the payload.
      console.error("[ReadingSessionSegments] Invalid JSON body:", {
        error: err,
        contentType: request.headers.get("content-type"),
        contentLength: request.headers.get("content-length"),
      });
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }
    const input = uploadSchema.parse(body);
    // Validate timezone up front (throws RangeError if invalid).
    try {
      void new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone });
    } catch {
      return NextResponse.json(
        { error: `Invalid timeZone: ${input.timeZone}` },
        { status: 400 }
      );
    }

    // Ensure a parent session row exists (idempotent).
    const first = input.segments[0];
    const batchStartedAt = input.startedAt ? new Date(input.startedAt) : new Date(first.startedAt);
    const batchEndedAt = new Date(
      Math.max(...input.segments.map((s) => new Date(s.endedAt).getTime()))
    );
    const durationIncrement = input.segments.reduce((sum, s) => sum + s.durationSeconds, 0);

    await prisma.bibleReadingSession.upsert({
      where: { userId_sessionId: { userId: authResult.userId, sessionId: input.sessionId } },
      create: {
        userId: authResult.userId,
        sessionId: input.sessionId,
        startedAt: batchStartedAt,
        endedAt: batchEndedAt,
        durationSeconds: durationIncrement,
        source: "ios",
        contextType: input.contextType,
        contextSourceId: input.contextSourceId ?? null,
        entryPoint: input.entryPoint ?? null,
      },
      update: {
        endedAt: batchEndedAt,
        durationSeconds: { increment: durationIncrement },
        contextType: input.contextType,
        contextSourceId: input.contextSourceId ?? undefined,
        entryPoint: input.entryPoint ?? undefined,
      },
    });

    // Insert segments with dedupe (segmentId unique per user).
    // If a segment is already present, we ignore it.
    // Prisma createMany + skipDuplicates requires unique constraint, which we have.
    await prisma.bibleReadingSessionSegment.createMany({
      data: input.segments.map((s) => ({
        userId: authResult.userId,
        sessionId: input.sessionId,
        segmentId: s.segmentId,
        bookId: s.bookId,
        bookName: s.bookName ?? null,
        chapterId: s.chapterId ?? null,
        chapter: s.chapter,
        translation: s.translation ?? input.translation,
        startedAt: new Date(s.startedAt),
        endedAt: new Date(s.endedAt),
        durationSeconds: s.durationSeconds,
        readRanges: s.readRanges ?? [],
        source: "ios",
      })),
      skipDuplicates: true,
    });

    // Merge/roll up by (userId, sessionId, bookId, chapter)
    // Daily rollup grouping key: bookId:chapter:localDate (localDate derived from segment.endedAt in user tz)
    const grouped = new Map<string, typeof input.segments>();
    for (const s of input.segments) {
      const localDate = getLocalDateYYYYMMDD({
        date: new Date(s.endedAt),
        timeZone: input.timeZone,
      });
      const key = `${s.bookId}:${s.chapter}:${localDate}`;
      const arr = grouped.get(key) ?? [];
      arr.push(s);
      grouped.set(key, arr);
    }

    await prisma.$transaction(async (tx) => {
      for (const [key, segs] of grouped.entries()) {
        const [bookId, chapterRaw, localDate] = key.split(":");
        const chapter = parseInt(chapterRaw, 10);

        const firstSeg = segs[0]!;
        // For the daily rollup, store the translation of the most recent segment in this bucket.
        const mostRecent = segs
          .slice()
          .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())[0]!;
        const translation = (mostRecent.translation ?? input.translation) as string;

        const durationIncrement = segs.reduce((sum, s) => sum + s.durationSeconds, 0);
        const incomingReadRangesRaw = segs.flatMap((s) => s.readRanges ?? []);

        const existing = await tx.bibleChapterDailyRollup.findUnique({
          where: {
            userId_bookId_chapter_localDate: {
              userId: authResult.userId,
              bookId,
              chapter,
              localDate,
            },
          },
        });

        const mergedDurationSeconds = (existing?.durationSeconds ?? 0) + durationIncrement;
        const mergedReadRanges = normalizeAndMergeReadRanges({
          chapter,
          readRanges: [...(existing?.readRanges ?? []), ...incomingReadRangesRaw],
        });

        const mergedFirstReadAt = (() => {
          const existingFirst = existing?.firstReadAt ?? null;
          const incomingFirst = segs.reduce((min, s) => {
            const t = new Date(s.startedAt);
            return min == null || t.getTime() < min.getTime() ? t : min;
          }, null as Date | null);
          if (!existingFirst) return incomingFirst;
          if (!incomingFirst) return existingFirst;
          return incomingFirst.getTime() < existingFirst.getTime() ? incomingFirst : existingFirst;
        })();

        const mergedLastReadAt = (() => {
          const existingLast = existing?.lastReadAt ?? null;
          const incomingLast = segs.reduce((max, s) => {
            const t = new Date(s.endedAt);
            return max == null || t.getTime() > max.getTime() ? t : max;
          }, null as Date | null);
          if (!existingLast) return incomingLast;
          if (!incomingLast) return existingLast;
          return incomingLast.getTime() > existingLast.getTime() ? incomingLast : existingLast;
        })();

        const totalVersesCount = await (async () => {
          try {
            const chapterId = `${bookId}.${chapter}`;
            const content = await bibleService.getChapterContent(chapterId, translation);
            const maxVerse = content.elements.reduce((max, el) => {
              if (el.type !== "verse") return max;
              return Math.max(max, el.number);
            }, 0);
            return maxVerse > 0 ? maxVerse : null;
          } catch {
            return null;
          }
        })();

        const completionStatus = computeChapterCompletionStatus({
          readRanges: mergedReadRanges,
          durationSeconds: mergedDurationSeconds,
          totalVersesCount,
        });

        if (!existing) {
          await tx.bibleChapterDailyRollup.create({
            data: {
              userId: authResult.userId,
              bookId,
              bookName: firstSeg.bookName ?? null,
              chapterId: firstSeg.chapterId ?? null,
              chapter,
              translation,
              durationSeconds: mergedDurationSeconds,
              completionStatus,
              readRanges: mergedReadRanges,
              localDate,
              timeZone: input.timeZone,
              firstReadAt: mergedFirstReadAt,
              lastReadAt: mergedLastReadAt,
            },
          });
          continue;
        }

        await tx.bibleChapterDailyRollup.update({
          where: {
            userId_bookId_chapter_localDate: {
              userId: authResult.userId,
              bookId,
              chapter,
              localDate,
            },
          },
          data: {
            bookName: firstSeg.bookName ?? undefined,
            chapterId: firstSeg.chapterId ?? undefined,
            translation,
            durationSeconds: mergedDurationSeconds,
            completionStatus,
            readRanges: mergedReadRanges,
            timeZone: input.timeZone,
            firstReadAt: mergedFirstReadAt ?? undefined,
            lastReadAt: mergedLastReadAt ?? undefined,
          },
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const paths = error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
        expected: "expected" in i ? (i as any).expected : undefined,
        received: "received" in i ? (i as any).received : undefined,
      }));
      console.error("[ReadingSessionSegments] Zod validation failed:", {
        paths,
        bodyKeys:
          body && typeof body === "object" && !Array.isArray(body)
            ? Object.keys(body as Record<string, unknown>)
            : typeof body,
        segmentsLength:
          body &&
          typeof body === "object" &&
          body !== null &&
          "segments" in (body as any) &&
          Array.isArray((body as any).segments)
            ? (body as any).segments.length
            : undefined,
        firstSegmentKeys:
          body &&
          typeof body === "object" &&
          body !== null &&
          "segments" in (body as any) &&
          Array.isArray((body as any).segments) &&
          (body as any).segments[0] &&
          typeof (body as any).segments[0] === "object" &&
          !Array.isArray((body as any).segments[0])
            ? Object.keys((body as any).segments[0])
            : undefined,
      });
      return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      console.error("[ReadingSessionSegments] POST failed (missing table):", error);
      return NextResponse.json(
        {
          error:
            'Database schema is missing required tables. Run `npx prisma db push` (local/dev) or `npx prisma migrate deploy` (deploy).',
          details: error.meta ?? null,
        },
        { status: 503 }
      );
    }
    console.error("[ReadingSessionSegments] POST failed:", error);
    return NextResponse.json({ error: "Failed to upload reading session segments" }, { status: 500 });
  }
}


