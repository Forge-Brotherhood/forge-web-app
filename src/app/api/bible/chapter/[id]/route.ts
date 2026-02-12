import { NextRequest, NextResponse } from "next/server";
import { bibleService, BibleServiceError } from "@/lib/bible";
import { getCurrentProviderType, getDefaultTranslation } from "@/lib/bible/providers";
import { CACHE_TTL_SECONDS } from "@/lib/kv";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/bible/chapter/[id] - Get chapter content
// Public endpoint - Bible content is identical for all users
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {

    const { id: chapterId } = await params;
    const { searchParams } = new URL(request.url);
    const providerDefault = getDefaultTranslation(getCurrentProviderType());
    const translation = (searchParams.get("translation") || providerDefault).toUpperCase();

    if (!chapterId) {
      return NextResponse.json(
        { error: "Chapter ID is required" },
        { status: 400 }
      );
    }

    const chapter = await bibleService.getChapterContent(chapterId, translation);

    return NextResponse.json(
      {
        chapter,
        translation,
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
        },
      }
    );
  } catch (error) {
    console.error("Error fetching Bible chapter content:", error);

    if (error instanceof BibleServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch Bible chapter" },
      { status: 500 }
    );
  }
}
