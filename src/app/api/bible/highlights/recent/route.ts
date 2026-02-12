import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/bible/highlights/recent?limit=10
// Returns user's most recent highlights globally (not chapter-scoped)
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limitParam = parseInt(searchParams.get("limit") || "10", 10);
    const limit = Math.min(Math.max(limitParam, 1), 50);

    const highlights = await prisma.bibleHighlight.findMany({
      where: { userId: authResult.userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      highlights: highlights.map((h) => ({
        id: h.id,
        bookId: h.bookId,
        chapter: h.chapter,
        verseStart: h.verseStart,
        verseEnd: h.verseEnd,
        color: h.color,
        artifactId: h.artifactId ?? null,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching recent highlights:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent highlights" },
      { status: 500 }
    );
  }
}
