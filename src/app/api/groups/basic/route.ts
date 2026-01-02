import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// GET /api/groups/basic - Get basic group info without heavy relations
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

    // Back-compat mapping (older clients used core/circle)
    const groupTypeParam = searchParams.get("type");
    const groupType =
      groupTypeParam === "core"
        ? "in_person"
        : groupTypeParam === "circle"
          ? "virtual"
          : null;

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
      select: {
        id: true,
        name: true,
        groupType: true,
        description: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return NextResponse.json(groups);
  } catch (error) {
    console.error("Error fetching basic group data:", error);
    return NextResponse.json(
      { error: "Failed to fetch groups" },
      { status: 500 }
    );
  }
}