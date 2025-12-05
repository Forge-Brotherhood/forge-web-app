import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { bibleService, BibleServiceError } from "@/lib/bible";
import { DEFAULT_TRANSLATION } from "@/core/models/bibleModels";

// GET /api/bible/search - Search Bible verses
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
    const query = searchParams.get("q");
    const translation = searchParams.get("translation") || DEFAULT_TRANSLATION;
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    if (!query) {
      return NextResponse.json(
        { error: "Search query 'q' is required" },
        { status: 400 }
      );
    }

    const result = await bibleService.searchVerses(query, translation, limit);

    return NextResponse.json({
      verses: result.verses,
      query,
      translation: translation.toUpperCase(),
      total: result.total,
    });
  } catch (error) {
    console.error("Error searching Bible verses:", error);

    if (error instanceof BibleServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to search Bible verses" },
      { status: 500 }
    );
  }
}
