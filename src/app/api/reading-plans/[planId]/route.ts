import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Validation schema for updating a user plan
const updateUserPlanSchema = z.object({
  status: z
    .enum(["scheduled", "active", "paused", "completed", "canceled"])
    .optional(),
  notifyDaily: z.boolean().optional(),
});

// Helper to get user's plan with ownership check
async function getUserPlan(userId: string, planId: string) {
  const plan = await prisma.userReadingPlan.findFirst({
    where: {
      OR: [{ id: planId }, { shortId: planId }],
      userId,
      deletedAt: null,
    },
  });
  return plan;
}

// GET /api/reading-plans/[planId]
// Get details of a specific reading plan
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

    const userPlan = await prisma.userReadingPlan.findFirst({
      where: {
        OR: [{ id: planId }, { shortId: planId }],
        userId: authResult.userId,
        deletedAt: null,
      },
      include: {
        template: {
          include: {
            days: {
              orderBy: { dayNumber: "asc" },
            },
          },
        },
        _count: {
          select: { progress: true, reflections: true },
        },
      },
    });

    if (!userPlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      plan: {
        id: userPlan.id,
        shortId: userPlan.shortId,
        status: userPlan.status,
        startDate: userPlan.startDate.toISOString(),
        timezone: userPlan.timezone,
        notifyDaily: userPlan.notifyDaily,
        template: {
          id: userPlan.template.id,
          shortId: userPlan.template.shortId,
          title: userPlan.template.title,
          subtitle: userPlan.template.subtitle,
          description: userPlan.template.description,
          coverImageUrl: userPlan.template.coverImageUrl,
          totalDays: userPlan.template.totalDays,
          estimatedMinutesMin: userPlan.template.estimatedMinutesMin,
          estimatedMinutesMax: userPlan.template.estimatedMinutesMax,
          days: userPlan.template.days.map((d) => ({
            id: d.id,
            dayNumber: d.dayNumber,
            passageRef: d.passageRef,
            bookId: (() => {
              const blocks = Array.isArray(d.scriptureBlocks)
                ? (d.scriptureBlocks as Array<Record<string, unknown>>)
                : [];
              const first = blocks[0];
              return typeof first?.bookId === "string" ? first.bookId : null;
            })(),
            startChapter: (() => {
              const blocks = Array.isArray(d.scriptureBlocks)
                ? (d.scriptureBlocks as Array<Record<string, unknown>>)
                : [];
              const first = blocks[0];
              return typeof first?.chapter === "number" ? first.chapter : null;
            })(),
            startVerse: (() => {
              const blocks = Array.isArray(d.scriptureBlocks)
                ? (d.scriptureBlocks as Array<Record<string, unknown>>)
                : [];
              const first = blocks[0];
              const v = first?.startVerse;
              return typeof v === "number" ? v : null;
            })(),
            endChapter: (() => {
              const blocks = Array.isArray(d.scriptureBlocks)
                ? (d.scriptureBlocks as Array<Record<string, unknown>>)
                : [];
              const last = blocks.length ? blocks[blocks.length - 1] : undefined;
              return typeof last?.chapter === "number" ? last.chapter : null;
            })(),
            endVerse: (() => {
              const blocks = Array.isArray(d.scriptureBlocks)
                ? (d.scriptureBlocks as Array<Record<string, unknown>>)
                : [];
              const last = blocks.length ? blocks[blocks.length - 1] : undefined;
              const v = last?.endVerse ?? last?.startVerse;
              return typeof v === "number" ? v : null;
            })(),
            title: d.title,
            summary: d.summary,
            reflectionPrompt: d.reflectionPrompt,
            prayerPrompt: d.prayerPrompt,
            contextIntro: d.contextIntro,
          })),
        },
        progressCount: userPlan._count.progress,
        reflectionsCount: userPlan._count.reflections,
        createdAt: userPlan.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching user plan:", error);
    return NextResponse.json(
      { error: "Failed to fetch reading plan" },
      { status: 500 }
    );
  }
}

// PATCH /api/reading-plans/[planId]
// Update the user's reading plan status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { planId } = await params;
    const existingPlan = await getUserPlan(authResult.userId, planId);

    if (!existingPlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const validatedData = updateUserPlanSchema.parse(body);

    const userPlan = await prisma.userReadingPlan.update({
      where: { id: existingPlan.id },
      data: validatedData,
    });

    return NextResponse.json({
      success: true,
      plan: {
        id: userPlan.id,
        shortId: userPlan.shortId,
        status: userPlan.status,
        startDate: userPlan.startDate.toISOString(),
        timezone: userPlan.timezone,
        notifyDaily: userPlan.notifyDaily,
        updatedAt: userPlan.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating user plan:", error);
    return NextResponse.json(
      { error: "Failed to update reading plan" },
      { status: 500 }
    );
  }
}

// DELETE /api/reading-plans/[planId]
// Soft delete the user's reading plan
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { planId } = await params;
    const existingPlan = await getUserPlan(authResult.userId, planId);

    if (!existingPlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Soft delete
    await prisma.userReadingPlan.update({
      where: { id: existingPlan.id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting user plan:", error);
    return NextResponse.json(
      { error: "Failed to delete reading plan" },
      { status: 500 }
    );
  }
}
