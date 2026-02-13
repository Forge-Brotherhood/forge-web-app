import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/bible/reading-history?limit=10
// Returns user's most recent chapter visits, deduplicated by (bookId, chapter)
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = parseInt(searchParams.get("limit") || "10", 10);
    const limit = Math.min(Math.max(limitParam, 1), 50);

    const segments = await prisma.bibleReadingSessionSegment.findMany({
      where: { userId: authResult.userId },
      orderBy: { endedAt: "desc" },
      distinct: ["bookId"],
      take: limit,
      select: {
        bookId: true,
        bookName: true,
        chapter: true,
        chapterId: true,
        endedAt: true,
      },
    });

    return NextResponse.json({
      entries: segments.map((s) => ({
        bookId: s.bookId,
        bookName: s.bookName,
        chapter: s.chapter,
        chapterId: s.chapterId,
        lastReadAt: s.endedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching reading history:", error);
    return NextResponse.json(
      { error: "Failed to fetch reading history" },
      { status: 500 }
    );
  }
}
