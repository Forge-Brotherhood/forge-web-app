import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { bibleService, BibleServiceError } from "@/lib/bible";
import { DEFAULT_TRANSLATION } from "@/core/models/bibleModels";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/bible/chapter/[id] - Get chapter content
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id: chapterId } = await params;
    const { searchParams } = new URL(request.url);
    const translation = searchParams.get("translation") || DEFAULT_TRANSLATION;

    if (!chapterId) {
      return NextResponse.json(
        { error: "Chapter ID is required" },
        { status: 400 }
      );
    }

    const chapter = await bibleService.getChapterContent(chapterId, translation);

    return NextResponse.json({
      chapter,
      translation: translation.toUpperCase(),
    });
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
