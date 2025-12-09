import { NextRequest, NextResponse } from "next/server";
import { bibleService, BibleServiceError } from "@/lib/bible";
import { DEFAULT_TRANSLATION } from "@/core/models/bibleModels";
import { CACHE_TTL_SECONDS } from "@/lib/kv";

// GET /api/bible/chapters - Get chapters for a book
// Public endpoint - Bible content is identical for all users
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get("bookId");
    const translation = searchParams.get("translation") || DEFAULT_TRANSLATION;

    if (!bookId) {
      return NextResponse.json(
        { error: "bookId is required" },
        { status: 400 }
      );
    }

    const chapters = await bibleService.getChapters(bookId, translation);

    return NextResponse.json(
      {
        chapters,
        bookId,
        translation: translation.toUpperCase(),
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
        },
      }
    );
  } catch (error) {
    console.error("Error fetching Bible chapters:", error);

    if (error instanceof BibleServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch Bible chapters" },
      { status: 500 }
    );
  }
}
