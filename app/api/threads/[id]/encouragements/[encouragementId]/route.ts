import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// DELETE /api/threads/[id]/encouragements/[encouragementId] - Delete an encouragement
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; encouragementId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id, encouragementId } = await params;

    // Get the user
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Find the encouragement
    const encouragement = await prisma.encouragement.findUnique({
      where: { id: encouragementId },
      include: {
        thread: true,
      },
    });

    if (!encouragement) {
      return NextResponse.json(
        { error: "Encouragement not found" },
        { status: 404 }
      );
    }

    // Verify the encouragement belongs to the thread
    if (encouragement.threadId !== id) {
      return NextResponse.json(
        { error: "Encouragement not found in this thread" },
        { status: 404 }
      );
    }

    // Only encouragement author can delete
    if (encouragement.authorId !== user.id) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    // Delete the encouragement
    await prisma.encouragement.delete({
      where: { id: encouragementId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting encouragement:", error);
    return NextResponse.json(
      { error: "Failed to delete encouragement" },
      { status: 500 }
    );
  }
}