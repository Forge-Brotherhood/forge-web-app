import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { bibleService, BibleServiceError } from "@/lib/bible";
import { getTodaysVerse } from "@/lib/votdList";
import { getCurrentProviderType, getDefaultTranslation } from "@/lib/bible/providers";
import { type VerseOfTheDay } from "@/core/models/bibleModels";
import { getKVClient, CacheKeys, isCacheFresh, CACHE_TTL_SECONDS } from "@/lib/kv";

// GET /api/bible/verse-of-the-day - Get verse of the day with caching
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
    const providerDefault = getDefaultTranslation(getCurrentProviderType());
    const translation = searchParams.get("translation") || providerDefault;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const kv = getKVClient();
    const cacheKey = CacheKeys.verseOfTheDay(translation, today);

    // Check cache first
    const cached = await kv.get<VerseOfTheDay>(cacheKey);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) {
      return NextResponse.json({
        verseOfTheDay: cached.data,
        cached: true,
      }, {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
        },
      });
    }

    // Get today's verse from the curated list
    const todaysEntry = getTodaysVerse();

    // Fetch from API.Bible
    const passage = await bibleService.getPassage(todaysEntry.reference, translation);

    const verseOfTheDay: VerseOfTheDay = {
      date: today,
      verse: passage,
      devotionalTheme: todaysEntry.theme,
    };

    // Cache for 30 days (same as other Bible content)
    await kv.set(cacheKey, verseOfTheDay, CACHE_TTL_SECONDS);

    return NextResponse.json({
      verseOfTheDay,
      cached: false,
    }, {
      headers: {
        "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
      },
    });
  } catch (error) {
    console.error("Error fetching verse of the day:", error);

    if (error instanceof BibleServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch verse of the day" },
      { status: 500 }
    );
  }
}
