import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { sendWelcomeNotificationAsync } from "@/lib/notifications";

// POST /api/invites/[token]/accept - Accept an invite and join the group
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const invite = await prisma.groupInvite.findUnique({
      where: { token },
      include: {
        group: {
          include: {
            members: {
              where: {
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
            },
          },
        },
      },
    });

    if (!invite) {
      return NextResponse.json(
        { error: "Invite not found" },
        { status: 404 }
      );
    }

    // Check if invite is expired
    if (new Date() > invite.expiresAt) {
      return NextResponse.json(
        { error: "This invite link has expired" },
        { status: 410 }
      );
    }

    // Check if group was deleted
    if (invite.group.deletedAt) {
      return NextResponse.json(
        { error: "This group no longer exists" },
        { status: 404 }
      );
    }

    // Check if user is already an active member
    const existingActiveMembership = invite.group.members.find(
      (m) => m.userId === user.id
    );

    if (existingActiveMembership) {
      // Already an active member, just return the group
      return NextResponse.json({
        success: true,
        alreadyMember: true,
        group: formatGroupResponse(invite.group),
      });
    }

    // Check for any existing membership (including inactive/left)
    const existingMembership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: invite.group.id,
          userId: user.id,
        },
      },
    });

    if (existingMembership) {
      // Reactivate the membership
      await prisma.groupMember.update({
        where: {
          groupId_userId: {
            groupId: invite.group.id,
            userId: user.id,
          },
        },
        data: {
          status: "active",
          role: "member",
        },
      });
    } else {
      // Create new membership
      await prisma.groupMember.create({
        data: {
          groupId: invite.group.id,
          userId: user.id,
          role: "member",
          status: "active",
        },
      });
    }

    // Fetch updated group with the new member
    const updatedGroup = await prisma.group.findUnique({
      where: { id: invite.group.id },
      include: {
        members: {
          where: {
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
          orderBy: {
            joinedAt: "asc",
          },
        },
        _count: {
          select: {
            prayerRequests: {
              where: {
                deletedAt: null,
              },
            },
          },
        },
      },
    });

    // Send welcome notification to the new member (fire-and-forget)
    if (updatedGroup) {
      sendWelcomeNotificationAsync(user.id, {
        groupId: updatedGroup.id,
        groupName: updatedGroup.name || "Your Group",
      });
    }

    return NextResponse.json({
      success: true,
      alreadyMember: false,
      group: updatedGroup,
    });
  } catch (error) {
    console.error("Error accepting invite:", error);
    return NextResponse.json(
      { error: "Failed to join group" },
      { status: 500 }
    );
  }
}

function formatGroupResponse(group: {
  id: string;
  shortId: string;
  name: string | null;
  description: string | null;
  groupType: string;
  members: Array<{
    userId: string;
    role: string;
    joinedAt: Date;
    user: {
      id: string;
      displayName: string | null;
      firstName: string | null;
      profileImageUrl: string | null;
    };
  }>;
}) {
  return {
    id: group.id,
    shortId: group.shortId,
    name: group.name,
    description: group.description,
    groupType: group.groupType,
    members: group.members,
  };
}
