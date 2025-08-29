import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createUpdateSchema = z.object({
  body: z.string().min(1).max(1000),
});

// GET /api/threads/[id]/updates - List updates for a thread
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const updates = await prisma.threadUpdate.findMany({
      where: { threadId: id },
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
    });

    return NextResponse.json(updates);
  } catch (error) {
    console.error("Error fetching updates:", error);
    return NextResponse.json(
      { error: "Failed to fetch updates" },
      { status: 500 }
    );
  }
}

// POST /api/threads/[id]/updates - Create a new update (thread authors only)
export async function POST(
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
    const validatedData = createUpdateSchema.parse(body);

    // Get the user from database
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if thread exists and user is the author
    const thread = await prisma.prayerThread.findUnique({
      where: { id },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    // Only thread author can post updates
    if (thread.authorId !== user.id) {
      return NextResponse.json(
        { error: "Only thread authors can post updates" },
        { status: 403 }
      );
    }

    // Check if thread is open
    if (thread.status !== "open") {
      return NextResponse.json(
        { error: "Cannot add update to closed thread" },
        { status: 400 }
      );
    }

    const update = await prisma.threadUpdate.create({
      data: {
        body: validatedData.body,
        threadId: id,
        authorId: user.id,
      },
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
    });

    return NextResponse.json(update, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating update:", error);
    return NextResponse.json(
      { error: "Failed to create update" },
      { status: 500 }
    );
  }
}