import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const joinGroupSchema = z.object({
  code: z.string().min(1).max(20),
});

// POST /api/groups/join - Join a group by invite code (shortId)
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = joinGroupSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Find group by shortId (invite code)
    const group = await prisma.group.findFirst({
      where: {
        shortId: validatedData.code,
        deletedAt: null,
      },
    });

    if (!group) {
      return NextResponse.json(
        { error: "Group not found. Please check the invite code." },
        { status: 404 }
      );
    }

    // Check if user is already a member
    const existingMembership = await prisma.groupMember.findFirst({
      where: {
        groupId: group.id,
        userId: user.id,
      },
    });

    if (existingMembership) {
      if (existingMembership.status === "active") {
        return NextResponse.json(
          { error: "You are already a member of this group" },
          { status: 400 }
        );
      }
      // Reactivate membership if previously left
      await prisma.groupMember.update({
        where: {
          groupId_userId: {
            groupId: group.id,
            userId: user.id,
          },
        },
        data: { status: "active" },
      });
    } else {
      // Add user as member
      await prisma.groupMember.create({
        data: {
          groupId: group.id,
          userId: user.id,
          role: "member",
          status: "active",
        },
      });
    }

    // Return the full group with members
    const fullGroup = await prisma.group.findUnique({
      where: { id: group.id },
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

    return NextResponse.json(fullGroup, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error joining group:", error);
    return NextResponse.json(
      { error: "Failed to join group" },
      { status: 500 }
    );
  }
}
