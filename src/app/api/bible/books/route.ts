import { NextRequest, NextResponse } from "next/server";
import { bibleService, BibleServiceError } from "@/lib/bible";
import { DEFAULT_TRANSLATION } from "@/core/models/bibleModels";
import { CACHE_TTL_SECONDS } from "@/lib/kv";

// GET /api/bible/books - Get list of Bible books
// Public endpoint - Bible content is identical for all users
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const translation = searchParams.get("translation") || DEFAULT_TRANSLATION;

    const books = await bibleService.getBooks(translation);

    return NextResponse.json(
      {
        books,
        translation: translation.toUpperCase(),
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
        },
      }
    );
  } catch (error) {
    console.error("Error fetching Bible books:", error);

    if (error instanceof BibleServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch Bible books" },
      { status: 500 }
    );
  }
}
