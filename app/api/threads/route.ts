import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createThreadSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1),
  tags: z.array(z.string()).optional().default([]),
  isAnonymous: z.boolean().optional().default(false),
});

// GET /api/threads - List all threads
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "open";
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");

    const threads = await prisma.prayerThread.findMany({
      where: {
        status: status as any,
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
        _count: {
          select: {
            prayers: true,
            encouragements: true,
            updates: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
      skip: offset,
    });

    // Hide author info for anonymous threads
    const sanitizedThreads = threads.map(thread => ({
      ...thread,
      author: thread.isAnonymous ? null : thread.author,
    }));

    return NextResponse.json(sanitizedThreads);
  } catch (error) {
    console.error("Error fetching threads:", error);
    return NextResponse.json(
      { error: "Failed to fetch threads" },
      { status: 500 }
    );
  }
}

// POST /api/threads - Create a new thread
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
    const validatedData = createThreadSchema.parse(body);

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

    // Calculate expiration date (7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const thread = await prisma.prayerThread.create({
      data: {
        title: validatedData.title,
        body: validatedData.body,
        tags: validatedData.tags,
        isAnonymous: validatedData.isAnonymous,
        expiresAt,
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
      ...thread,
      author: thread.isAnonymous ? null : thread.author,
    };

    return NextResponse.json(sanitizedThread, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating thread:", error);
    return NextResponse.json(
      { error: "Failed to create thread" },
      { status: 500 }
    );
  }
}