import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { bibleService, BibleServiceError } from "@/lib/bible";
import { getCurrentProviderType, getDefaultTranslation } from "@/lib/bible/providers";
import { CACHE_TTL_SECONDS } from "@/lib/kv";

// GET /api/bible/passage - Get passage by reference
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
    const reference = searchParams.get("reference");
    const providerDefault = getDefaultTranslation(getCurrentProviderType());
    const translation = searchParams.get("translation") || providerDefault;

    if (!reference) {
      return NextResponse.json(
        { error: "reference is required (e.g., 'John 3:16' or 'John 3:16-17')" },
        { status: 400 }
      );
    }

    const passage = await bibleService.getPassage(reference, translation);

    return NextResponse.json(
      {
        passage,
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
        },
      }
    );
  } catch (error) {
    console.error("Error fetching Bible passage:", error);

    if (error instanceof BibleServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch Bible passage" },
      { status: 500 }
    );
  }
}
