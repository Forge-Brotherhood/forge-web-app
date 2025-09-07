import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateThreadSchema = z.object({
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
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const thread = await prisma.thread.findUnique({
      where: { 
        id,
        deletedAt: null,
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
        group: {
          include: {
            members: {
              where: {
                status: "active",
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
              },
            },
          },
        },
        posts: {
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
            media: true,
            reactions: {
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
                prayerActions: true,
              },
            },
          },
        },
        prayers: {
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
            posts: true,
            prayers: true,
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
    const isMember = thread.group ? thread.group.members.some(m => m.userId === user.id) : false;
    const isSharedToCommunity = thread.sharedToCommunity;

    if (!isMember && !isSharedToCommunity) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Sanitize if anonymous
    const sanitizedThread = {
      ...thread,
      author: thread.isAnonymous ? null : thread.author,
      posts: thread.posts.map(post => ({
        ...post,
        author: thread.isAnonymous && post.authorId === thread.authorId ? null : post.author,
      })),
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

// PATCH /api/threads/[id] - Update thread status or settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = updateThreadSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if user owns the thread
    const thread = await prisma.thread.findUnique({
      where: { 
        id,
        deletedAt: null,
      },
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

    const updatedThread = await prisma.thread.update({
      where: { id },
      data: validatedData,
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            profileImageUrl: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
            groupType: true,
          },
        },
        _count: {
          select: {
            posts: true,
            prayers: true,
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
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if user owns the thread
    const thread = await prisma.thread.findUnique({
      where: { 
        id,
        deletedAt: null,
      },
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

    await prisma.thread.update({
      where: { id },
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