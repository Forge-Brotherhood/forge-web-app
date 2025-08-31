import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// GET /api/threads/[id] - Get a specific thread
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const thread = await prisma.prayerThread.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            handle: true,
            avatarUrl: true,
          },
        },
        encouragements: {
          include: {
            author: {
              select: {
                id: true,
                displayName: true,
                handle: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        updates: {
          include: {
            author: {
              select: {
                id: true,
                displayName: true,
                handle: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        _count: {
          select: {
            prayers: true,
            encouragements: true,
            updates: true,
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

    // Hide author info if anonymous
    const sanitizedThread = {
      ...thread,
      author: thread.isAnonymous ? null : thread.author,
    };

    return NextResponse.json(sanitizedThread);
  } catch (error) {
    console.error("Error fetching thread:", error);
    return NextResponse.json(
      { error: "Failed to fetch thread" },
      { status: 500 }
    );
  }
}

// PATCH /api/threads/[id] - Update thread status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    // Get the user and thread
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const thread = await prisma.prayerThread.findUnique({
      where: { id },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    // Only thread author can update status
    if (thread.authorId !== user.id) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    const updateData: any = {};
    if (status) {
      updateData.status = status;
      if (status === "answered") {
        updateData.answeredAt = new Date();
      }
    }

    const updatedThread = await prisma.prayerThread.update({
      where: { id },
      data: updateData,
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            handle: true,
            avatarUrl: true,
          },
        },
        _count: {
          select: {
            prayers: true,
            encouragements: true,
            updates: true,
          },
        },
      },
    });

    // Hide author info if anonymous
    const sanitizedThread = {
      ...updatedThread,
      author: updatedThread.isAnonymous ? null : updatedThread.author,
    };

    return NextResponse.json(sanitizedThread);
  } catch (error) {
    console.error("Error updating thread:", error);
    return NextResponse.json(
      { error: "Failed to update thread" },
      { status: 500 }
    );
  }
}

// DELETE /api/threads/[id] - Delete a thread
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Get the user and thread
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const thread = await prisma.prayerThread.findUnique({
      where: { id },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    // Only thread author can delete
    if (thread.authorId !== user.id) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    // Delete related records first to avoid foreign key constraint errors
    await prisma.$transaction(async (tx) => {
      // Delete all prayer cart items for this thread
      await tx.prayerCartItem.deleteMany({
        where: { threadId: id },
      });

      // Delete all prayers for this thread
      await tx.prayer.deleteMany({
        where: { threadId: id },
      });

      // Delete all encouragements for this thread
      await tx.encouragement.deleteMany({
        where: { threadId: id },
      });

      // Delete all thread updates
      await tx.threadUpdate.deleteMany({
        where: { threadId: id },
      });

      // Finally delete the thread
      await tx.prayerThread.delete({
        where: { id },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting thread:", error);
    return NextResponse.json(
      { error: "Failed to delete thread" },
      { status: 500 }
    );
  }
}