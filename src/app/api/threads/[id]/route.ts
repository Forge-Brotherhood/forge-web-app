import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateThreadSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  status: z.enum(["open", "answered", "archived"]).optional(),
  sharedToCommunity: z.boolean().optional(),
});

// GET /api/threads/[id] - Get thread details with all posts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Resolve id or shortId
    const resolved = await prisma.prayerRequest.findFirst({
      where: {
        OR: [{ id }, { shortId: id }],
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!resolved) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    const thread = await prisma.prayerRequest.findUnique({
      where: {
        id: resolved.id,
      },
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            profileImageUrl: true,
            voiceIntroUrl: true,
          },
        },
        entries: {
          orderBy: {
            createdAt: "asc",
          },
          include: {
            author: {
              select: {
                id: true,
                displayName: true,
                firstName: true,
                profileImageUrl: true,
              },
            },
            attachments: true,
            responses: {
              include: {
                user: {
                  select: {
                    id: true,
                    displayName: true,
                    firstName: true,
                  },
                },
              },
            },
            _count: {
              select: {
                actions: true,
              },
            },
          },
        },
        actions: {
          select: {
            userId: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                displayName: true,
                firstName: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        _count: {
          select: {
            entries: true,
            actions: true,
            savedBy: true,
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

    // Check if user has access to this thread
    // Access check: user must be author or thread must be shared to community
    if (thread.authorId !== user.id && !thread.sharedToCommunity) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Check if current user has prayed for this thread
    const mainEntry = thread.entries.find(p => p.kind === "request") || thread.entries[0];
    const hasPrayed = thread.actions.some(p => p.userId === user.id);
    const prayerCount = thread._count.actions;

    // Check if thread is in user's prayer list
    // Look for saved prayers with either null entryId (thread-level) or specific entry
    const prayerListItem = await prisma.savedPrayer.findFirst({
      where: {
        userId: user.id,
        requestId: thread.id,
      },
    });
    const isInPrayerList = !!prayerListItem;
    const prayerListCount = thread._count.savedBy;

    // Sanitize if anonymous
    const sanitizedThread = {
      ...thread,
      author: thread.isAnonymous ? null : thread.author,
    } as any;

    // Return in format expected by client hook
    return NextResponse.json({
      thread: sanitizedThread,
      currentUser: {
        id: user.id,
        displayName: user.displayName,
        firstName: user.firstName,
        profileImageUrl: user.profileImageUrl,
      },
      initialPrayerStatus: {
        hasPrayed,
        prayerCount,
        isInPrayerList,
        prayerListCount,
      },
    });
  } catch (error) {
    console.error("Error fetching thread:", error);
    return NextResponse.json(
      { error: "Failed to fetch thread" },
      { status: 500 }
    );
  }
}

// PATCH /api/threads/[id] - Update thread status or settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = updateThreadSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { id: authResult.userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if user owns the thread
    const resolved = await prisma.prayerRequest.findFirst({
      where: { OR: [{ id }, { shortId: id }], deletedAt: null },
      select: { id: true, authorId: true },
    });

    if (!resolved) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    const thread = await prisma.prayerRequest.findUnique({
      where: { id: resolved.id },
      select: {
        authorId: true,
      },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    if (thread.authorId !== user.id) {
      return NextResponse.json(
        { error: "Only thread author can update it" },
        { status: 403 }
      );
    }

    const updatedThread = await prisma.prayerRequest.update({
      where: { id: resolved.id },
      data: {
        ...(validatedData.title !== undefined && { title: validatedData.title }),
        ...(validatedData.status !== undefined && { status: validatedData.status }),
        ...(validatedData.sharedToCommunity !== undefined && { sharedToCommunity: validatedData.sharedToCommunity }),
      },
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            profileImageUrl: true,
          },
        },
        _count: {
          select: {
            entries: true,
            actions: true,
          },
        },
      },
    });

    return NextResponse.json(updatedThread);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating thread:", error);
    return NextResponse.json(
      { error: "Failed to update thread" },
      { status: 500 }
    );
  }
}

// DELETE /api/threads/[id] - Soft delete a thread
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Check if user owns the thread
    const resolved = await prisma.prayerRequest.findFirst({
      where: { OR: [{ id }, { shortId: id }], deletedAt: null },
      select: { id: true, authorId: true },
    });

    if (!resolved) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    const thread = await prisma.prayerRequest.findUnique({
      where: { id: resolved.id },
      select: {
        authorId: true,
      },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    if (thread.authorId !== user.id) {
      return NextResponse.json(
        { error: "Only thread author can delete it" },
        { status: 403 }
      );
    }

    await prisma.prayerRequest.update({
      where: { id: resolved.id },
      data: {
        deletedAt: new Date(),
      },
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