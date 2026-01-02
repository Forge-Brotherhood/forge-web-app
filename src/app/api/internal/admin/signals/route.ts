/**
 * GET /api/internal/admin/signals
 *
 * Internal API for listing user signals (UserSignal records).
 * Signals are short-lived observations that may promote to memories.
 * Called by forge-admin-app. Protected by INTERNAL_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// =============================================================================
// Internal API Key Validation
// =============================================================================

function validateInternalApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get("x-internal-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.error("[INTERNAL-API] INTERNAL_API_KEY not configured");
    return false;
  }

  return apiKey === expectedKey;
}

// =============================================================================
// DELETE Handler - Bulk Delete Signals by User
// =============================================================================

export async function DELETE(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required for bulk delete" },
        { status: 400 }
      );
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Count signals before deletion
    const count = await prisma.userSignal.count({
      where: { userId },
    });

    // Delete all signals for this user
    await prisma.userSignal.deleteMany({
      where: { userId },
    });

    console.log(`[INTERNAL-API] Deleted ${count} signals for user ${user.email}`);

    return NextResponse.json({
      success: true,
      deletedCount: count,
      userId,
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error bulk deleting signals:", error);
    return NextResponse.json(
      { error: "Failed to delete signals" },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST Handler - Cleanup Expired Signals
// =============================================================================

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const action = body.action;

    if (action === "cleanup_expired") {
      // Delete all expired signals
      const result = await prisma.userSignal.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });

      console.log(`[INTERNAL-API] Cleaned up ${result.count} expired signals`);

      return NextResponse.json({
        success: true,
        action: "cleanup_expired",
        deletedCount: result.count,
      });
    }

    return NextResponse.json(
      { error: "Unknown action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[INTERNAL-API] Error processing signal action:", error);
    return NextResponse.json(
      { error: "Failed to process action" },
      { status: 500 }
    );
  }
}

// =============================================================================
// GET Handler - List Signals
// =============================================================================

export async function GET(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);

    // Parse query params
    const userId = searchParams.get("userId") || "";
    const signalType = searchParams.get("signalType") || "";
    const includeExpired = searchParams.get("includeExpired") === "true";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

    // Build where clause
    const where: Prisma.UserSignalWhereInput = {};

    // User filter
    if (userId) {
      where.userId = userId;
    }

    // Signal type filter
    if (signalType && signalType !== "all") {
      where.signalType = signalType;
    }

    // Expired filter (default: exclude expired)
    if (!includeExpired) {
      where.expiresAt = { gte: new Date() };
    }

    // Get total count
    const total = await prisma.userSignal.count({ where });

    // Get signals with user info
    const signals = await prisma.userSignal.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Calculate time remaining for each signal
    const now = new Date();
    const transformedSignals = signals.map((signal) => {
      const expiresAt = new Date(signal.expiresAt);
      const isExpired = expiresAt < now;
      const hoursRemaining = isExpired
        ? 0
        : Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)));

      return {
        id: signal.id,
        userId: signal.userId,
        userEmail: signal.user.email,
        userDisplayName: signal.user.displayName,
        signalType: signal.signalType,
        value: signal.value,
        count: signal.count,
        expiresAt: signal.expiresAt.toISOString(),
        isExpired,
        hoursRemaining,
        createdAt: signal.createdAt.toISOString(),
        updatedAt: signal.updatedAt.toISOString(),
      };
    });

    // Get summary stats
    const stats = await prisma.userSignal.groupBy({
      by: ["signalType"],
      where: userId ? { userId } : undefined,
      _count: { id: true },
      _avg: { count: true },
    });

    return NextResponse.json({
      success: true,
      signals: transformedSignals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: stats.map((s) => ({
        signalType: s.signalType,
        totalSignals: s._count.id,
        avgCount: s._avg.count,
      })),
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error listing signals:", error);
    return NextResponse.json(
      { error: "Failed to list signals" },
      { status: 500 }
    );
  }
}
