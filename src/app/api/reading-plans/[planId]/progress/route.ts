import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Validation schema for updating progress
const updateProgressSchema = z.object({
  templateDayId: z.string().min(1),
  hasRead: z.boolean().optional(),
  hasReflected: z.boolean().optional(),
  hasPrayed: z.boolean().optional(),
});

// Helper to get user's plan with ownership check
async function getUserPlan(userId: string, planId: string) {
  const plan = await prisma.userReadingPlan.findFirst({
    where: {
      OR: [{ id: planId }, { shortId: planId }],
      userId,
      deletedAt: null,
    },
    include: {
      template: {
        select: { totalDays: true },
      },
    },
  });
  return plan;
}

// GET /api/reading-plans/[planId]/progress
// Get user's progress for the plan
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

    const userPlan = await getUserPlan(authResult.userId, planId);

    if (!userPlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Get user's progress for all days
    const progress = await prisma.readingPlanProgress.findMany({
      where: {
        userPlanId: userPlan.id,
        userId: authResult.userId,
      },
      include: {
        templateDay: {
          select: {
            dayNumber: true,
            passageRef: true,
            title: true,
          },
        },
      },
      orderBy: {
        templateDay: { dayNumber: "asc" },
      },
    });

    // Calculate summary stats
    const completedDays = progress.filter((p) => p.completedAt !== null).length;
    const totalDays = userPlan.template.totalDays;

    return NextResponse.json({
      success: true,
      progress: progress.map((p) => ({
        id: p.id,
        dayNumber: p.templateDay.dayNumber,
        passageRef: p.templateDay.passageRef,
        title: p.templateDay.title,
        hasRead: p.hasRead,
        hasReflected: p.hasReflected,
        hasPrayed: p.hasPrayed,
        completedAt: p.completedAt?.toISOString() ?? null,
      })),
      summary: {
        completedDays,
        totalDays,
        completionPercent: Math.round((completedDays / totalDays) * 100),
      },
    });
  } catch (error) {
    console.error("Error fetching progress:", error);
    return NextResponse.json(
      { error: "Failed to fetch progress" },
      { status: 500 }
    );
  }
}

// PATCH /api/reading-plans/[planId]/progress
// Update user's progress for a specific day
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

    const userPlan = await prisma.userReadingPlan.findFirst({
      where: {
        OR: [{ id: planId }, { shortId: planId }],
        userId: authResult.userId,
        deletedAt: null,
      },
    });

    if (!userPlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const validatedData = updateProgressSchema.parse(body);

    // Verify the template day belongs to this plan's template
    const templateDay = await prisma.readingPlanTemplateDay.findFirst({
      where: {
        id: validatedData.templateDayId,
        templateId: userPlan.templateId,
      },
    });

    if (!templateDay) {
      return NextResponse.json(
        { error: "Invalid day for this plan" },
        { status: 400 }
      );
    }

    // Prepare update data
    const updateData: {
      hasRead?: boolean;
      hasReflected?: boolean;
      hasPrayed?: boolean;
      completedAt?: Date | null;
    } = {};

    if (validatedData.hasRead !== undefined) {
      updateData.hasRead = validatedData.hasRead;
    }
    if (validatedData.hasReflected !== undefined) {
      updateData.hasReflected = validatedData.hasReflected;
    }
    if (validatedData.hasPrayed !== undefined) {
      updateData.hasPrayed = validatedData.hasPrayed;
    }

    // Upsert the progress record
    const progress = await prisma.readingPlanProgress.upsert({
      where: {
        userPlanId_templateDayId_userId: {
          userPlanId: userPlan.id,
          templateDayId: validatedData.templateDayId,
          userId: authResult.userId,
        },
      },
      create: {
        userPlanId: userPlan.id,
        templateDayId: validatedData.templateDayId,
        userId: authResult.userId,
        hasRead: validatedData.hasRead ?? false,
        hasReflected: validatedData.hasReflected ?? false,
        hasPrayed: validatedData.hasPrayed ?? false,
      },
      update: updateData,
      include: {
        templateDay: {
          select: {
            dayNumber: true,
            passageRef: true,
            title: true,
          },
        },
      },
    });

    // Check if all steps completed
    const isComplete =
      progress.hasRead && progress.hasReflected && progress.hasPrayed;
    if (isComplete && !progress.completedAt) {
      await prisma.readingPlanProgress.update({
        where: { id: progress.id },
        data: { completedAt: new Date() },
      });
      progress.completedAt = new Date();
    } else if (!isComplete && progress.completedAt) {
      await prisma.readingPlanProgress.update({
        where: { id: progress.id },
        data: { completedAt: null },
      });
      progress.completedAt = null;
    }

    return NextResponse.json({
      success: true,
      progress: {
        id: progress.id,
        dayNumber: progress.templateDay.dayNumber,
        passageRef: progress.templateDay.passageRef,
        title: progress.templateDay.title,
        hasRead: progress.hasRead,
        hasReflected: progress.hasReflected,
        hasPrayed: progress.hasPrayed,
        completedAt: progress.completedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating progress:", error);
    return NextResponse.json(
      { error: "Failed to update progress" },
      { status: 500 }
    );
  }
}
