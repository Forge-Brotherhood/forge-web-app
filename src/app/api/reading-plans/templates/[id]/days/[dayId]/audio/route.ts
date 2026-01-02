/**
 * POST /api/reading-plans/templates/[id]/days/[dayId]/audio
 * DELETE /api/reading-plans/templates/[id]/days/[dayId]/audio
 *
 * Generate or remove audio for a single reading plan day (admin only).
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
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

    const { id: templateId, dayId } = await params;

    const day = await prisma.readingPlanTemplateDay.findFirst({
      where: {
        id: dayId,
        template: {
          OR: [{ id: templateId }, { shortId: templateId }],
          deletedAt: null,
        },
      },
      include: {
        template: {
          select: { id: true, shortId: true, title: true },
        },
      },
    });

    if (!day) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    const script = assembleReadingPlanScript({
      title: day.title,
      summary: day.summary,
      contextIntro: day.contextIntro,
      reflectionPrompt: day.reflectionPrompt,
      prayerPrompt: day.prayerPrompt,
    });

    if (!script || script.trim().length === 0) {
      return NextResponse.json(
        { error: "No text content available for audio generation" },
        { status: 400 }
      );
    }

    console.log(
      `Generating audio for template ${day.template.shortId}, day ${day.dayNumber}`
    );
    console.log(`Script length: ${script.length} characters`);

    const audioBuffer = await textToSpeech(script);

    const publicId = generateAudioPublicId(day.template.id, day.dayNumber);
    const folder = `forge/reading-plan-audio/${day.template.shortId}`;

    const uploadResult = await uploadAudioToCloudinary(
      audioBuffer,
      publicId,
      folder
    );

    await prisma.readingPlanTemplateDay.update({
      where: { id: day.id },
      data: { audioUrl: uploadResult.url },
    });

    console.log(`Audio generated successfully: ${uploadResult.url}`);

    return NextResponse.json({
      success: true,
      day: {
        id: day.id,
        dayNumber: day.dayNumber,
        audioUrl: uploadResult.url,
        audioDuration: uploadResult.duration,
        audioBytes: uploadResult.bytes,
      },
    });
  } catch (error) {
    console.error("Error generating audio:", error);

    if (error instanceof ElevenLabsError) {
      return NextResponse.json(
        {
          error: "TTS generation failed",
          details: error.message,
          statusCode: error.statusCode,
        },
        { status: error.statusCode === 429 ? 429 : 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate audio" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
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

    const { id: templateId, dayId } = await params;

    const day = await prisma.readingPlanTemplateDay.updateMany({
      where: {
        id: dayId,
        template: {
          OR: [{ id: templateId }, { shortId: templateId }],
          deletedAt: null,
        },
      },
      data: { audioUrl: null },
    });

    if (day.count === 0) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting audio:", error);
    return NextResponse.json(
      { error: "Failed to delete audio" },
      { status: 500 }
    );
  }
}
