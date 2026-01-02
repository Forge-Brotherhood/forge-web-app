import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

// GET /api/reading-plans/groups/[groupId]/stats
// Get group completion statistics for the active plan
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
      select: { id: true, name: true },
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
        status: { in: ["scheduled", "active", "completed"] },
        deletedAt: null,
      },
      include: {
        template: {
          select: { totalDays: true, title: true },
        },
      },
    });

    if (!groupPlan) {
      return NextResponse.json({
        success: true,
        stats: null,
        message: "No reading plan found for this group",
      });
    }

    // Get all group members
    const members = await prisma.groupMember.findMany({
      where: {
        groupId: group.id,
        status: "active",
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            profileImageUrl: true,
          },
        },
      },
    });

    // Get all progress entries for this plan
    const allProgress = await prisma.readingPlanProgress.findMany({
      where: {
        groupPlanId: groupPlan.id,
      },
      include: {
        templateDay: {
          select: { dayNumber: true },
        },
      },
    });

    // Get all template days
    const templateDays = await prisma.readingPlanTemplateDay.findMany({
      where: { templateId: groupPlan.templateId },
      orderBy: { dayNumber: "asc" },
      select: {
        id: true,
        dayNumber: true,
        passageRef: true,
        title: true,
      },
    });

    // Calculate per-member stats
    const memberStats = members.map((member) => {
      const memberProgress = allProgress.filter(
        (p) => p.userId === member.userId
      );
      const completedDays = memberProgress.filter(
        (p) => p.completedAt !== null
      ).length;
      const totalDays = groupPlan.template.totalDays;

      return {
        user: {
          id: member.user.id,
          displayName: member.user.displayName,
          firstName: member.user.firstName,
          profileImageUrl: member.user.profileImageUrl,
        },
        completedDays,
        totalDays,
        completionPercent: Math.round((completedDays / totalDays) * 100),
        hasRead: memberProgress.filter((p) => p.hasRead).length,
        hasReflected: memberProgress.filter((p) => p.hasReflected).length,
        hasPrayed: memberProgress.filter((p) => p.hasPrayed).length,
      };
    });

    // Calculate per-day stats (how many people completed each day)
    const dayStats = templateDays.map((day) => {
      const dayProgress = allProgress.filter(
        (p) => p.templateDay.dayNumber === day.dayNumber
      );
      const completedCount = dayProgress.filter(
        (p) => p.completedAt !== null
      ).length;

      return {
        dayNumber: day.dayNumber,
        passageRef: day.passageRef,
        title: day.title,
        completedCount,
        totalMembers: members.length,
        completionPercent:
          members.length > 0
            ? Math.round((completedCount / members.length) * 100)
            : 0,
      };
    });

    // Overall group stats
    const totalPossibleCompletions =
      members.length * groupPlan.template.totalDays;
    const actualCompletions = allProgress.filter(
      (p) => p.completedAt !== null
    ).length;

    return NextResponse.json({
      success: true,
      stats: {
        planId: groupPlan.id,
        planTitle: groupPlan.template.title,
        status: groupPlan.status,
        startDate: groupPlan.startDate.toISOString(),
        totalDays: groupPlan.template.totalDays,
        totalMembers: members.length,
        overall: {
          totalPossibleCompletions,
          actualCompletions,
          groupCompletionPercent:
            totalPossibleCompletions > 0
              ? Math.round((actualCompletions / totalPossibleCompletions) * 100)
              : 0,
        },
        memberStats: memberStats.sort(
          (a, b) => b.completionPercent - a.completionPercent
        ),
        dayStats,
      },
    });
  } catch (error) {
    console.error("Error fetching group stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch group stats" },
      { status: 500 }
    );
  }
}
