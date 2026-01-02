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

// GET /api/reading-plans/groups/[groupId]/today
// Get today's reading content for the group's active plan
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
      select: { id: true, shortId: true, name: true },
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
          select: {
            id: true,
            title: true,
            totalDays: true,
            coverImageUrl: true,
          },
        },
      },
    });

    if (!groupPlan) {
      return NextResponse.json({
        success: true,
        today: null,
        message: "No active reading plan for this group",
      });
    }

    // Calculate current day
    const { dayNumber, status: planStatus } = calculateCurrentDayNumber(
      groupPlan.startDate,
      groupPlan.timezone,
      groupPlan.template.totalDays
    );

    // Auto-update plan status if needed
    if (planStatus === "in_progress" && groupPlan.status === "scheduled") {
      await prisma.groupReadingPlan.update({
        where: { id: groupPlan.id },
        data: { status: "active" },
      });
    } else if (planStatus === "completed" && groupPlan.status === "active") {
      await prisma.groupReadingPlan.update({
        where: { id: groupPlan.id },
        data: { status: "completed" },
      });
    }

    // Get today's template day content with unified day audio
    const templateDay = await prisma.readingPlanTemplateDay.findFirst({
      where: {
        templateId: groupPlan.templateId,
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
        groupPlanId_templateDayId_userId: {
          groupPlanId: groupPlan.id,
          templateDayId: templateDay.id,
          userId: authResult.userId,
        },
      },
      include: {
        prayedForUser: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            profileImageUrl: true,
          },
        },
      },
    });

    // Get group members for "pray for" suggestions (excluding current user)
    const groupMembers = await prisma.groupMember.findMany({
      where: {
        groupId: group.id,
        status: "active",
        userId: { not: authResult.userId },
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

    // Get reflections for today from group members
    const reflections = await prisma.readingPlanReflection.findMany({
      where: {
        groupPlanId: groupPlan.id,
        templateDayId: templateDay.id,
        visibility: "group",
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
        targetUser: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      success: true,
      today: {
        planId: groupPlan.id,
        planStatus: planStatus === "not_started" ? "scheduled" : planStatus,
        planTitle: groupPlan.template.title,
        coverImageUrl: groupPlan.template.coverImageUrl,
        totalDays: groupPlan.template.totalDays,
        currentDay: dayNumber,
        day: {
          id: templateDay.id,
          dayNumber: templateDay.dayNumber,
          scriptureBlocks: templateDay.scriptureBlocks,
          passageRef: templateDay.passageRef,
          // Legacy fields (deprecated)
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
              prayedForUser: userProgress.prayedForUser
                ? {
                    id: userProgress.prayedForUser.id,
                    displayName: userProgress.prayedForUser.displayName,
                    firstName: userProgress.prayedForUser.firstName,
                    profileImageUrl: userProgress.prayedForUser.profileImageUrl,
                  }
                : null,
            }
          : {
              hasRead: false,
              hasReflected: false,
              hasPrayed: false,
              completedAt: null,
              prayedForUser: null,
            },
        groupMembers: groupMembers.map((m) => ({
          id: m.user.id,
          displayName: m.user.displayName,
          firstName: m.user.firstName,
          profileImageUrl: m.user.profileImageUrl,
        })),
        reflections: reflections.map((r) => ({
          id: r.id,
          kind: r.kind,
          content: r.content,
          audioUrl: r.audioUrl,
          author: {
            id: r.user.id,
            displayName: r.user.displayName,
            firstName: r.user.firstName,
            profileImageUrl: r.user.profileImageUrl,
          },
          targetUser: r.targetUser
            ? {
                id: r.targetUser.id,
                displayName: r.targetUser.displayName,
                firstName: r.targetUser.firstName,
              }
            : null,
          isOwn: r.userId === authResult.userId,
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
