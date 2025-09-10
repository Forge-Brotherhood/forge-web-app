import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  handle: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, {
    message: "Handle can only contain letters, numbers, and underscores",
  }).optional(),
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  profileImageUrl: z.string().url().optional().nullable(),
});

export async function GET() {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // First check if user exists with minimal data
    let user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: {
        id: true,
        displayName: true,
        handle: true,
        email: true,
        profileImageUrl: true,
        createdAt: true,
        role: true,
      },
    });

    // Only load memberships if user exists (separate query for better performance)
    let memberships: any[] = [];
    if (user) {
      memberships = await prisma.groupMember.findMany({
        where: { 
          userId: user.id,
          status: "active" 
        },
        select: {
          groupId: true,
          role: true,
          group: {
            select: {
              id: true,
              name: true,
              groupType: true,
            },
          },
        },
      });
    }

    // If user doesn't exist in database, create them
    if (!user) {
      const clerkUser = await currentUser();
      user = await prisma.user.create({
        data: {
          clerkId: userId,
          email: clerkUser?.emailAddresses?.[0]?.emailAddress ?? "",
          displayName: clerkUser?.firstName ?? clerkUser?.username ?? null,
          profileImageUrl: null,
        },
        select: {
          id: true,
          displayName: true,
          handle: true,
          email: true,
          profileImageUrl: true,
          createdAt: true,
          role: true,
        },
      });
      // New users have no memberships yet
      memberships = [];
    }

    return NextResponse.json({
      ...user,
      memberships
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validatedData = updateProfileSchema.parse(body);

    // Check if handle is already taken by another user
    if (validatedData.handle) {
      const existingUser = await prisma.user.findFirst({
        where: {
          handle: validatedData.handle,
          NOT: { clerkId: userId },
        },
      });

      if (existingUser) {
        return NextResponse.json(
          { error: "Handle already taken" },
          { status: 400 }
        );
      }
    }

    const updatedUser = await prisma.user.update({
      where: { clerkId: userId },
      data: validatedData,
      select: {
        id: true,
        displayName: true,
        handle: true,
        email: true,
        profileImageUrl: true,
        createdAt: true,
        role: true,
        memberships: {
          where: { status: "active" },
          select: {
            groupId: true,
            role: true,
            group: {
              select: {
                id: true,
                name: true,
                groupType: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid data", details: error.flatten() },
        { status: 400 }
      );
    }

    console.error("Error updating profile:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
