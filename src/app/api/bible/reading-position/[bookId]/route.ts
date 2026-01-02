import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";
import { Prisma } from "@prisma/client";

const paramsSchema = z.object({
  bookId: z.string().min(1),
});

// GET /api/bible/reading-position/[bookId]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsedParams = paramsSchema.parse(await params);

    const row = await prisma.bibleReadingProgress.findUnique({
      where: { userId_bookId: { userId: authResult.userId, bookId: parsedParams.bookId } },
    });

    return NextResponse.json({
      position: row
        ? {
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
          }
        : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request parameters", details: error.issues },
        { status: 400 }
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      console.error("[ReadingPositionByBook] GET failed (missing table):", error);
      return NextResponse.json(
        {
          error:
            'Database schema is missing required tables. Run `npx prisma db push` (local/dev) or `npx prisma migrate deploy` (deploy).',
          details: error.meta ?? null,
        },
        { status: 503 }
      );
    }
    console.error("[ReadingPositionByBook] GET failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch reading position" },
      { status: 500 }
    );
  }
}


