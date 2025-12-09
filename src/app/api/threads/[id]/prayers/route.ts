import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createPrayerSchema = z.object({
  postId: z.string().uuid().optional(),
});

// GET /api/threads/[id]/prayers - Get all prayer actions for a thread
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params;
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const resolved = await prisma.prayerRequest.findFirst({
      where: { OR: [{ id: threadId }, { shortId: threadId }], deletedAt: null },
      select: { id: true },
    });

    if (!resolved) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    // Verify request exists and user has access
    const thread = await prisma.prayerRequest.findUnique({
      where: { 
        id: resolved.id,
      },
      include: {
        group: {
          include: {
            members: {
              where: {
                userId: user.id,
                status: "active",
              },
            },
          },
        },
      },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    const isMember = thread.group ? thread.group.members.length > 0 : false;
    if (!isMember && !thread.sharedToCommunity) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const prayers = await prisma.prayerAction.findMany({
      where: {
        requestId: resolved.id,
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
        entry: {
          select: {
            id: true,
            kind: true,
            content: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Check if current user has prayed for this thread
    const userPrayer = prayers.find(p => p.user.id === user.id);
    const hasPrayed = !!userPrayer;
    const prayerCount = prayers.length;

    return NextResponse.json({
      hasPrayed,
      prayerCount,
      prayers,
    });
  } catch (error) {
    console.error("Error fetching prayers:", error);
    return NextResponse.json(
      { error: "Failed to fetch prayers" },
      { status: 500 }
    );
  }
}

// POST /api/threads/[id]/prayers - Record a prayer action
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params;
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = createPrayerSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { id: authResult.userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const resolved = await prisma.prayerRequest.findFirst({
      where: { OR: [{ id: threadId }, { shortId: threadId }], deletedAt: null },
      select: { id: true },
    });

    if (!resolved) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    // Verify thread exists and user has access
    const thread = await prisma.prayerRequest.findUnique({
      where: { 
        id: resolved.id,
      },
      include: {
        group: {
          include: {
            members: {
              where: {
                userId: user.id,
                status: "active",
              },
            },
          },
        },
      },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    const isMember = thread.group ? thread.group.members.length > 0 : false;
    if (!isMember && !thread.sharedToCommunity) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // If postId provided, verify it belongs to the thread
    if (validatedData.postId) {
      const post = await prisma.prayerEntry.findFirst({
        where: {
          id: validatedData.postId,
          requestId: resolved.id,
        },
      });

      if (!post) {
        return NextResponse.json(
          { error: "Post not found in this thread" },
          { status: 400 }
        );
      }
    }

    // Create prayer action and update user streak
    const result = await prisma.$transaction(async (tx) => {
      const prayer = await tx.prayerAction.create({
        data: {
          userId: user.id,
          requestId: resolved.id,
          entryId: validatedData.postId,
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
          entry: {
            select: {
              id: true,
              kind: true,
              content: true,
            },
          },
        },
      });

      // Update user's prayer streak
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const lastPrayer = user.lastPrayerAt;
      const lastPrayerDate = lastPrayer ? new Date(
        lastPrayer.getFullYear(),
        lastPrayer.getMonth(),
        lastPrayer.getDate()
      ) : null;

      let newStreak = user.prayerStreak;

      if (!lastPrayerDate) {
        // First prayer ever
        newStreak = 1;
      } else if (lastPrayerDate.getTime() === yesterday.getTime()) {
        // Prayed yesterday, continue streak
        newStreak += 1;
      } else if (lastPrayerDate.getTime() < yesterday.getTime()) {
        // Missed days, reset streak
        newStreak = 1;
      }
      // If prayed today already, streak stays same

      await tx.user.update({
        where: { id: user.id },
        data: {
          prayerStreak: newStreak,
          lastPrayerAt: now,
        },
      });

      return { prayer, newStreak };
    });

    return NextResponse.json({
      prayer: result.prayer,
      updatedStreak: result.newStreak,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating prayer:", error);
    return NextResponse.json(
      { error: "Failed to create prayer" },
      { status: 500 }
    );
  }
}

// DELETE /api/threads/[id]/prayers - Remove a prayer action
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params;
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = createPrayerSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { id: authResult.userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Find the user's prayer action for this thread
    const prayerAction = await prisma.prayerAction.findFirst({
      where: {
        userId: user.id,
        requestId: threadId,
        ...(validatedData.postId && { entryId: validatedData.postId }),
      },
    });

    if (!prayerAction) {
      return NextResponse.json(
        { error: "Prayer action not found" },
        { status: 404 }
      );
    }

    // Delete the prayer action
    await prisma.prayerAction.delete({
      where: { id: prayerAction.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error deleting prayer:", error);
    return NextResponse.json(
      { error: "Failed to delete prayer" },
      { status: 500 }
    );
  }
}