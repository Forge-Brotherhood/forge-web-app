import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { invalidateAiContextCache } from "@/lib/ai/userContext";
import {
  createLifeContext,
  getActiveLifeContext,
  deleteLifeContextByType,
  clearAllLifeContext,
} from "@/lib/lifeContext";
import type { LifeContextType, LifeContextValue } from "@/lib/lifeContext";

// =============================================================================
// Validation Schemas
// =============================================================================

const scheduleValueSchema = z.object({
  busyDays: z.array(z.string()).optional(),
  preferredTime: z.enum(["morning", "evening", "flexible"]).optional(),
  travelDays: z.array(z.string()).optional(),
});

const seasonValueSchema = z.object({
  season: z.enum([
    "anxious",
    "grieving",
    "discerning",
    "thankful",
    "lonely",
    "struggling",
    "seeking_discipline",
  ]),
  note: z.string().max(100).optional(),
});

const prayerTopicValueSchema = z.object({
  topic: z.string().min(1).max(200),
  checkInDay: z.string().optional(),
});

const weeklyIntentionValueSchema = z.object({
  carrying: z.string().min(1).max(500),
  hoping: z.string().max(500).optional(),
  sessionLength: z.enum(["short", "medium", "deep"]).optional(),
});

const goalValueSchema = z.object({
  goal: z.string().min(1).max(500),
  category: z.enum(["reading", "prayer", "community", "growth", "other"]).optional(),
});

const createRequestSchema = z.object({
  type: z.enum(["schedule", "season", "prayer_topic", "weekly_intention", "goal"]),
  value: z.union([
    scheduleValueSchema,
    seasonValueSchema,
    prayerTopicValueSchema,
    weeklyIntentionValueSchema,
    goalValueSchema,
  ]),
  source: z.enum(["user_entered", "user_confirmed"]).optional(),
  expiresAt: z.string().datetime().optional(),
  checkInAt: z.string().datetime().optional(),
});

// =============================================================================
// GET /api/user/life-context
// List active life context items (excludes expired)
// =============================================================================

export async function GET(request: NextRequest) {
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

    // Optional type filter
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type") as LifeContextType | null;

    const items = await getActiveLifeContext(user.id, typeFilter || undefined);

    return NextResponse.json({
      success: true,
      items,
    });
  } catch (error) {
    console.error("Error fetching life context:", error);
    return NextResponse.json(
      { error: "Failed to fetch life context" },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST /api/user/life-context
// Create a new life context item
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validated = createRequestSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Validate type-specific value schema
    const valueValidation = validateValueForType(validated.type, validated.value);
    if (!valueValidation.valid) {
      return NextResponse.json(
        { error: "Invalid value for type", details: valueValidation.error },
        { status: 400 }
      );
    }

    const item = await createLifeContext(
      user.id,
      validated.type,
      validated.value as LifeContextValue,
      {
        source: validated.source,
        expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : undefined,
        checkInAt: validated.checkInAt ? new Date(validated.checkInAt) : undefined,
      }
    );

    // Invalidate AI context cache since life context changed
    await invalidateAiContextCache(user.id);

    return NextResponse.json({
      success: true,
      item,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating life context:", error);
    return NextResponse.json(
      { error: "Failed to create life context" },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE /api/user/life-context
// Delete all life context (or by type)
// =============================================================================

export async function DELETE(request: NextRequest) {
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

    // Optional type filter for deletion
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type") as LifeContextType | null;

    let count: number;
    if (typeFilter) {
      count = await deleteLifeContextByType(user.id, typeFilter);
    } else {
      count = await clearAllLifeContext(user.id);
    }

    // Invalidate AI context cache
    await invalidateAiContextCache(user.id);

    return NextResponse.json({
      success: true,
      deleted: count,
    });
  } catch (error) {
    console.error("Error deleting life context:", error);
    return NextResponse.json(
      { error: "Failed to delete life context" },
      { status: 500 }
    );
  }
}

// =============================================================================
// Helpers
// =============================================================================

function validateValueForType(
  type: LifeContextType,
  value: unknown
): { valid: boolean; error?: string } {
  try {
    switch (type) {
      case "schedule":
        scheduleValueSchema.parse(value);
        break;
      case "season":
        seasonValueSchema.parse(value);
        break;
      case "prayer_topic":
        prayerTopicValueSchema.parse(value);
        break;
      case "weekly_intention":
        weeklyIntentionValueSchema.parse(value);
        break;
      case "goal":
        goalValueSchema.parse(value);
        break;
    }
    return { valid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { valid: false, error: error.issues[0].message };
    }
    return { valid: false, error: "Invalid value" };
  }
}
