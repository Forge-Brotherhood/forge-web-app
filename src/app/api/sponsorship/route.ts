import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSponsorshipSchema = z.object({
  amount: z.number().min(1).max(10000),
  active: z.boolean().default(true),
});

// GET /api/sponsorship - Get user's sponsorship info
export async function GET(request: NextRequest) {
  try {
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

    // Sponsorships model doesn't exist yet
    const sponsorships: any[] = [];
    const totalAmount = 0;

    return NextResponse.json({
      isSponsor: user.isSponsor,
      sponsorships: sponsorships,
      totalAmount,
    });
  } catch (error) {
    console.error("Error fetching sponsorship:", error);
    return NextResponse.json(
      { error: "Failed to fetch sponsorship" },
      { status: 500 }
    );
  }
}

// POST /api/sponsorship - Create or update sponsorship
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
    const validatedData = createSponsorshipSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Sponsorship model doesn't exist yet - just update user status
    const result = await prisma.user.update({
      where: { id: user.id },
      data: {
        isSponsor: true,
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating sponsorship:", error);
    return NextResponse.json(
      { error: "Failed to create sponsorship" },
      { status: 500 }
    );
  }
}

// PATCH /api/sponsorship - Update sponsorship status
// Commented out - sponsorship model doesn't exist yet
/*
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const sponsorshipId = searchParams.get("id");

    if (!sponsorshipId) {
      return NextResponse.json(
        { error: "Sponsorship ID required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { active } = body;

    if (typeof active !== "boolean") {
      return NextResponse.json(
        { error: "Active status required" },
        { status: 400 }
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

    // Verify sponsorship belongs to user
    const sponsorship = await prisma.sponsorship.findUnique({
      where: { id: sponsorshipId },
    });

    if (!sponsorship || sponsorship.userId !== user.id) {
      return NextResponse.json(
        { error: "Sponsorship not found" },
        { status: 404 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedSponsorship = await tx.sponsorship.update({
        where: { id: sponsorshipId },
        data: { active },
      });

      // Check if user has any active sponsorships
      const activeSponsorships = await tx.sponsorship.count({
        where: {
          userId: user.id,
          active: true,
        },
      });

      // Update user sponsor status
      await tx.user.update({
        where: { id: user.id },
        data: {
          isSponsor: activeSponsorships > 0,
        },
      });

      return updatedSponsorship;
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error updating sponsorship:", error);
    return NextResponse.json(
      { error: "Failed to update sponsorship" },
      { status: 500 }
    );
  }
}
*/