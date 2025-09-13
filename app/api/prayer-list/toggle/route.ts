import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const toggleSchema = z.object({
  threadId: z.string(),
  entryId: z.string().uuid().optional(),
});

// POST /api/prayer-list/toggle
// Toggles SavedPrayer for the current user and returns the new state
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { threadId, entryId } = toggleSchema.parse(body);

    // Resolve app user
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Resolve request by id or shortId
    const requestRecord = await prisma.prayerRequest.findFirst({
      where: {
        OR: [{ id: threadId }, { shortId: threadId }],
        deletedAt: null,
      },
      include: {
        group: {
          include: {
            members: {
              where: { userId: user.id, status: "active" },
            },
          },
        },
      },
    });

    if (!requestRecord) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Access control: must be member or community-shared
    const isMember = requestRecord.group ? requestRecord.group.members.length > 0 : false;
    if (!isMember && !requestRecord.sharedToCommunity) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // If entryId provided, validate it belongs to the request
    if (entryId) {
      const entry = await prisma.prayerEntry.findFirst({
        where: { id: entryId, requestId: requestRecord.id },
        select: { id: true },
      });
      if (!entry) {
        return NextResponse.json({ error: "Entry not found in this thread" }, { status: 400 });
      }
    }

    // Check existing SavedPrayer
    const existing = await prisma.savedPrayer.findFirst({
      where: {
        userId: user.id,
        requestId: requestRecord.id,
        entryId: entryId || null,
      },
      select: { id: true },
    });

    let isSaved: boolean;
    if (existing) {
      // Remove existing
      await prisma.savedPrayer.delete({ where: { id: existing.id } });
      isSaved = false;
    } else {
      // Create new
      await prisma.savedPrayer.create({
        data: {
          userId: user.id,
          requestId: requestRecord.id,
          entryId: entryId || null,
        },
      });
      isSaved = true;
    }

    // Return new aggregate count for the request
    const savedCount = await prisma.savedPrayer.count({ where: { requestId: requestRecord.id } });

    return NextResponse.json({
      success: true,
      isSaved,
      action: isSaved ? "added" : "removed",
      savedCount,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error toggling prayer list:", error);
    return NextResponse.json({ error: "Failed to toggle prayer list" }, { status: 500 });
  }
}


