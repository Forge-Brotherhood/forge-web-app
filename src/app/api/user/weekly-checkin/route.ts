import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { invalidateAiContextCache } from "@/lib/ai/userContext";
import {
  createLifeContext,
  getActiveLifeContext,
  getPreviousWeekIntention,
  hasCheckedInThisWeek,
  getCheckinSuggestions,
  getDefaultExpiresAt,
} from "@/lib/lifeContext";
import type { WeeklyIntentionValue, ScheduleValue } from "@/lib/lifeContext";

// =============================================================================
// Validation Schemas
// =============================================================================

const checkinRequestSchema = z.object({
  carrying: z.string().min(1).max(500),
  hoping: z.string().max(500).optional(),
  busyDays: z.array(z.string()).optional(),
  sessionLength: z.enum(["short", "medium", "deep"]).optional(),
  previousWeekResolved: z.boolean().optional(),
});

// =============================================================================
// GET /api/user/weekly-checkin
// Get check-in status, suggestions, and previous week context
// =============================================================================

export async function GET() {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get check-in status
    const hasCompleted = await hasCheckedInThisWeek(user.id);

    // Get previous week's intention
    const previousWeek = await getPreviousWeekIntention(user.id);

    // Get personalized suggestions
    const suggestions = await getCheckinSuggestions(user.id);

    // Get current week's context if exists
    const activeContext = await getActiveLifeContext(user.id);
    const weeklyIntention = activeContext.find((c) => c.type === "weekly_intention");
    const schedule = activeContext.find((c) => c.type === "schedule");

    // Get last check-in date
    const lastCheckin = await prisma.userLifeContext.findFirst({
      where: {
        userId: user.id,
        type: "weekly_intention",
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    return NextResponse.json({
      success: true,
      hasCompletedThisWeek: hasCompleted,
      lastCheckinDate: lastCheckin?.createdAt.toISOString() ?? null,
      previousWeek: previousWeek
        ? {
            carrying: previousWeek.carrying,
            hoping: previousWeek.hoping,
            resolved: false, // User marks this via POST
          }
        : null,
      suggestions,
      currentContext: {
        weeklyIntention: weeklyIntention
          ? (weeklyIntention.value as WeeklyIntentionValue)
          : null,
        busyDays: schedule
          ? (schedule.value as ScheduleValue).busyDays ?? null
          : null,
      },
    });
  } catch (error) {
    console.error("Error fetching weekly check-in:", error);
    return NextResponse.json(
      { error: "Failed to fetch weekly check-in" },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST /api/user/weekly-checkin
// Submit weekly check-in (creates/updates life context items)
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = checkinRequestSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const createdItems = [];

    // Create weekly intention
    const intentionValue: WeeklyIntentionValue = {
      carrying: validated.carrying,
      hoping: validated.hoping,
      sessionLength: validated.sessionLength,
    };

    const intention = await createLifeContext(
      user.id,
      "weekly_intention",
      intentionValue
    );
    createdItems.push(intention);

    // Create/update schedule if busy days provided
    if (validated.busyDays && validated.busyDays.length > 0) {
      const scheduleValue: ScheduleValue = {
        busyDays: validated.busyDays,
      };

      const schedule = await createLifeContext(
        user.id,
        "schedule",
        scheduleValue
      );
      createdItems.push(schedule);
    }

    // If previous week was marked as resolved, we could track this
    // For now, the previous week's context simply expires naturally

    // Invalidate AI context cache
    await invalidateAiContextCache(user.id);

    return NextResponse.json({
      success: true,
      contextItems: createdItems,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error submitting weekly check-in:", error);
    return NextResponse.json(
      { error: "Failed to submit weekly check-in" },
      { status: 500 }
    );
  }
}
