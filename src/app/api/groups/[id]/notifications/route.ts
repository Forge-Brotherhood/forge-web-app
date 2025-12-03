import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updatePreferenceSchema = z.object({
  pushEnabled: z.boolean(),
});

/**
 * GET /api/groups/[id]/notifications
 * Get the current user's notification preference for a group.
 * Returns pushEnabled: true if no preference exists (default ON).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: clerkId } = await auth();

    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: groupId } = await params;

    // Get the user's internal ID
    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Verify user is a member of the group
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: user.id,
        },
      },
    });

    if (!membership || membership.status !== "active") {
      return NextResponse.json(
        { error: "Not a member of this group" },
        { status: 403 }
      );
    }

    // Get the preference (or default to true)
    const preference = await prisma.groupNotificationPreference.findUnique({
      where: {
        userId_groupId: {
          userId: user.id,
          groupId,
        },
      },
      select: { pushEnabled: true },
    });

    return NextResponse.json({
      pushEnabled: preference?.pushEnabled ?? true, // Default ON
    });
  } catch (error) {
    console.error("Error getting notification preference:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/groups/[id]/notifications
 * Update the current user's notification preference for a group.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: clerkId } = await auth();

    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: groupId } = await params;
    const body = await req.json();
    const { pushEnabled } = updatePreferenceSchema.parse(body);

    // Get the user's internal ID
    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Verify user is a member of the group
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: user.id,
        },
      },
    });

    if (!membership || membership.status !== "active") {
      return NextResponse.json(
        { error: "Not a member of this group" },
        { status: 403 }
      );
    }

    // Upsert the preference
    const preference = await prisma.groupNotificationPreference.upsert({
      where: {
        userId_groupId: {
          userId: user.id,
          groupId,
        },
      },
      create: {
        userId: user.id,
        groupId,
        pushEnabled,
      },
      update: {
        pushEnabled,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      pushEnabled: preference.pushEnabled,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request body", details: error.flatten() },
        { status: 400 }
      );
    }

    console.error("Error updating notification preference:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
