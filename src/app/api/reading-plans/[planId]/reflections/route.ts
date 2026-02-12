import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Validation schema for creating a reflection
const createReflectionSchema = z.object({
  templateDayId: z.string().min(1),
  kind: z.enum(["reflection", "self_prayer"]).default("reflection"),
  content: z.string().max(5000).optional(),
  audioUrl: z.string().url().optional(),
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

// GET /api/reading-plans/[planId]/reflections
// Get user's reflections for a specific day (or all days if no dayId provided)
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
    const { searchParams } = new URL(request.url);
    const templateDayId = searchParams.get("dayId");

    const userPlan = await getUserPlan(authResult.userId, planId);

    if (!userPlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Build query for reflections
    const whereClause: NonNullable<
      Parameters<typeof prisma.readingPlanReflection.findMany>[0]
    >["where"] = {
      userPlanId: userPlan.id,
      userId: authResult.userId,
    };

    if (templateDayId) {
      whereClause.templateDayId = templateDayId;
    }

    const reflections = await prisma.readingPlanReflection.findMany({
      where: whereClause,
      include: {
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
        content: r.content,
        audioUrl: r.audioUrl,
        day: {
          id: r.templateDayId,
          dayNumber: r.templateDay.dayNumber,
          passageRef: r.templateDay.passageRef,
          title: r.templateDay.title,
        },
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

// POST /api/reading-plans/[planId]/reflections
// Create a new reflection
export async function POST(
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

    const body = await request.json();
    const validatedData = createReflectionSchema.parse(body);

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

    // Require content or audioUrl
    if (!validatedData.content && !validatedData.audioUrl) {
      return NextResponse.json(
        { error: "Either content or audioUrl is required" },
        { status: 400 }
      );
    }

    const reflection = await prisma.readingPlanReflection.create({
      data: {
        userPlanId: userPlan.id,
        templateDayId: validatedData.templateDayId,
        userId: authResult.userId,
        kind: validatedData.kind,
        content: validatedData.content ?? null,
        audioUrl: validatedData.audioUrl ?? null,
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
    });

    return NextResponse.json(
      {
        success: true,
        reflection: {
          id: reflection.id,
          kind: reflection.kind,
          content: reflection.content,
          audioUrl: reflection.audioUrl,
          day: {
            id: reflection.templateDayId,
            dayNumber: reflection.templateDay.dayNumber,
            passageRef: reflection.templateDay.passageRef,
            title: reflection.templateDay.title,
          },
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
