import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { nanoid } from "nanoid";

// Validation schema for creating a user reading plan
const createUserPlanSchema = z.object({
  templateId: z.string().min(1),
  startDate: z.string().datetime().optional(),
  timezone: z.string().default("America/New_York"),
  notifyDaily: z.boolean().default(true),
});

// GET /api/reading-plans
// Returns all reading plans for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's reading plans
    const userPlans = await prisma.userReadingPlan.findMany({
      where: {
        userId: authResult.userId,
        deletedAt: null,
      },
      include: {
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
        _count: {
          select: { progress: true },
        },
      },
      orderBy: [{ status: "asc" }, { startDate: "desc" }],
    });

    return NextResponse.json({
      success: true,
      plans: userPlans.map((plan) => ({
        id: plan.id,
        shortId: plan.shortId,
        status: plan.status,
        startDate: plan.startDate.toISOString(),
        timezone: plan.timezone,
        notifyDaily: plan.notifyDaily,
        template: {
          id: plan.template.id,
          shortId: plan.template.shortId,
          title: plan.template.title,
          subtitle: plan.template.subtitle,
          coverImageUrl: plan.template.coverImageUrl,
          totalDays: plan.template.totalDays,
          estimatedMinutesMin: plan.template.estimatedMinutesMin,
          estimatedMinutesMax: plan.template.estimatedMinutesMax,
        },
        progressCount: plan._count.progress,
        createdAt: plan.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching user plans:", error);
    return NextResponse.json(
      { error: "Failed to fetch reading plans" },
      { status: 500 }
    );
  }
}

// POST /api/reading-plans
// Start a new reading plan for the authenticated user
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = createUserPlanSchema.parse(body);

    // Check if user already has an active or scheduled plan with this template
    const existingPlan = await prisma.userReadingPlan.findFirst({
      where: {
        userId: authResult.userId,
        templateId: validatedData.templateId,
        status: { in: ["scheduled", "active"] },
        deletedAt: null,
      },
    });

    if (existingPlan) {
      return NextResponse.json(
        {
          error:
            "You already have an active or scheduled plan with this template. Complete, cancel, or pause the current plan first.",
        },
        { status: 400 }
      );
    }

    // Verify template exists and user has access
    // Users can access: public published templates OR their own private templates
    const template = await prisma.readingPlanTemplate.findFirst({
      where: {
        deletedAt: null,
        AND: [
          // Match by id or shortId
          {
            OR: [
              { id: validatedData.templateId },
              { shortId: validatedData.templateId },
            ],
          },
          // Access control: public templates OR user's own private templates
          {
            OR: [
              { isPublished: true, visibility: "public" },
              { visibility: "private", createdById: authResult.userId },
            ],
          },
        ],
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: "Template not found or not available" },
        { status: 404 }
      );
    }

    // Determine initial status based on start date
    const startDate = validatedData.startDate
      ? new Date(validatedData.startDate)
      : new Date();
    const now = new Date();
    const status = startDate <= now ? "active" : "scheduled";

    const userPlan = await prisma.userReadingPlan.create({
      data: {
        shortId: nanoid(10),
        userId: authResult.userId,
        templateId: template.id,
        startDate,
        status,
        timezone: validatedData.timezone,
        notifyDaily: validatedData.notifyDaily,
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
            totalDays: userPlan.template.totalDays,
          },
          createdAt: userPlan.createdAt.toISOString(),
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
    console.error("Error creating user plan:", error);
    return NextResponse.json(
      { error: "Failed to create reading plan" },
      { status: 500 }
    );
  }
}
