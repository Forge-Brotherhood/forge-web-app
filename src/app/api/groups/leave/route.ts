import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const leaveGroupSchema = z.object({
  groupId: z.string().min(1),
});

// POST /api/groups/leave - Leave a group
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = leaveGroupSchema.parse(body);

    // Resolve id or shortId
    const group = await prisma.group.findFirst({
      where: {
        OR: [{ id: validatedData.groupId }, { shortId: validatedData.groupId }],
        deletedAt: null,
      },
      include: {
        members: {
          where: {
            status: "active",
          },
          orderBy: {
            joinedAt: "asc",
          },
        },
      },
    });

    if (!group) {
      return NextResponse.json(
        { error: "Group not found" },
        { status: 404 }
      );
    }

    // Check if user is a member
    const membership = group.members.find((m) => m.userId === authResult.userId);
    if (!membership) {
      return NextResponse.json(
        { error: "You are not a member of this group" },
        { status: 400 }
      );
    }

    // Check if user is the only leader
    const leaders = group.members.filter((m) => m.role === "leader");
    if (leaders.length === 1 && leaders[0].userId === authResult.userId) {
      // Check if there are other members
      const otherMembers = group.members.filter((m) => m.userId !== authResult.userId);
      if (otherMembers.length > 0) {
        return NextResponse.json(
          { error: "You must assign another leader before leaving, or delete the group" },
          { status: 400 }
        );
      }
    }

    // Update membership status to "left"
    await prisma.groupMember.update({
      where: {
        groupId_userId: {
          groupId: group.id,
          userId: authResult.userId,
        },
      },
      data: {
        status: "left",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error leaving group:", error);
    return NextResponse.json(
      { error: "Failed to leave group" },
      { status: 500 }
    );
  }
}
