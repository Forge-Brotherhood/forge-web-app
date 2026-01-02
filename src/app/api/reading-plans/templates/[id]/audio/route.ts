/**
 * POST /api/reading-plans/templates/[id]/audio
 * GET /api/reading-plans/templates/[id]/audio
 *
 * Batch generate audio for all days in a reading plan template (admin only).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  textToSpeech,
  assembleReadingPlanScript,
  ElevenLabsError,
} from "@/lib/elevenlabs";
import {
  uploadAudioToCloudinary,
  generateAudioPublicId,
} from "@/lib/cloudinaryAudio";

async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === "admin";
}

// Rate limiting: delay between API calls (ms)
const RATE_LIMIT_DELAY = 500;

interface GenerationResult {
  dayId: string;
  dayNumber: number;
  success: boolean;
  audioUrl?: string;
  error?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(authResult.userId);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: templateId } = await params;

    const body = await request.json().catch(() => ({}));
    const { overwrite = false } = body;

    const template = await prisma.readingPlanTemplate.findFirst({
      where: {
        OR: [{ id: templateId }, { shortId: templateId }],
        deletedAt: null,
      },
      include: {
        days: {
          orderBy: { dayNumber: "asc" },
        },
      },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const daysToProcess = template.days.filter((day) => {
      if (day.audioUrl && !overwrite) {
        return false;
      }
      const script = assembleReadingPlanScript({
        title: day.title,
        summary: day.summary,
        contextIntro: day.contextIntro,
        reflectionPrompt: day.reflectionPrompt,
        prayerPrompt: day.prayerPrompt,
      });
      return script && script.trim().length > 0;
    });

    if (daysToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No days require audio generation",
        results: [],
      });
    }

    console.log(
      `Generating audio for ${daysToProcess.length} days in template ${template.shortId}`
    );

    const results: GenerationResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const day of daysToProcess) {
      try {
        const script = assembleReadingPlanScript({
          title: day.title,
          summary: day.summary,
          contextIntro: day.contextIntro,
          reflectionPrompt: day.reflectionPrompt,
          prayerPrompt: day.prayerPrompt,
        });

        console.log(`Processing day ${day.dayNumber}: ${script.length} characters`);

        const audioBuffer = await textToSpeech(script);

        const publicId = generateAudioPublicId(template.id, day.dayNumber);
        const folder = `forge/reading-plan-audio/${template.shortId}`;
        const uploadResult = await uploadAudioToCloudinary(
          audioBuffer,
          publicId,
          folder
        );

        await prisma.readingPlanTemplateDay.update({
          where: { id: day.id },
          data: { audioUrl: uploadResult.url },
        });

        results.push({
          dayId: day.id,
          dayNumber: day.dayNumber,
          success: true,
          audioUrl: uploadResult.url,
        });
        successCount++;

        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
      } catch (error) {
        console.error(`Error generating audio for day ${day.dayNumber}:`, error);

        const errorMessage =
          error instanceof ElevenLabsError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unknown error";

        results.push({
          dayId: day.id,
          dayNumber: day.dayNumber,
          success: false,
          error: errorMessage,
        });
        errorCount++;

        if (error instanceof ElevenLabsError && error.statusCode === 429) {
          console.log("Rate limited - stopping batch processing");
          break;
        }
      }
    }

    return NextResponse.json({
      success: errorCount === 0,
      message: `Generated audio for ${successCount}/${daysToProcess.length} days`,
      summary: {
        total: daysToProcess.length,
        success: successCount,
        failed: errorCount,
        skipped: template.days.length - daysToProcess.length,
      },
      results,
    });
  } catch (error) {
    console.error("Error in batch audio generation:", error);
    return NextResponse.json(
      { error: "Failed to generate audio" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(authResult.userId);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: templateId } = await params;

    const template = await prisma.readingPlanTemplate.findFirst({
      where: {
        OR: [{ id: templateId }, { shortId: templateId }],
        deletedAt: null,
      },
      include: {
        days: {
          orderBy: { dayNumber: "asc" },
          select: {
            id: true,
            dayNumber: true,
            title: true,
            audioUrl: true,
          },
        },
      },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const daysWithAudio = template.days.filter((d) => d.audioUrl).length;

    return NextResponse.json({
      success: true,
      templateId: template.id,
      summary: {
        totalDays: template.days.length,
        daysWithAudio,
        daysWithoutAudio: template.days.length - daysWithAudio,
      },
      days: template.days.map((d) => ({
        id: d.id,
        dayNumber: d.dayNumber,
        title: d.title,
        hasAudio: !!d.audioUrl,
        audioUrl: d.audioUrl,
      })),
    });
  } catch (error) {
    console.error("Error fetching audio status:", error);
    return NextResponse.json(
      { error: "Failed to fetch audio status" },
      { status: 500 }
    );
  }
}
