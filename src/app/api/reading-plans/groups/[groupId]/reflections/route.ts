import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Validation schema for creating a reflection
const createReflectionSchema = z.object({
  templateDayId: z.string().min(1),
  kind: z.enum(["reflection", "self_prayer", "group_prayer"]).default("reflection"),
  visibility: z.enum(["private", "group"]).default("group"),
  content: z.string().max(5000).optional(),
  audioUrl: z.string().url().optional(),
  targetUserId: z.string().optional(), // For group_prayer kind
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

// GET /api/reading-plans/groups/[groupId]/reflections
// Get reflections for a specific day (or all days if no dayId provided)
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
    const { searchParams } = new URL(request.url);
    const templateDayId = searchParams.get("dayId");

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
        status: { in: ["scheduled", "active", "completed"] },
        deletedAt: null,
      },
    });

    if (!groupPlan) {
      return NextResponse.json({
        success: true,
        reflections: [],
      });
    }

    // Build query for reflections
    const whereClause: NonNullable<
      Parameters<typeof prisma.readingPlanReflection.findMany>[0]
    >["where"] = {
      groupPlanId: groupPlan.id,
      // User can see: their own reflections (any visibility) + group reflections from others
      OR: [{ visibility: "group" }, { userId: authResult.userId }],
    };

    if (templateDayId) {
      whereClause.templateDayId = templateDayId;
    }

    const reflections = await prisma.readingPlanReflection.findMany({
      where: whereClause,
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
        templateDay: {
          select: {
            dayNumber: true,
            passageRef: true,
            title: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({
      success: true,
      reflections: reflections.map((r) => ({
        id: r.id,
        kind: r.kind,
        visibility: r.visibility,
        content: r.content,
        audioUrl: r.audioUrl,
        day: {
          id: r.templateDayId,
          dayNumber: r.templateDay.dayNumber,
          passageRef: r.templateDay.passageRef,
          title: r.templateDay.title,
        },
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
    });
  } catch (error) {
    console.error("Error fetching reflections:", error);
    return NextResponse.json(
      { error: "Failed to fetch reflections" },
      { status: 500 }
    );
  }
}

// POST /api/reading-plans/groups/[groupId]/reflections
// Create a new reflection
export async function POST(
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
    const validatedData = createReflectionSchema.parse(body);

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

    // Validate targetUserId if provided (must be group member)
    if (validatedData.targetUserId) {
      const targetIsMember = await isGroupMember(
        validatedData.targetUserId,
        group.id
      );
      if (!targetIsMember) {
        return NextResponse.json(
          { error: "Target user is not a member of this group" },
          { status: 400 }
        );
      }
    }

    // Require content or audioUrl
    if (!validatedData.content && !validatedData.audioUrl) {
      return NextResponse.json(
        { error: "Either content or audioUrl is required" },
        { status: 400 }
      );
    }

    const reflection = await prisma.readingPlanReflection.create({
      data: {
        groupPlanId: groupPlan.id,
        templateDayId: validatedData.templateDayId,
        userId: authResult.userId,
        kind: validatedData.kind,
        visibility: validatedData.visibility,
        content: validatedData.content ?? null,
        audioUrl: validatedData.audioUrl ?? null,
        targetUserId: validatedData.targetUserId ?? null,
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
        templateDay: {
          select: {
            dayNumber: true,
            passageRef: true,
            title: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        reflection: {
          id: reflection.id,
          kind: reflection.kind,
          visibility: reflection.visibility,
          content: reflection.content,
          audioUrl: reflection.audioUrl,
          day: {
            id: reflection.templateDayId,
            dayNumber: reflection.templateDay.dayNumber,
            passageRef: reflection.templateDay.passageRef,
            title: reflection.templateDay.title,
          },
          author: {
            id: reflection.user.id,
            displayName: reflection.user.displayName,
            firstName: reflection.user.firstName,
            profileImageUrl: reflection.user.profileImageUrl,
          },
          targetUser: reflection.targetUser
            ? {
                id: reflection.targetUser.id,
                displayName: reflection.targetUser.displayName,
                firstName: reflection.targetUser.firstName,
              }
            : null,
          isOwn: true,
          createdAt: reflection.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating reflection:", error);
    return NextResponse.json(
      { error: "Failed to create reflection" },
      { status: 500 }
    );
  }
}
