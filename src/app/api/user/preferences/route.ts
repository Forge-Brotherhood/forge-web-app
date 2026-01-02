import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { invalidateAiContextCache } from "@/lib/ai/userContext";

// Validation schema for creating/updating preferences
const preferencesSchema = z.object({
  displayName: z.string().max(100).nullable().optional(),
  translationId: z.string().max(10).optional(),
  explanationStyle: z.enum(["gentle", "balanced", "deep", "questions"]).optional(),
  experienceLevel: z.enum(["new", "growing", "mature", "scholar"]).optional(),
  encouragementStyle: z.enum(["direct", "gentle", "challenge", "questions"]).optional(),
  studyIntent: z.array(z.enum(["peace", "understanding", "encouragement", "guidance"])).optional(),
  memoryMode: z.enum(["off", "minimal", "standard", "full"]).optional(),
});

/**
 * GET /api/user/preferences
 * Retrieve current user preferences
 */
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

    const preferences = await prisma.userPreferences.findUnique({
      where: { userId: user.id },
    });

    return NextResponse.json({
      success: true,
      preferences: preferences || null,
    });
  } catch (error) {
    console.error("Error fetching preferences:", error);
    return NextResponse.json(
      { error: "Failed to fetch preferences" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/preferences
 * Create or replace preferences (upsert)
 * Called after onboarding to sync iOS preferences to backend
 */
export async function POST(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = preferencesSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Build the data object with only provided fields
    const data: Record<string, unknown> = {};
    if (validatedData.displayName !== undefined) data.displayName = validatedData.displayName;
    if (validatedData.translationId) data.translationId = validatedData.translationId;
    if (validatedData.explanationStyle) data.explanationStyle = validatedData.explanationStyle;
    if (validatedData.experienceLevel) data.experienceLevel = validatedData.experienceLevel;
    if (validatedData.encouragementStyle) data.encouragementStyle = validatedData.encouragementStyle;
    if (validatedData.studyIntent) data.studyIntent = validatedData.studyIntent;
    if (validatedData.memoryMode) data.memoryMode = validatedData.memoryMode;

    const preferences = await prisma.userPreferences.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        ...data,
      },
      update: data,
    });

    // Invalidate cached AI context
    await invalidateAiContextCache(user.id);

    return NextResponse.json({
      success: true,
      preferences,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error saving preferences:", error);
    return NextResponse.json(
      { error: "Failed to save preferences" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/user/preferences
 * Update specific preference fields
 */
export async function PATCH(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = preferencesSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if preferences exist
    const existing = await prisma.userPreferences.findUnique({
      where: { userId: user.id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Preferences not found. Use POST to create." },
        { status: 404 }
      );
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (validatedData.displayName !== undefined) updateData.displayName = validatedData.displayName;
    if (validatedData.translationId !== undefined) updateData.translationId = validatedData.translationId;
    if (validatedData.explanationStyle !== undefined) updateData.explanationStyle = validatedData.explanationStyle;
    if (validatedData.experienceLevel !== undefined) updateData.experienceLevel = validatedData.experienceLevel;
    if (validatedData.encouragementStyle !== undefined) updateData.encouragementStyle = validatedData.encouragementStyle;
    if (validatedData.studyIntent !== undefined) updateData.studyIntent = validatedData.studyIntent;
    if (validatedData.memoryMode !== undefined) updateData.memoryMode = validatedData.memoryMode;

    const preferences = await prisma.userPreferences.update({
      where: { userId: user.id },
      data: updateData,
    });

    // Invalidate cached AI context
    await invalidateAiContextCache(user.id);

    return NextResponse.json({
      success: true,
      preferences,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating preferences:", error);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    );
  }
}
