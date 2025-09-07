import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createEncouragementSchema = z.object({
  body: z.string().min(1).max(300),
});

// GET /api/threads/[id]/encouragements - List encouragements for a thread
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const encouragements = await prisma.post.findMany({
      where: { threadId: id },
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            handle: true,
            profileImageUrl: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(encouragements);
  } catch (error) {
    console.error("Error fetching encouragements:", error);
    return NextResponse.json(
      { error: "Failed to fetch encouragements" },
      { status: 500 }
    );
  }
}

// POST /api/threads/[id]/encouragements - Create a new encouragement
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
    const validatedData = createEncouragementSchema.parse(body);

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

    // Check if thread exists
    const thread = await prisma.thread.findUnique({
      where: { id },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    // Check if thread is open
    if (thread.status !== "open") {
      return NextResponse.json(
        { error: "Cannot add encouragement to closed thread" },
        { status: 400 }
      );
    }

    // Prevent thread author from posting encouragements on their own thread
    if (thread.authorId === user.id) {
      return NextResponse.json(
        { error: "Thread authors cannot post encouragements on their own prayer requests" },
        { status: 400 }
      );
    }

    const encouragement = await prisma.post.create({
      data: {
        content: validatedData.body,
        threadId: id,
        authorId: user.id,
        kind: "encouragement",
      },
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            handle: true,
            profileImageUrl: true,
          },
        },
      },
    });

    // TODO: Create notification for thread author (notification model not implemented yet)
    // if (thread.authorId !== user.id) {
    //   await prisma.notification.create({
    //     data: {
    //       userId: thread.authorId,
    //       kind: "new_encouragement",
    //       payload: {
    //         threadId: thread.id,
    //         threadTitle: thread.title,
    //         encouragementId: encouragement.id,
    //         authorName: user.displayName || "Someone",
    //       },
    //     },
    //   });
    // }

    return NextResponse.json(encouragement, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating encouragement:", error);
    return NextResponse.json(
      { error: "Failed to create encouragement" },
      { status: 500 }
    );
  }
}