import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// GET /api/prayer-cart - Get user's prayer cart (threads to pray for today)
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source") || "all"; // all | mine | community | saved

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Build where clause based on source
    let whereClause: any = {
      status: "open",
      deletedAt: null,
    };

    if (source === "mine") {
      // User's own threads
      whereClause.authorId = user.id;
    } else if (source === "saved") {
      // Get threads from user's prayer list
      const savedPrayers = await prisma.savedPrayer.findMany({
        where: { userId: user.id },
        select: { requestId: true },
      });
      const savedThreadIds = savedPrayers.map(sp => sp.requestId);
      whereClause.id = { in: savedThreadIds };
    } else if (source === "community") {
      // Community threads only
      whereClause.sharedToCommunity = true;
    } else {
      // All: community threads (including user's own)
      whereClause.sharedToCommunity = true;
    }

    // Get threads that haven't been prayed for by this user today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const threads = await prisma.prayerRequest.findMany({
      where: {
        ...whereClause,
        NOT: {
          prayerActions: {
            some: {
              userId: user.id,
              createdAt: {
                gte: today,
              },
            },
          },
        },
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
        entries: {
          where: {
            kind: "request",
          },
          orderBy: {
            createdAt: "asc",
          },
          take: 1,
          include: {
            attachments: true,
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
            actions: true,
            entries: true,
          },
        },
      },
      orderBy: [
        { createdAt: "desc" },
      ],
      take: 50, // Limit to manageable prayer session size
    });

    // Get count of prayers made by user today
    const prayedToday = await prisma.prayerAction.count({
      where: {
        userId: user.id,
        createdAt: {
          gte: today,
        },
      },
    });

    // Sanitize anonymous threads
    const sanitizedThreads = threads.map((thread: any) => ({
      ...thread,
      author: thread.isAnonymous ? null : thread.author,
      entries: thread.entries.map((post: any) => ({
        ...post,
        author: thread.isAnonymous ? null : post.author,
      })),
    }));

    const stats = {
      totalInCart: threads.length,
      prayedToday,
      currentStreak: user.prayerStreak,
      lastPrayerAt: user.lastPrayerAt,
    };

    return NextResponse.json({
      threads: sanitizedThreads,
      stats,
    });
  } catch (error) {
    console.error("Error fetching prayer cart:", error);
    return NextResponse.json(
      { error: "Failed to fetch prayer cart" },
      { status: 500 }
    );
  }
}