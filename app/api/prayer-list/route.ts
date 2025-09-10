import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const prayerListItemSchema = z.object({
  threadId: z.string().uuid(),
  postId: z.string().uuid().optional(),
});

// GET /api/prayer-list - Get user's prayer list
export async function GET(request: NextRequest) {
  try {
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

    const prayerListItems = await prisma.prayerListItem.findMany({
      where: {
        userId: user.id,
        thread: {
          deletedAt: null,
        },
      },
      include: {
        thread: {
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
            posts: {
              where: {
                kind: "request",
              },
              take: 1,
              include: {
                media: true,
                author: {
                  select: {
                    id: true,
                    displayName: true,
                    firstName: true,
                    profileImageUrl: true,
                  },
                },
              },
            },
            _count: {
              select: {
                prayers: true,
                posts: true,
                prayerListItems: true,
              },
            },
          },
        },
        post: {
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

    // Filter out items where the referenced post was deleted (if postId exists but post is null)
    // and sanitize anonymous threads
    const validItems = prayerListItems.filter(item => {
      // If the item references a specific post, ensure it still exists
      if (item.postId && !item.post) {
        return false;
      }
      return true;
    });

    const sanitizedItems = validItems.map(item => ({
      ...item,
      thread: {
        ...item.thread,
        author: item.thread.isAnonymous ? null : item.thread.author,
        posts: item.thread.posts.map(post => ({
          ...post,
          author: item.thread.isAnonymous ? null : post.author,
        })),
      },
    }));

    return NextResponse.json({
      success: true,
      items: sanitizedItems,
      count: sanitizedItems.length,
    });
  } catch (error) {
    console.error("Error fetching prayer list:", error);
    return NextResponse.json(
      { error: "Failed to fetch prayer list" },
      { status: 500 }
    );
  }
}

// POST /api/prayer-list - Add item to prayer list
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = prayerListItemSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Verify thread exists and user has access
    const thread = await prisma.thread.findUnique({
      where: { 
        id: validatedData.threadId,
        deletedAt: null,
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
      const post = await prisma.post.findFirst({
        where: {
          id: validatedData.postId,
          threadId: validatedData.threadId,
        },
      });

      if (!post) {
        return NextResponse.json(
          { error: "Post not found in this thread" },
          { status: 400 }
        );
      }
    }

    // Check if already in prayer list
    const existing = await prisma.prayerListItem.findFirst({
      where: {
        userId: user.id,
        threadId: validatedData.threadId,
        postId: validatedData.postId || null,
      },
      include: {
        thread: {
          include: {
            _count: {
              select: {
                prayerListItems: true,
              },
            },
          },
        },
      },
    });

    if (existing) {
      // Item already exists - return success with current state (idempotent behavior)
      return NextResponse.json({
        item: existing,
        message: "Already in prayer list",
        wasAlreadyInState: true,
        success: true,
      }, { status: 200 });
    }

    // Create prayer list item
    const prayerListItem = await prisma.prayerListItem.create({
      data: {
        userId: user.id,
        threadId: validatedData.threadId,
        postId: validatedData.postId,
      },
      include: {
        thread: {
          include: {
            _count: {
              select: {
                prayerListItems: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      item: prayerListItem,
      message: "Added to prayer list",
      wasAlreadyInState: false,
      success: true,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error adding to prayer list:", error);
    return NextResponse.json(
      { error: "Failed to add to prayer list" },
      { status: 500 }
    );
  }
}

// DELETE /api/prayer-list - Remove item from prayer list
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = prayerListItemSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Find the prayer list item
    const prayerListItem = await prisma.prayerListItem.findFirst({
      where: {
        userId: user.id,
        threadId: validatedData.threadId,
        postId: validatedData.postId || null,
      },
    });

    // Get updated count (whether we delete or not)
    const updatedCount = await prisma.prayerListItem.count({
      where: {
        threadId: validatedData.threadId,
      },
    });

    if (!prayerListItem) {
      // Item doesn't exist - return success with current state (idempotent behavior)
      return NextResponse.json({ 
        success: true,
        message: "Not in prayer list",
        wasAlreadyInState: true,
        updatedCount,
      }, { status: 200 });
    }

    // Delete the prayer list item
    await prisma.prayerListItem.delete({
      where: { id: prayerListItem.id },
    });

    // Get final count after deletion
    const finalCount = await prisma.prayerListItem.count({
      where: {
        threadId: validatedData.threadId,
      },
    });

    return NextResponse.json({ 
      success: true,
      message: "Removed from prayer list",
      wasAlreadyInState: false,
      updatedCount: finalCount,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error removing from prayer list:", error);
    return NextResponse.json(
      { error: "Failed to remove from prayer list" },
      { status: 500 }
    );
  }
}