import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { bibleService, BibleServiceError } from "@/lib/bible";
import { getTodaysVerse } from "@/lib/votdList";
import { DEFAULT_TRANSLATION, type VerseOfTheDay } from "@/core/models/bibleModels";
import { Prisma } from "@prisma/client";

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
    const translation = searchParams.get("translation") || DEFAULT_TRANSLATION;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Check cache first
    const cached = await prisma.cachedVerseOfTheDay.findUnique({
      where: {
        date_translation: {
          date: today,
          translation: translation.toUpperCase(),
        },
      },
    });

    if (cached && new Date(cached.expiresAt) > new Date()) {
      return NextResponse.json({
        verseOfTheDay: cached.data as unknown as VerseOfTheDay,
        cached: true,
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

    // Cache for 24 hours
    const expiresAt = new Date();
    expiresAt.setHours(23, 59, 59, 999); // End of current day

    await prisma.cachedVerseOfTheDay.upsert({
      where: {
        date_translation: {
          date: today,
          translation: translation.toUpperCase(),
        },
      },
      update: {
        data: verseOfTheDay as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
      create: {
        date: today,
        translation: translation.toUpperCase(),
        data: verseOfTheDay as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
    });

    return NextResponse.json({
      verseOfTheDay,
      cached: false,
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
