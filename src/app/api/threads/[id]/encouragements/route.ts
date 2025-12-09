import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { nanoid } from "nanoid";
import { sendEncouragementNotificationAsync } from "@/lib/notifications";

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
    const encouragements = await prisma.prayerEntry.findMany({
      where: { requestId: id },
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
    const authResult = await getAuth();
    if (!authResult) {
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
      where: { id: authResult.userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if thread exists (include group for notifications)
    const thread = await prisma.prayerRequest.findUnique({
      where: { id },
      include: {
        group: {
          select: {
            id: true,
            name: true,
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

    const encouragement = await prisma.prayerEntry.create({
      data: {
        shortId: nanoid(12),
        content: validatedData.body,
        requestId: id,
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

    // Send push notification to thread author only (fire-and-forget)
    if (thread.groupId && thread.group) {
      sendEncouragementNotificationAsync(thread.authorId, {
        groupId: thread.groupId,
        groupName: thread.group.name || "Your Group",
        threadId: thread.id,
        threadTitle: thread.title || undefined,
        authorName: user.displayName || user.firstName || undefined,
        authorProfileImageUrl: user.profileImageUrl || undefined,
        entryId: encouragement.id, // Scroll to this specific encouragement
      });
    }

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