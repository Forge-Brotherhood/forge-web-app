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
  prayedForUserId: z.string().nullable().optional(),
});

// Helper to check if user is a group member
async function isGroupMember(
  userId: string,
  groupId: string
): Promise<boolean> {
  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: { groupId, userId },
    },
    select: { status: true },
  });
  return membership?.status === "active";
}

// GET /api/reading-plans/groups/[groupId]/progress
// Get user's progress for the active plan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = await params;

    // Resolve the group
    const group = await prisma.group.findFirst({
      where: {
        OR: [{ id: groupId }, { shortId: groupId }],
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Check membership
    const isMember = await isGroupMember(authResult.userId, group.id);
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get active plan
    const groupPlan = await prisma.groupReadingPlan.findFirst({
      where: {
        groupId: group.id,
        status: { in: ["scheduled", "active"] },
        deletedAt: null,
      },
      include: {
        template: {
          select: { totalDays: true },
        },
      },
    });

    if (!groupPlan) {
      return NextResponse.json({
        success: true,
        progress: [],
        summary: null,
      });
    }

    // Get user's progress for all days
    const progress = await prisma.readingPlanProgress.findMany({
      where: {
        groupPlanId: groupPlan.id,
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
        prayedForUser: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
          },
        },
      },
      orderBy: {
        templateDay: { dayNumber: "asc" },
      },
    });

    // Calculate summary stats
    const completedDays = progress.filter((p) => p.completedAt !== null).length;
    const totalDays = groupPlan.template.totalDays;

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
        prayedForUser: p.prayedForUser
          ? {
              id: p.prayedForUser.id,
              displayName: p.prayedForUser.displayName,
              firstName: p.prayedForUser.firstName,
            }
          : null,
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

// PATCH /api/reading-plans/groups/[groupId]/progress
// Update user's progress for a specific day
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = await params;

    // Resolve the group
    const group = await prisma.group.findFirst({
      where: {
        OR: [{ id: groupId }, { shortId: groupId }],
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Check membership
    const isMember = await isGroupMember(authResult.userId, group.id);
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validatedData = updateProgressSchema.parse(body);

    // Get active plan
    const groupPlan = await prisma.groupReadingPlan.findFirst({
      where: {
        groupId: group.id,
        status: { in: ["scheduled", "active"] },
        deletedAt: null,
      },
    });

    if (!groupPlan) {
      return NextResponse.json(
        { error: "No active plan found for this group" },
        { status: 404 }
      );
    }

    // Verify the template day belongs to this plan's template
    const templateDay = await prisma.readingPlanTemplateDay.findFirst({
      where: {
        id: validatedData.templateDayId,
        templateId: groupPlan.templateId,
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
      prayedForUserId?: string | null;
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
    if (validatedData.prayedForUserId !== undefined) {
      updateData.prayedForUserId = validatedData.prayedForUserId;
    }

    // Upsert the progress record
    const progress = await prisma.readingPlanProgress.upsert({
      where: {
        groupPlanId_templateDayId_userId: {
          groupPlanId: groupPlan.id,
          templateDayId: validatedData.templateDayId,
          userId: authResult.userId,
        },
      },
      create: {
        groupPlanId: groupPlan.id,
        templateDayId: validatedData.templateDayId,
        userId: authResult.userId,
        hasRead: validatedData.hasRead ?? false,
        hasReflected: validatedData.hasReflected ?? false,
        hasPrayed: validatedData.hasPrayed ?? false,
        prayedForUserId: validatedData.prayedForUserId ?? null,
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
        prayedForUser: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
          },
        },
      },
    });

    // Check if all steps completed
    const isComplete = progress.hasRead && progress.hasReflected && progress.hasPrayed;
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
        prayedForUser: progress.prayedForUser
          ? {
              id: progress.prayedForUser.id,
              displayName: progress.prayedForUser.displayName,
              firstName: progress.prayedForUser.firstName,
            }
          : null,
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
