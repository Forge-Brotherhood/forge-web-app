import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import crypto from "crypto";

// Helper to get or create guest session
async function getOrCreateGuestSession(request: NextRequest) {
  const cookieStore = await cookies();
  let deviceHash = cookieStore.get("device_id")?.value;
  
  if (!deviceHash) {
    // Generate a new device ID
    deviceHash = crypto.randomBytes(32).toString("hex");
    cookieStore.set("device_id", deviceHash, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  }

  // Find or create guest session
  let guestSession = await prisma.guestSession.findFirst({
    where: { deviceHash },
  });

  if (!guestSession) {
    guestSession = await prisma.guestSession.create({
      data: { deviceHash },
    });
  }

  return guestSession;
}

// GET /api/threads/[id]/prayers - Check if current user has prayed
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    
    let hasPrayed = false;
    let prayerCount = 0;

    // Get total prayer count
    prayerCount = await prisma.prayer.count({
      where: { threadId: id },
    });

    if (userId) {
      // Check if authenticated user has prayed
      const user = await prisma.user.findUnique({
        where: { clerkId: userId },
      });

      if (user) {
        const userPrayer = await prisma.prayer.findFirst({
          where: {
            threadId: id,
            userId: user.id,
          },
        });
        hasPrayed = !!userPrayer;
      }
    } else {
      // Check if guest has prayed
      const guestSession = await getOrCreateGuestSession(request);
      const guestPrayer = await prisma.prayer.findFirst({
        where: {
          threadId: id,
          guestSessionId: guestSession.id,
        },
      });
      hasPrayed = !!guestPrayer;
    }

    return NextResponse.json({ hasPrayed, prayerCount });
  } catch (error) {
    console.error("Error checking prayer status:", error);
    return NextResponse.json(
      { error: "Failed to check prayer status" },
      { status: 500 }
    );
  }
}

// POST /api/threads/[id]/prayers - Add a prayer to the thread
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();

    // Check if thread exists
    const thread = await prisma.prayerThread.findUnique({
      where: { id },
    });

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    // Check if thread is open
    if (thread.status !== "open") {
      return NextResponse.json(
        { error: "Cannot pray for closed thread" },
        { status: 400 }
      );
    }

    if (userId) {
      // Authenticated user
      const user = await prisma.user.findUnique({
        where: { clerkId: userId },
      });

      if (!user) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 404 }
        );
      }

      // Prevent thread author from praying for their own request
      if (thread.authorId === user.id) {
        return NextResponse.json(
          { error: "You cannot pray for your own prayer request" },
          { status: 400 }
        );
      }

      // Check if user already prayed today
      const existingPrayer = await prisma.prayer.findFirst({
        where: {
          threadId: id,
          userId: user.id,
        },
      });

      if (existingPrayer) {
        return NextResponse.json(
          { error: "You have already prayed for this request" },
          { status: 400 }
        );
      }

      await prisma.prayer.create({
        data: {
          threadId: id,
          userId: user.id,
        },
      });
    } else {
      // Guest user
      const guestSession = await getOrCreateGuestSession(request);

      // Check if guest already prayed
      const existingPrayer = await prisma.prayer.findFirst({
        where: {
          threadId: id,
          guestSessionId: guestSession.id,
        },
      });

      if (existingPrayer) {
        return NextResponse.json(
          { error: "You have already prayed for this request" },
          { status: 400 }
        );
      }

      await prisma.prayer.create({
        data: {
          threadId: id,
          guestSessionId: guestSession.id,
        },
      });
    }

    // Get updated prayer count
    const prayerCount = await prisma.prayer.count({
      where: { threadId: id },
    });

    return NextResponse.json(
      { 
        message: "Prayer recorded successfully",
        prayerCount,
        hasPrayed: true 
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error recording prayer:", error);
    return NextResponse.json(
      { error: "Failed to record prayer" },
      { status: 500 }
    );
  }
}

// DELETE /api/threads/[id]/prayers - Remove prayer from thread
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();

    if (userId) {
      // Authenticated user
      const user = await prisma.user.findUnique({
        where: { clerkId: userId },
      });

      if (!user) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 404 }
        );
      }

      await prisma.prayer.deleteMany({
        where: {
          threadId: id,
          userId: user.id,
        },
      });
    } else {
      // Guest user
      const guestSession = await getOrCreateGuestSession(request);

      await prisma.prayer.deleteMany({
        where: {
          threadId: id,
          guestSessionId: guestSession.id,
        },
      });
    }

    // Get updated prayer count
    const prayerCount = await prisma.prayer.count({
      where: { threadId: id },
    });

    return NextResponse.json({
      message: "Prayer removed successfully",
      prayerCount,
      hasPrayed: false,
    });
  } catch (error) {
    console.error("Error removing prayer:", error);
    return NextResponse.json(
      { error: "Failed to remove prayer" },
      { status: 500 }
    );
  }
}