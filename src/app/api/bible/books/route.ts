import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { bibleService, BibleServiceError } from "@/lib/bible";
import { DEFAULT_TRANSLATION } from "@/core/models/bibleModels";

// GET /api/bible/books - Get list of Bible books
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const translation = searchParams.get("translation") || DEFAULT_TRANSLATION;

    const books = await bibleService.getBooks(translation);

    return NextResponse.json({
      books,
      translation: translation.toUpperCase(),
    });
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
