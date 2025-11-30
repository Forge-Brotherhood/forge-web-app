import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// GET /api/invites/[token] - Get invite details
export async function GET(
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
            },
          },
        },
        creator: {
          select: {
            displayName: true,
            firstName: true,
            profileImageUrl: true,
          },
        },
      },
    });

    if (!invite) {
      return NextResponse.json({
        valid: false,
        expired: false,
        error: "Invite not found",
      });
    }

    // Check if invite is expired
    const isExpired = new Date() > invite.expiresAt;
    if (isExpired) {
      return NextResponse.json({
        valid: false,
        expired: true,
        error: "This invite link has expired",
      });
    }

    // Check if group was deleted
    if (invite.group.deletedAt) {
      return NextResponse.json({
        valid: false,
        expired: false,
        error: "This group no longer exists",
      });
    }

    // Check if user is already a member
    const isAlreadyMember = invite.group.members.some(
      (m) => m.userId === user.id
    );

    return NextResponse.json({
      valid: true,
      expired: false,
      alreadyMember: isAlreadyMember,
      group: {
        id: invite.group.id,
        name: invite.group.name,
        description: invite.group.description,
        memberCount: invite.group.members.length,
        groupType: invite.group.groupType,
      },
      inviter: {
        displayName: invite.creator.displayName ?? invite.creator.firstName,
        profileImageUrl: invite.creator.profileImageUrl,
      },
    });
  } catch (error) {
    console.error("Error fetching invite:", error);
    return NextResponse.json(
      { error: "Failed to fetch invite details" },
      { status: 500 }
    );
  }
}
