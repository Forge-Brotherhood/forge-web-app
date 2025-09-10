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
      prisma.thread.findMany({
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
          posts: {
            where: {
              kind: filter === "testimonies" ? "testimony" : "request",
            },
            orderBy: {
              createdAt: filter === "testimonies" ? "desc" : "asc",
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
              reactions: {
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
          prayerListItems: currentUser ? {
            where: {
              userId: currentUser.id,
            },
            select: {
              id: true,
              postId: true,
            },
            take: 1, // We only need to know if it exists
          } : undefined,
          // Include prayer actions for current user
          prayers: currentUser ? {
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
              posts: true,
              prayers: true,
              prayerListItems: true,
            },
          },
        },
        orderBy: [
          // Prioritize testimonies (answered prayers) at the top
          ...(filter === "all" ? [{ status: "asc" as const }] : []),
          { updatedAt: "desc" as const },
        ],
        take: limit,
        skip: offset,
      }),
      prisma.thread.count({ where: whereClause }),
    ]);

    // Sanitize anonymous threads and add prayer list status
    const sanitizedThreads = threads.map(thread => ({
      ...thread,
      author: thread.isAnonymous ? null : thread.author,
      posts: thread.posts.map(post => ({
        ...post,
        author: thread.isAnonymous ? null : post.author,
      })),
      isInPrayerList: thread.prayerListItems ? thread.prayerListItems.length > 0 : false,
      hasPrayed: thread.prayers ? thread.prayers.length > 0 : false,
      prayerListCount: thread._count.prayerListItems,
      // Remove raw data from response
      prayerListItems: undefined,
      prayers: undefined,
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