import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// GET /api/community - Get community feed
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get("filter") || "all"; // all | testimonies | requests
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Get current user if authenticated
    let currentUser = null;
    if (userId) {
      currentUser = await prisma.user.findUnique({
        where: { clerkId: userId },
      });
    }

    let whereClause: any = {
      sharedToCommunity: true,
      deletedAt: null,
    };

    // Apply filters
    if (filter === "testimonies") {
      whereClause.status = "answered";
    } else if (filter === "requests") {
      whereClause.status = "open";
    }

    // Get threads shared to community
    const [threads, totalCount] = await Promise.all([
      prisma.prayerRequest.findMany({
        where: whereClause,
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
              kind: filter === "testimonies" ? "testimony" : "request",
            },
            orderBy: {
              createdAt: filter === "testimonies" ? "desc" : "asc",
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
              responses: {
                take: 10,
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
            },
          },
          // Include prayer list items for current user
          savedBy: currentUser ? {
            where: {
              userId: currentUser.id,
            },
            select: {
              id: true,
              entryId: true,
            },
            take: 1, // We only need to know if it exists
          } : undefined,
          // Include prayer actions for current user
          actions: currentUser ? {
            where: {
              userId: currentUser.id,
            },
            select: {
              id: true,
            },
            take: 1, // We only need to know if it exists
          } : undefined,
          _count: {
            select: {
              entries: true,
              actions: true,
              savedBy: true,
            },
          },
        },
        orderBy: [
          // Prioritize testimonies (answered prayers) at the top
          ...(filter === "all" ? [{ status: "asc" as const }] : []),
          { lastActivityAt: "desc" as const },
        ],
        take: limit,
        skip: offset,
      }),
      prisma.prayerRequest.count({ where: whereClause }),
    ]);

    // Sanitize anonymous threads and add prayer list status
    const sanitizedThreads = threads.map(thread => ({
      ...thread,
      author: thread.isAnonymous ? null : thread.author,
    }));

    return NextResponse.json({
      threads: sanitizedThreads,
      totalCount,
      hasMore: offset + limit < totalCount,
    });
  } catch (error) {
    console.error("Error fetching community feed:", error);
    return NextResponse.json(
      { error: "Failed to fetch community feed" },
      { status: 500 }
    );
  }
}