import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// GET /api/groups/members - Get group members
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
    // Back-compat mapping (older clients used core/circle)
    const groupTypeParam = searchParams.get("type");
    const groupType =
      groupTypeParam === "core"
        ? "in_person"
        : groupTypeParam === "circle"
          ? "virtual"
          : null;

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

    // First get the group IDs the user belongs to
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

    // Get members for each group
    const groupsWithMembers = await Promise.all(
      userGroups.map(async (group) => {
        const members = await prisma.groupMember.findMany({
          where: {
            groupId: group.id,
            status: "active",
          },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                firstName: true,
                profileImageUrl: true,
              },
            },
          },
          orderBy: [
            // Prefer explicit joinedAt ordering; fallback to createdAt for older rows
            { joinedAt: "asc" },
          ],
        });

        return {
          ...group,
          members: members.map(member => ({
            id: `${member.groupId}:${member.userId}`,
            userId: member.user.id,
            displayName: member.user.displayName,
            firstName: member.user.firstName,
            profileImageUrl: member.user.profileImageUrl,
            role: member.role,
            joinedAt: member.joinedAt?.toISOString?.() || (member as any).createdAt?.toISOString?.() || new Date().toISOString(),
            user: member.user,
            prayerStreak: 0, // TODO: Calculate actual prayer streak
          })),
        };
      })
    );

    return NextResponse.json(groupsWithMembers);
  } catch (error) {
    console.error("Error fetching group members:", error);
    return NextResponse.json(
      { error: "Failed to fetch group members" },
      { status: 500 }
    );
  }
}