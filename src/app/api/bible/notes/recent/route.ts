import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/bible/notes/recent?limit=10
// Returns user's most recent notes globally (not chapter-scoped)
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = parseInt(searchParams.get("limit") || "10", 10);
    const limit = Math.min(Math.max(limitParam, 1), 50);

    const notes = await prisma.verseNote.findMany({
      where: { userId: authResult.userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            profileImageUrl: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      notes: notes.map((n) => ({
        id: n.id,
        verseId: n.verseId,
        bookId: n.bookId,
        chapter: n.chapter,
        verseStart: n.verseStart,
        verseEnd: n.verseEnd,
        content: n.content,
        isPrivate: n.isPrivate,
        author: {
          id: n.user.id,
          displayName: n.user.displayName,
          firstName: n.user.firstName,
          profileImageUrl: n.user.profileImageUrl,
        },
        isOwn: true,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching recent notes:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent notes" },
      { status: 500 }
    );
  }
}
