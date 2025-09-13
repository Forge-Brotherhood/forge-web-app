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
    const source = searchParams.get("source") || "all"; // all | core | circle | community

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      include: {
        memberships: {
          include: {
            group: true,
          },
        },
      },
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

    if (source === "core") {
      const coreGroup = user.memberships.find(m => m.group.groupType === "core");
      if (!coreGroup) {
        return NextResponse.json({ threads: [], stats: { totalInCart: 0, prayedToday: 0 } });
      }
      whereClause.groupId = coreGroup.groupId;
    } else if (source === "circle") {
      const circleGroupIds = user.memberships
        .filter(m => m.group.groupType === "circle")
        .map(m => m.groupId);
      whereClause.groupId = { in: circleGroupIds };
    } else if (source === "community") {
      whereClause.sharedToCommunity = true;
    } else {
      // All: core + circle + community threads
      const allGroupIds = user.memberships.map(m => m.groupId);
      whereClause = {
        ...whereClause,
        OR: [
          { groupId: { in: allGroupIds } },
          { sharedToCommunity: true },
        ],
      };
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
        group: {
          select: {
            id: true,
            name: true,
            groupType: true,
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