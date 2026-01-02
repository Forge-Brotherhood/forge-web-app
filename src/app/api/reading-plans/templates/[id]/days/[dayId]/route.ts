/**
 * GET /api/reading-plans/templates/[id]/days/[dayId]
 *
 * Get a single day from a reading plan template.
 * Supports lookup by day ID (UUID) or day number (1, 2, 3...).
 * This is a public route for onboarding - no authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  try {
    const { id: templateId, dayId } = await params;

    // Determine if dayId is a number (day number) or UUID (day ID)
    const dayNumber = parseInt(dayId, 10);
    const isNumeric = !isNaN(dayNumber) && dayNumber > 0;

    const day = await prisma.readingPlanTemplateDay.findFirst({
      where: {
        ...(isNumeric ? { dayNumber } : { id: dayId }),
        template: {
          OR: [{ id: templateId }, { shortId: templateId }, { slug: templateId }],
          deletedAt: null,
        },
      },
      include: {
        template: {
          select: {
            id: true,
            shortId: true,
            slug: true,
            title: true,
            coverImageUrl: true,
          },
        },
        scriptureAudio: true,
      },
    });

    if (!day) {
      return NextResponse.json(
        { success: false, error: "Day not found" },
        { status: 404 }
      );
    }

    // Format audio if present
    let audio = null;
    if (day.scriptureAudio) {
      audio = {
        audioUrl: day.scriptureAudio.audioUrl,
        durationMs: day.scriptureAudio.durationMs,
        translation: day.scriptureAudio.translation,
        markers: day.scriptureAudio.markers,
      };
    }

    return NextResponse.json({
      success: true,
      day: {
        id: day.id,
        dayNumber: day.dayNumber,
        passageRef: day.passageRef,
        // Legacy fields (deprecated): derived from scriptureBlocks
        bookId: (() => {
          const blocks = Array.isArray(day.scriptureBlocks)
            ? (day.scriptureBlocks as Array<Record<string, unknown>>)
            : [];
          const first = blocks[0];
          return typeof first?.bookId === "string" ? first.bookId : null;
        })(),
        startChapter: (() => {
          const blocks = Array.isArray(day.scriptureBlocks)
            ? (day.scriptureBlocks as Array<Record<string, unknown>>)
            : [];
          const first = blocks[0];
          return typeof first?.chapter === "number" ? first.chapter : null;
        })(),
        startVerse: (() => {
          const blocks = Array.isArray(day.scriptureBlocks)
            ? (day.scriptureBlocks as Array<Record<string, unknown>>)
            : [];
          const first = blocks[0];
          const v = first?.startVerse;
          return typeof v === "number" ? v : null;
        })(),
        endChapter: (() => {
          const blocks = Array.isArray(day.scriptureBlocks)
            ? (day.scriptureBlocks as Array<Record<string, unknown>>)
            : [];
          const last = blocks.length ? blocks[blocks.length - 1] : undefined;
          return typeof last?.chapter === "number" ? last.chapter : null;
        })(),
        endVerse: (() => {
          const blocks = Array.isArray(day.scriptureBlocks)
            ? (day.scriptureBlocks as Array<Record<string, unknown>>)
            : [];
          const last = blocks.length ? blocks[blocks.length - 1] : undefined;
          const v = last?.endVerse ?? last?.startVerse;
          return typeof v === "number" ? v : null;
        })(),
        title: day.title,
        summary: day.summary,
        reflectionPrompt: day.reflectionPrompt,
        prayerPrompt: day.prayerPrompt,
        contextIntro: day.contextIntro,
        scriptureBlocks: day.scriptureBlocks,
        audioUrl: day.audioUrl,
        audio,
        template: {
          id: day.template.id,
          shortId: day.template.shortId,
          title: day.template.title,
          coverImageUrl: day.template.coverImageUrl,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching template day:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch day" },
      { status: 500 }
    );
  }
}
