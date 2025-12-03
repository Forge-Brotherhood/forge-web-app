import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPushNotification } from "@/lib/fcm";

/**
 * POST /api/push/test
 * Send a test push notification to all of the authenticated user's devices.
 * Only available in development environment.
 */
export async function POST() {
  try {
    // Only allow in development
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Test endpoint not available in production" },
        { status: 403 }
      );
    }

    const { userId: clerkId } = await auth();

    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the user and their active push tokens
    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        displayName: true,
        firstName: true,
        pushTokens: {
          where: { isActive: true },
          select: { token: true },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const tokens = user.pushTokens.map((t) => t.token);

    if (tokens.length === 0) {
      return NextResponse.json(
        { error: "No active push tokens found" },
        { status: 400 }
      );
    }

    // Send test notification
    const result = await sendPushNotification(tokens, {
      title: "Test Notification",
      body: `Hello ${user.displayName || user.firstName || "there"}! This is a test push notification.`,
      data: {
        type: "test",
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      sent: result.successCount,
      failed: result.failedTokens.length,
    });
  } catch (error) {
    console.error("Error sending test push:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
