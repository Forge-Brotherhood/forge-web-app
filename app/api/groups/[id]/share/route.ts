import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { nanoid } from "nanoid";

const createShareLinkSchema = z.object({
  expiresInDays: z.number().min(1).max(30).optional().default(7),
});

// POST /api/groups/[id]/share - Create a share link for a group
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const validatedData = createShareLinkSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Resolve id or shortId
    const group = await prisma.group.findFirst({
      where: {
        OR: [{ id }, { shortId: id }],
        deletedAt: null,
      },
      include: {
        members: {
          where: {
            userId: user.id,
            status: "active",
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
    const membership = group.members[0];
    if (!membership) {
      return NextResponse.json(
        { error: "You must be a member of this group to share it" },
        { status: 403 }
      );
    }

    // Generate token and expiration
    const token = nanoid(16);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validatedData.expiresInDays);

    // Create the invite
    const invite = await prisma.groupInvite.create({
      data: {
        token,
        groupId: group.id,
        createdBy: user.id,
        expiresAt,
      },
    });

    const url = `https://app.forge-app.io/join/${token}`;

    return NextResponse.json({
      url,
      token: invite.token,
      expiresAt: invite.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating share link:", error);
    return NextResponse.json(
      { error: "Failed to create share link" },
      { status: 500 }
    );
  }
}
