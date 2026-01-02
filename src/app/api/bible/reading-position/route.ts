import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

const uiStateSchema = z
  .object({
    chunkIndex: z.number().int().nonnegative().optional(),
    // iOS/scroll views can report negative offsets during bounce/overscroll
    scrollOffset: z.number().finite().optional(),
    viewportVerseId: z.string().min(1).optional(),
  })
  .strict();

const sessionMetricsSchema = z
  .object({
    durationSeconds: z.number().int().nonnegative(),
    versesVisibleCount: z.number().int().nonnegative().optional(),
    completionStatus: z
      .enum(["not_started", "in_progress", "mostly_read", "completed"])
      .optional(),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    verseStart: z.number().int().positive().optional(),
    verseEnd: z.number().int().positive().optional(),
  })
  .strict();

const updateReadingPositionSchema = z
  .object({
    bookId: z.string().min(1),
    bookName: z.string().min(1).optional(),
    chapterId: z.string().min(1).optional(),
    chapter: z.number().int().positive(),
    verse: z.number().int().positive(),
    translation: z.string().min(1),
    contextType: z.string().min(1).default("standalone"),
    contextSourceId: z.string().nullable().optional(),
    uiState: uiStateSchema.optional(),
    // Client-generated UUID, required when sending sessionMetrics (for idempotency)
    sessionId: z.string().min(1).optional(),
    sessionMetrics: sessionMetricsSchema.optional(),
  })
  .strict();

function shouldCreateReadingSessionArtifact(metrics: {
  durationSeconds: number;
  versesVisibleCount?: number;
  completionStatus?: string;
}): boolean {
  const versesVisibleCount = metrics.versesVisibleCount ?? 0;
  const completionStatus = metrics.completionStatus ?? "in_progress";

  if (metrics.durationSeconds >= 120) return true;
  if (versesVisibleCount >= 10) return true;
  if (completionStatus === "mostly_read" || completionStatus === "completed")
    return true;
  return false;
}

// GET /api/bible/reading-position?limit=10
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get("limit");
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10), 1), 25) : 10;

    const progressRows = await prisma.bibleReadingProgress.findMany({
      where: { userId: authResult.userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const recentPositions = progressRows.map((row) => ({
      bookId: row.bookId,
      bookName: row.bookName,
      chapterId: row.chapterId,
      chapter: row.chapter,
      verse: row.verse,
      translation: row.translation,
      contextType: row.contextType,
      contextSourceId: row.contextSourceId,
      uiState: (row.uiState as Record<string, unknown> | null) ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      position: recentPositions[0] ?? null,
      recentPositions,
    });
  } catch (error) {
    console.error("[ReadingPosition] GET failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch reading position" },
      { status: 500 }
    );
  }
}

// PUT /api/bible/reading-position
export async function PUT(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const input = updateReadingPositionSchema.parse(body);
    const normalizedUiState =
      input.uiState && typeof input.uiState.scrollOffset === "number"
        ? {
            ...input.uiState,
            scrollOffset: Math.max(0, input.uiState.scrollOffset),
          }
        : input.uiState;

    // Upsert per-book progress
    const progress = await prisma.bibleReadingProgress.upsert({
      where: { userId_bookId: { userId: authResult.userId, bookId: input.bookId } },
      create: {
        userId: authResult.userId,
        bookId: input.bookId,
        bookName: input.bookName ?? null,
        chapterId: input.chapterId ?? null,
        chapter: input.chapter,
        verse: input.verse,
        translation: input.translation,
        contextType: input.contextType,
        contextSourceId: input.contextSourceId ?? null,
        uiState: normalizedUiState ?? undefined,
      },
      update: {
        bookName: input.bookName ?? undefined,
        chapterId: input.chapterId ?? undefined,
        chapter: input.chapter,
        verse: input.verse,
        translation: input.translation,
        contextType: input.contextType,
        contextSourceId: input.contextSourceId ?? undefined,
        uiState: normalizedUiState ?? undefined,
      },
    });

    // If this is a session end payload, persist session + maybe create artifact
    if (input.sessionMetrics) {
      if (!input.sessionId) {
        return NextResponse.json(
          { error: "sessionId is required when sessionMetrics is provided" },
          { status: 400 }
        );
      }

      const metrics = input.sessionMetrics;
      const versesVisibleCount = metrics.versesVisibleCount ?? 0;
      const completionStatus = metrics.completionStatus ?? "in_progress";

      const startedAt = metrics.startedAt ? new Date(metrics.startedAt) : new Date();
      const endedAt = metrics.endedAt ? new Date(metrics.endedAt) : new Date();
      const verseStart = metrics.verseStart ?? 1;
      const verseEnd = metrics.verseEnd ?? input.verse;

      const session = await prisma.bibleReadingSession.upsert({
        where: { userId_sessionId: { userId: authResult.userId, sessionId: input.sessionId } },
        create: {
          userId: authResult.userId,
          sessionId: input.sessionId,
          bookId: input.bookId,
          bookName: input.bookName ?? null,
          chapterId: input.chapterId ?? null,
          chapter: input.chapter,
          verseStart,
          verseEnd,
          translation: input.translation,
          startedAt,
          endedAt,
          durationSeconds: metrics.durationSeconds,
          versesVisibleCount,
          completionStatus,
          source: "ios",
        },
        update: {
          bookName: input.bookName ?? undefined,
          chapterId: input.chapterId ?? undefined,
          chapter: input.chapter,
          verseStart,
          verseEnd,
          translation: input.translation,
          startedAt,
          endedAt,
          durationSeconds: metrics.durationSeconds,
          versesVisibleCount,
          completionStatus,
        },
      });

      const isMeaningful = shouldCreateReadingSessionArtifact({
        durationSeconds: metrics.durationSeconds,
        versesVisibleCount,
        completionStatus,
      });

      // NOTE: Bible reading sessions are first-class (BibleReadingSession model).
      // We no longer create a parallel Artifact record for them.
      // Keep the "meaningful" check for future use (analytics/notifications), but do nothing here.
      void isMeaningful;
    }

    return NextResponse.json({
      success: true,
      position: {
        bookId: progress.bookId,
        bookName: progress.bookName,
        chapterId: progress.chapterId,
        chapter: progress.chapter,
        verse: progress.verse,
        translation: progress.translation,
        contextType: progress.contextType,
        contextSourceId: progress.contextSourceId,
        uiState: (progress.uiState as Record<string, unknown> | null) ?? null,
        updatedAt: progress.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("[ReadingPosition] PUT failed:", error);
    return NextResponse.json(
      { error: "Failed to update reading position" },
      { status: 500 }
    );
  }
}


