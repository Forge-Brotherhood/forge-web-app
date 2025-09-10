import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// GET /api/groups/stats - Get group statistics
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
    const groupType = searchParams.get("type") as "core" | "circle" | null;

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Get user's groups
    const userGroups = await prisma.group.findMany({
      where: {
        deletedAt: null,
        members: {
          some: {
            userId: user.id,
            status: "active",
          },
        },
        ...(groupType && { groupType }),
      },
      select: {
        id: true,
        name: true,
        groupType: true,
      },
    });

    if (userGroups.length === 0) {
      return NextResponse.json([]);
    }

    // Calculate stats for each group
    const groupsWithStats = await Promise.all(
      userGroups.map(async (group) => {
        // Get member count
        const memberCount = await prisma.groupMember.count({
          where: {
            groupId: group.id,
            status: "active",
          },
        });

        // Get thread count for context (lightweight)
        const threadCount = await prisma.thread.count({
          where: {
            groupId: group.id,
            deletedAt: null,
          },
        });

        // TODO: Implement actual prayer statistics
        // For now, return placeholder stats
        const stats = {
          memberCount,
          threadCount,
          weeklyPrayers: 0,
          activeToday: 0,
          averageStreak: 0,
          groupStreak: 0,
          challengeProgress: null,
        };

        return {
          ...group,
          stats,
        };
      })
    );

    return NextResponse.json(groupsWithStats);
  } catch (error) {
    console.error("Error fetching group stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch group stats" },
      { status: 500 }
    );
  }
}