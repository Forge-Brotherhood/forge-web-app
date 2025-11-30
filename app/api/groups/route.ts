import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createGroupSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  groupType: z.enum(["circle", "core"]).default("circle"),
});

// GET /api/groups - Get user's groups
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
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const groups = await prisma.group.findMany({
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
        prayerRequests: {
          where: {
            deletedAt: null,
            status: "open",
          },
          select: {
            id: true,
            status: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
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
      orderBy: {
        createdAt: "asc",
      },
    });

    return NextResponse.json(groups);
  } catch (error) {
    console.error("Error fetching groups:", error);
    return NextResponse.json(
      { error: "Failed to fetch groups" },
      { status: 500 }
    );
  }
}

// POST /api/groups - Create a new group
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
    const validatedData = createGroupSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Create group with creator as leader
    const group = await prisma.$transaction(async (tx) => {
      const newGroup = await tx.group.create({
        data: {
          name: validatedData.name,
          description: validatedData.description,
          groupType: validatedData.groupType,
          shortId: Math.random().toString(36).substring(2, 10),
        },
      });

      // Add creator as leader
      await tx.groupMember.create({
        data: {
          groupId: newGroup.id,
          userId: user.id,
          role: "leader",
          status: "active",
        },
      });

      return newGroup;
    });

    // Return group with member info
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

    return NextResponse.json(fullGroup, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating group:", error);
    return NextResponse.json(
      { error: "Failed to create group" },
      { status: 500 }
    );
  }
}