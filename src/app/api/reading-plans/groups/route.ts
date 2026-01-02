import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/reading-plans/groups
// Returns all reading plans for groups the user is a member of
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's active group memberships
    const memberships = await prisma.groupMember.findMany({
      where: { userId: authResult.userId, status: "active" },
      select: { groupId: true },
    });

    const groupIds = memberships.map((m) => m.groupId);

    if (groupIds.length === 0) {
      return NextResponse.json({
        success: true,
        groupPlans: [],
      });
    }

    // Get all reading plans for these groups
    const groupPlans = await prisma.groupReadingPlan.findMany({
      where: {
        groupId: { in: groupIds },
        deletedAt: null,
      },
      include: {
        group: {
          select: {
            id: true,
            shortId: true,
            name: true,
          },
        },
        template: {
          select: {
            id: true,
            shortId: true,
            title: true,
            subtitle: true,
            coverImageUrl: true,
            totalDays: true,
            estimatedMinutesMin: true,
            estimatedMinutesMax: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
          },
        },
        _count: {
          select: { progress: true },
        },
      },
      orderBy: [{ status: "asc" }, { startDate: "desc" }],
    });

    return NextResponse.json({
      success: true,
      groupPlans: groupPlans.map((gp) => ({
        id: gp.id,
        shortId: gp.shortId,
        status: gp.status,
        startDate: gp.startDate.toISOString(),
        timezone: gp.timezone,
        notifyDaily: gp.notifyDaily,
        meetingDayOfWeek: gp.meetingDayOfWeek,
        group: {
          id: gp.group.id,
          shortId: gp.group.shortId,
          name: gp.group.name,
        },
        template: {
          id: gp.template.id,
          shortId: gp.template.shortId,
          title: gp.template.title,
          subtitle: gp.template.subtitle,
          coverImageUrl: gp.template.coverImageUrl,
          totalDays: gp.template.totalDays,
          estimatedMinutesMin: gp.template.estimatedMinutesMin,
          estimatedMinutesMax: gp.template.estimatedMinutesMax,
        },
        createdBy: {
          id: gp.createdBy.id,
          displayName: gp.createdBy.displayName,
          firstName: gp.createdBy.firstName,
        },
        progressCount: gp._count.progress,
        createdAt: gp.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching group plans:", error);
    return NextResponse.json(
      { error: "Failed to fetch group plans" },
      { status: 500 }
    );
  }
}
