import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Calculate current day number based on startDate and timezone
function calculateCurrentDayNumber(
  startDate: Date,
  timezone: string,
  totalDays: number
): { dayNumber: number; status: "not_started" | "in_progress" | "completed" } {
  const now = new Date();

  // Convert dates to the plan's timezone for accurate day calculation
  const startInTz = new Date(
    startDate.toLocaleString("en-US", { timeZone: timezone })
  );
  const nowInTz = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

  // Reset to start of day for accurate day difference
  startInTz.setHours(0, 0, 0, 0);
  nowInTz.setHours(0, 0, 0, 0);

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = Math.floor(
    (nowInTz.getTime() - startInTz.getTime()) / msPerDay
  );

  // Day number is 1-indexed
  const dayNumber = daysDiff + 1;

  if (dayNumber < 1) {
    return { dayNumber: 1, status: "not_started" };
  } else if (dayNumber > totalDays) {
    return { dayNumber: totalDays, status: "completed" };
  }

  return { dayNumber, status: "in_progress" };
}

// GET /api/reading-plans/[planId]/today
// Get today's reading content for the user's plan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { planId } = await params;

    // Get user's plan
    const userPlan = await prisma.userReadingPlan.findFirst({
      where: {
        OR: [{ id: planId }, { shortId: planId }],
        userId: authResult.userId,
        deletedAt: null,
      },
      include: {
        template: {
          select: {
            id: true,
            title: true,
            totalDays: true,
            coverImageUrl: true,
          },
        },
      },
    });

    if (!userPlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Calculate current day
    const { dayNumber, status: planStatus } = calculateCurrentDayNumber(
      userPlan.startDate,
      userPlan.timezone,
      userPlan.template.totalDays
    );

    // Auto-update plan status if needed
    if (planStatus === "in_progress" && userPlan.status === "scheduled") {
      await prisma.userReadingPlan.update({
        where: { id: userPlan.id },
        data: { status: "active" },
      });
    } else if (planStatus === "completed" && userPlan.status === "active") {
      await prisma.userReadingPlan.update({
        where: { id: userPlan.id },
        data: { status: "completed" },
      });
    }

    // Get today's template day content with unified day audio
    const templateDay = await prisma.readingPlanTemplateDay.findFirst({
      where: {
        templateId: userPlan.templateId,
        dayNumber,
      },
      include: {
        scriptureAudio: {
          select: {
            audioUrl: true,
            durationMs: true,
            markers: true,
            translation: true,
          },
        },
      },
    });

    if (!templateDay) {
      return NextResponse.json(
        { error: "Day content not found for this plan" },
        { status: 404 }
      );
    }

    // Get user's progress for today
    const userProgress = await prisma.readingPlanProgress.findUnique({
      where: {
        userPlanId_templateDayId_userId: {
          userPlanId: userPlan.id,
          templateDayId: templateDay.id,
          userId: authResult.userId,
        },
      },
    });

    // Get user's reflections for today
    const reflections = await prisma.readingPlanReflection.findMany({
      where: {
        userPlanId: userPlan.id,
        templateDayId: templateDay.id,
        userId: authResult.userId,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      today: {
        planId: userPlan.id,
        planShortId: userPlan.shortId,
        planStatus: planStatus === "not_started" ? "scheduled" : planStatus,
        planTitle: userPlan.template.title,
        coverImageUrl: userPlan.template.coverImageUrl,
        totalDays: userPlan.template.totalDays,
        currentDay: dayNumber,
        day: {
          id: templateDay.id,
          dayNumber: templateDay.dayNumber,
          scriptureBlocks: templateDay.scriptureBlocks,
          passageRef: templateDay.passageRef,
          // Legacy fields for iOS compatibility
          bookId: (() => {
            const blocks = Array.isArray(templateDay.scriptureBlocks)
              ? (templateDay.scriptureBlocks as Array<Record<string, unknown>>)
              : [];
            const first = blocks[0];
            return typeof first?.bookId === "string" ? first.bookId : null;
          })(),
          startChapter: (() => {
            const blocks = Array.isArray(templateDay.scriptureBlocks)
              ? (templateDay.scriptureBlocks as Array<Record<string, unknown>>)
              : [];
            const first = blocks[0];
            return typeof first?.chapter === "number" ? first.chapter : null;
          })(),
          startVerse: (() => {
            const blocks = Array.isArray(templateDay.scriptureBlocks)
              ? (templateDay.scriptureBlocks as Array<Record<string, unknown>>)
              : [];
            const first = blocks[0];
            const v = first?.startVerse;
            return typeof v === "number" ? v : null;
          })(),
          endChapter: (() => {
            const blocks = Array.isArray(templateDay.scriptureBlocks)
              ? (templateDay.scriptureBlocks as Array<Record<string, unknown>>)
              : [];
            const last = blocks.length ? blocks[blocks.length - 1] : undefined;
            return typeof last?.chapter === "number" ? last.chapter : null;
          })(),
          endVerse: (() => {
            const blocks = Array.isArray(templateDay.scriptureBlocks)
              ? (templateDay.scriptureBlocks as Array<Record<string, unknown>>)
              : [];
            const last = blocks.length ? blocks[blocks.length - 1] : undefined;
            const v = last?.endVerse ?? last?.startVerse;
            return typeof v === "number" ? v : null;
          })(),
          // Content fields
          title: templateDay.title,
          summary: templateDay.summary,
          reflectionPrompt: templateDay.reflectionPrompt,
          prayerPrompt: templateDay.prayerPrompt,
          contextIntro: templateDay.contextIntro,
          audio: templateDay.scriptureAudio
            ? {
                audioUrl: templateDay.scriptureAudio.audioUrl,
                durationMs: templateDay.scriptureAudio.durationMs,
                markers: templateDay.scriptureAudio.markers,
                translation: templateDay.scriptureAudio.translation,
              }
            : null,
        },
        progress: userProgress
          ? {
              hasRead: userProgress.hasRead,
              hasReflected: userProgress.hasReflected,
              hasPrayed: userProgress.hasPrayed,
              completedAt: userProgress.completedAt?.toISOString() ?? null,
            }
          : {
              hasRead: false,
              hasReflected: false,
              hasPrayed: false,
              completedAt: null,
            },
        reflections: reflections.map((r) => ({
          id: r.id,
          kind: r.kind,
          content: r.content,
          audioUrl: r.audioUrl,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching today's content:", error);
    return NextResponse.json(
      { error: "Failed to fetch today's content" },
      { status: 500 }
    );
  }
}
