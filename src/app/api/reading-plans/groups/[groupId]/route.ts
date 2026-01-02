import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { nanoid } from "nanoid";

// Validation schema for creating a group plan
const createGroupPlanSchema = z.object({
  templateId: z.string().min(1),
  startDate: z.string().datetime(),
  timezone: z.string().default("America/New_York"),
  notifyDaily: z.boolean().default(true),
  meetingDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
});

// Validation schema for updating a group plan
const updateGroupPlanSchema = z.object({
  status: z.enum(["scheduled", "active", "paused", "completed", "canceled"]).optional(),
  notifyDaily: z.boolean().optional(),
  meetingDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
});

// Helper to check if user is a group leader
async function isGroupLeader(
  userId: string,
  groupId: string
): Promise<boolean> {
  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: { groupId, userId },
    },
    select: { role: true, status: true },
  });
  return membership?.status === "active" && membership?.role === "leader";
}

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

// GET /api/reading-plans/groups/[groupId]
// Get the active/scheduled reading plan for a group
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

    // First resolve the group (could be id or shortId)
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

    // Get active or scheduled plan (most recent)
    const groupPlan = await prisma.groupReadingPlan.findFirst({
      where: {
        groupId: group.id,
        deletedAt: null,
        status: { in: ["scheduled", "active"] },
      },
      include: {
        template: {
          include: {
            days: {
              orderBy: { dayNumber: "asc" },
            },
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
          select: { progress: true, reflections: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!groupPlan) {
      return NextResponse.json({
        success: true,
        groupPlan: null,
      });
    }

    return NextResponse.json({
      success: true,
      groupPlan: {
        id: groupPlan.id,
        shortId: groupPlan.shortId,
        status: groupPlan.status,
        startDate: groupPlan.startDate.toISOString(),
        timezone: groupPlan.timezone,
        notifyDaily: groupPlan.notifyDaily,
        meetingDayOfWeek: groupPlan.meetingDayOfWeek,
        template: {
          id: groupPlan.template.id,
          shortId: groupPlan.template.shortId,
          title: groupPlan.template.title,
          subtitle: groupPlan.template.subtitle,
          description: groupPlan.template.description,
          coverImageUrl: groupPlan.template.coverImageUrl,
          totalDays: groupPlan.template.totalDays,
          estimatedMinutesMin: groupPlan.template.estimatedMinutesMin,
          estimatedMinutesMax: groupPlan.template.estimatedMinutesMax,
          days: groupPlan.template.days.map((d) => ({
            // Back-compat: derive legacy range fields from scriptureBlocks (first/last block)
            // NOTE: scriptureBlocks is the source of truth.
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
        createdBy: {
          id: groupPlan.createdBy.id,
          displayName: groupPlan.createdBy.displayName,
          firstName: groupPlan.createdBy.firstName,
        },
        progressCount: groupPlan._count.progress,
        reflectionsCount: groupPlan._count.reflections,
        createdAt: groupPlan.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching group plan:", error);
    return NextResponse.json(
      { error: "Failed to fetch group plan" },
      { status: 500 }
    );
  }
}

// POST /api/reading-plans/groups/[groupId]
// Start a new reading plan for a group (group leader only)
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

    // Check if user is a group leader
    const isLeader = await isGroupLeader(authResult.userId, group.id);
    if (!isLeader) {
      return NextResponse.json(
        { error: "Only group leaders can start reading plans" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = createGroupPlanSchema.parse(body);

    // Check if group already has an active or scheduled plan
    const existingPlan = await prisma.groupReadingPlan.findFirst({
      where: {
        groupId: group.id,
        status: { in: ["scheduled", "active"] },
        deletedAt: null,
      },
    });

    if (existingPlan) {
      return NextResponse.json(
        {
          error:
            "Group already has an active or scheduled plan. Complete, cancel, or pause the current plan first.",
        },
        { status: 400 }
      );
    }

    // Verify template exists and is published
    const template = await prisma.readingPlanTemplate.findFirst({
      where: {
        OR: [
          { id: validatedData.templateId },
          { shortId: validatedData.templateId },
        ],
        isPublished: true,
        visibility: "public",
        deletedAt: null,
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Template not found or not available" },
        { status: 404 }
      );
    }

    // Determine initial status based on start date
    const startDate = new Date(validatedData.startDate);
    const now = new Date();
    const status = startDate <= now ? "active" : "scheduled";

    const groupPlan = await prisma.groupReadingPlan.create({
      data: {
        shortId: nanoid(10),
        groupId: group.id,
        templateId: template.id,
        startDate,
        status,
        timezone: validatedData.timezone,
        notifyDaily: validatedData.notifyDaily,
        meetingDayOfWeek: validatedData.meetingDayOfWeek ?? null,
        createdById: authResult.userId,
      },
      include: {
        template: {
          select: {
            id: true,
            shortId: true,
            title: true,
            totalDays: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        groupPlan: {
          id: groupPlan.id,
          shortId: groupPlan.shortId,
          status: groupPlan.status,
          startDate: groupPlan.startDate.toISOString(),
          timezone: groupPlan.timezone,
          notifyDaily: groupPlan.notifyDaily,
          meetingDayOfWeek: groupPlan.meetingDayOfWeek,
          template: {
            id: groupPlan.template.id,
            shortId: groupPlan.template.shortId,
            title: groupPlan.template.title,
            totalDays: groupPlan.template.totalDays,
          },
          createdAt: groupPlan.createdAt.toISOString(),
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
    console.error("Error creating group plan:", error);
    return NextResponse.json(
      { error: "Failed to create group plan" },
      { status: 500 }
    );
  }
}

// PATCH /api/reading-plans/groups/[groupId]
// Update the group's reading plan status (group leader only)
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

    // Check if user is a group leader
    const isLeader = await isGroupLeader(authResult.userId, group.id);
    if (!isLeader) {
      return NextResponse.json(
        { error: "Only group leaders can modify reading plans" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = updateGroupPlanSchema.parse(body);

    // Get the active plan
    const existingPlan = await prisma.groupReadingPlan.findFirst({
      where: {
        groupId: group.id,
        status: { in: ["scheduled", "active", "paused"] },
        deletedAt: null,
      },
    });

    if (!existingPlan) {
      return NextResponse.json(
        { error: "No active plan found for this group" },
        { status: 404 }
      );
    }

    const groupPlan = await prisma.groupReadingPlan.update({
      where: { id: existingPlan.id },
      data: validatedData,
    });

    return NextResponse.json({
      success: true,
      groupPlan: {
        id: groupPlan.id,
        shortId: groupPlan.shortId,
        status: groupPlan.status,
        startDate: groupPlan.startDate.toISOString(),
        timezone: groupPlan.timezone,
        notifyDaily: groupPlan.notifyDaily,
        meetingDayOfWeek: groupPlan.meetingDayOfWeek,
        updatedAt: groupPlan.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating group plan:", error);
    return NextResponse.json(
      { error: "Failed to update group plan" },
      { status: 500 }
    );
  }
}

// DELETE /api/reading-plans/groups/[groupId]
// Soft delete the group's reading plan (group leader only)
export async function DELETE(
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

    // Check if user is a group leader
    const isLeader = await isGroupLeader(authResult.userId, group.id);
    if (!isLeader) {
      return NextResponse.json(
        { error: "Only group leaders can delete reading plans" },
        { status: 403 }
      );
    }

    // Get the plan to delete
    const existingPlan = await prisma.groupReadingPlan.findFirst({
      where: {
        groupId: group.id,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!existingPlan) {
      return NextResponse.json(
        { error: "No plan found for this group" },
        { status: 404 }
      );
    }

    // Soft delete
    await prisma.groupReadingPlan.update({
      where: { id: existingPlan.id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting group plan:", error);
    return NextResponse.json(
      { error: "Failed to delete group plan" },
      { status: 500 }
    );
  }
}
