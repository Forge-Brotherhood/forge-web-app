import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// POST /api/threads/[id]/cart - Add thread to prayer cart
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id: threadId } = await params;

    // Get the user from database
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if thread exists
    const thread = await prisma.prayerThread.findUnique({
      where: { id: threadId },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    // Check if already in cart
    const existingCartItem = await prisma.prayerCartItem.findFirst({
      where: {
        threadId,
        userId: user.id,
      },
    });

    if (existingCartItem) {
      return NextResponse.json(
        { error: "Thread already in prayer cart" },
        { status: 409 }
      );
    }

    // Add to cart
    const cartItem = await prisma.prayerCartItem.create({
      data: {
        threadId,
        userId: user.id,
      },
    });

    return NextResponse.json(cartItem, { status: 201 });
  } catch (error) {
    console.error("Error adding to prayer cart:", error);
    return NextResponse.json(
      { error: "Failed to add to prayer cart" },
      { status: 500 }
    );
  }
}

// DELETE /api/threads/[id]/cart - Remove thread from prayer cart
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id: threadId } = await params;

    // Get the user from database
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Remove from cart
    const deletedItem = await prisma.prayerCartItem.deleteMany({
      where: {
        threadId,
        userId: user.id,
      },
    });

    if (deletedItem.count === 0) {
      return NextResponse.json(
        { error: "Thread not found in prayer cart" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing from prayer cart:", error);
    return NextResponse.json(
      { error: "Failed to remove from prayer cart" },
      { status: 500 }
    );
  }
}