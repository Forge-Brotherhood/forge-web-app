/**
 * Gather User Context for Reading Plan Generation
 *
 * Fetches comprehensive user context from various sources to enable
 * deeply personalized AI-generated reading plans.
 */

import { prisma } from "@/lib/prisma";
import { getActiveLifeContext, type LifeContextItemResponse } from "@/lib/lifeContext";
import type { UserContextForGeneration } from "./planGenerationTypes";

// Type guards for life context values
interface SeasonValue {
  season: string;
  note?: string;
}

interface WeeklyIntentionValue {
  carrying: string;
  hoping?: string;
}

interface PrayerTopicValue {
  topic: string;
}

interface GoalValue {
  goal: string;
}

interface GlobalMemoryNote {
  text: string;
  keywords?: string[];
  createdAtISO?: string;
}

/**
 * Gather comprehensive user context for AI reading plan generation.
 *
 * Queries multiple data sources:
 * - User profile and preferences
 * - Life context (season, carrying, hoping, goals, prayer topics)
 * - AI memories (global notes, recent session notes)
 * - Bible highlights
 * - Verse notes
 * - Reading history (aggregated by book)
 * - Previous plan reflections
 */
export async function gatherUserContextForGeneration(
  userId: string
): Promise<UserContextForGeneration> {
  const now = new Date();

  // Fetch all data sources in parallel for efficiency
  const [
    user,
    preferences,
    lifeContextItems,
    memoryState,
    sessionNotes,
    highlights,
    notes,
    readingHistory,
    reflections,
  ] = await Promise.all([
    // User profile
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        displayName: true,
        firstName: true,
      },
    }),

    // User preferences
    prisma.userPreferences.findUnique({
      where: { userId },
      select: {
        displayName: true,
        translationId: true,
        explanationStyle: true,
        experienceLevel: true,
      },
    }),

    // Life context (active items)
    getActiveLifeContext(userId),

    // Memory state (durable global notes)
    prisma.userMemoryState.findUnique({
      where: { userId },
      select: {
        globalNotes: true,
      },
    }),

    // Recent chat session memory notes (last 30 days)
    prisma.chatSessionMemoryNote.findMany({
      where: {
        userId,
        createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        text: true,
        keywords: true,
        createdAt: true,
      },
    }),

    // Recent Bible highlights (last 60 days, up to 30)
    prisma.bibleHighlight.findMany({
      where: {
        userId,
        createdAt: { gte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        bookId: true,
        chapter: true,
        verseStart: true,
        createdAt: true,
      },
    }),

    // Recent verse notes (last 60 days, up to 15)
    prisma.verseNote.findMany({
      where: {
        userId,
        createdAt: { gte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        bookId: true,
        chapter: true,
        content: true,
      },
    }),

    // Reading history aggregated by book (using daily rollups)
    prisma.bibleChapterDailyRollup.groupBy({
      by: ["bookId"],
      where: { userId },
      _sum: { durationSeconds: true },
      orderBy: { _sum: { durationSeconds: "desc" } },
      take: 20,
    }),

    // Previous plan reflections (last 90 days, up to 15)
    prisma.readingPlanReflection.findMany({
      where: {
        userPlan: { userId },
        createdAt: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
        content: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        content: true,
        createdAt: true,
      },
    }),
  ]);

  // Build the context object
  const context: UserContextForGeneration = {
    // Profile
    name: preferences?.displayName || user?.displayName || user?.firstName || undefined,
    experienceLevel: preferences?.experienceLevel || "growing",
    explanationStyle: preferences?.explanationStyle || "balanced",
    preferredTranslation: preferences?.translationId || "BSB",

    // Life context (extracted from items)
    ...extractLifeContext(lifeContextItems),

    // Memories
    memoryNotes: extractMemoryNotes(memoryState?.globalNotes, sessionNotes),

    // Bible engagement
    recentHighlights: highlights.map((h) => ({
      bookId: h.bookId,
      chapter: h.chapter,
      verse: h.verseStart,
      createdAt: h.createdAt,
    })),
    recentNotes: notes.map((n) => ({
      bookId: n.bookId,
      chapter: n.chapter,
      content: n.content,
    })),
    frequentBooks: readingHistory
      .filter((r) => r._sum.durationSeconds !== null && r._sum.durationSeconds > 60)
      .map((r) => ({
        bookId: r.bookId,
        totalMinutes: Math.round((r._sum.durationSeconds || 0) / 60),
      })),

    // Reflections
    recentReflections: reflections
      .filter((r) => r.content !== null)
      .map((r) => ({
        content: r.content!,
        createdAt: r.createdAt,
      })),
  };

  return context;
}

/**
 * Extract life context fields from life context items.
 */
function extractLifeContext(items: LifeContextItemResponse[]): {
  currentSeason?: string;
  seasonNote?: string;
  weeklyCarrying?: string;
  weeklyHoping?: string;
  prayerTopics: string[];
  goals: string[];
} {
  let currentSeason: string | undefined;
  let seasonNote: string | undefined;
  let weeklyCarrying: string | undefined;
  let weeklyHoping: string | undefined;
  const prayerTopics: string[] = [];
  const goals: string[] = [];

  for (const item of items) {
    switch (item.type) {
      case "season": {
        const value = item.value as SeasonValue;
        currentSeason = value.season;
        seasonNote = value.note;
        break;
      }
      case "weekly_intention": {
        const value = item.value as WeeklyIntentionValue;
        weeklyCarrying = value.carrying;
        weeklyHoping = value.hoping;
        break;
      }
      case "prayer_topic": {
        const value = item.value as PrayerTopicValue;
        if (value.topic) {
          prayerTopics.push(value.topic);
        }
        break;
      }
      case "goal": {
        const value = item.value as GoalValue;
        if (value.goal) {
          goals.push(value.goal);
        }
        break;
      }
    }
  }

  return {
    currentSeason,
    seasonNote,
    weeklyCarrying,
    weeklyHoping,
    prayerTopics,
    goals,
  };
}

/**
 * Extract memory notes from global notes and recent session notes.
 */
function extractMemoryNotes(
  globalNotes: unknown,
  sessionNotes: Array<{ text: string; keywords: string[]; createdAt: Date }>
): string[] {
  const notes: string[] = [];

  // Extract from global notes (durable memory)
  if (Array.isArray(globalNotes)) {
    for (const note of globalNotes.slice(0, 10)) {
      if (isGlobalMemoryNote(note) && note.text) {
        notes.push(note.text);
      }
    }
  }

  // Add recent session notes
  for (const note of sessionNotes.slice(0, 10)) {
    if (note.text && !notes.includes(note.text)) {
      notes.push(note.text);
    }
  }

  // Limit total notes
  return notes.slice(0, 15);
}

/**
 * Type guard for global memory note structure.
 */
function isGlobalMemoryNote(value: unknown): value is GlobalMemoryNote {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof (value as GlobalMemoryNote).text === "string"
  );
}
