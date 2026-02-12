import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
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
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { threadId, entryId } = toggleSchema.parse(body);

    // Resolve app user
    const user = await prisma.user.findUnique({ where: { id: authResult.userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Resolve request by id or shortId
    const requestRecord = await prisma.prayerRequest.findFirst({
      where: {
        OR: [{ id: threadId }, { shortId: threadId }],
        deletedAt: null,
      },
    });

    if (!requestRecord) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Access control: user must be author or thread must be shared to community
    if (requestRecord.authorId !== user.id && !requestRecord.sharedToCommunity) {
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


