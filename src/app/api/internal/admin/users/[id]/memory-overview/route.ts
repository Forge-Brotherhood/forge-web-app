/**
 * GET /api/internal/admin/users/[id]/memory-overview
 *
 * Internal API for getting a comprehensive view of a user's memory system.
 * Returns all memories, active signals, and summary statistics.
 * Called by forge-admin-app. Protected by INTERNAL_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
// GET Handler - User Memory Overview
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await params;

  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const now = new Date();

    // Get all memories for the user
    const memories = await prisma.userMemory.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
    });

    // Get all active signals for the user
    const signals = await prisma.userSignal.findMany({
      where: {
        userId,
        expiresAt: { gte: now },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get expired signals count
    const expiredSignalsCount = await prisma.userSignal.count({
      where: {
        userId,
        expiresAt: { lt: now },
      },
    });

    // Calculate memory stats by type
    const memoryStats = memories.reduce((acc, memory) => {
      const type = memory.memoryType;
      if (!acc[type]) {
        acc[type] = {
          count: 0,
          avgStrength: 0,
          totalOccurrences: 0,
          activeCount: 0,
        };
      }
      acc[type].count++;
      acc[type].avgStrength += memory.strength;
      acc[type].totalOccurrences += memory.occurrences;
      if (memory.isActive) acc[type].activeCount++;
      return acc;
    }, {} as Record<string, { count: number; avgStrength: number; totalOccurrences: number; activeCount: number }>);

    // Finalize averages
    for (const type of Object.keys(memoryStats)) {
      memoryStats[type].avgStrength = memoryStats[type].avgStrength / memoryStats[type].count;
    }

    // Calculate signal stats by type
    const signalStats = signals.reduce((acc, signal) => {
      const type = signal.signalType;
      if (!acc[type]) {
        acc[type] = {
          count: 0,
          avgObservations: 0,
          nearPromotion: 0, // count >= 2 (promotion threshold)
        };
      }
      acc[type].count++;
      acc[type].avgObservations += signal.count;
      if (signal.count >= 2) acc[type].nearPromotion++;
      return acc;
    }, {} as Record<string, { count: number; avgObservations: number; nearPromotion: number }>);

    // Finalize averages
    for (const type of Object.keys(signalStats)) {
      signalStats[type].avgObservations = signalStats[type].avgObservations / signalStats[type].count;
    }

    // Transform memories
    const transformedMemories = memories.map((memory) => ({
      id: memory.id,
      memoryType: memory.memoryType,
      value: memory.value,
      strength: memory.strength,
      occurrences: memory.occurrences,
      source: memory.source,
      isActive: memory.isActive,
      firstSeenAt: memory.firstSeenAt.toISOString(),
      lastSeenAt: memory.lastSeenAt.toISOString(),
      decayedAt: memory.decayedAt?.toISOString() || null,
      createdAt: memory.createdAt.toISOString(),
    }));

    // Transform signals with time remaining
    const transformedSignals = signals.map((signal) => {
      const expiresAt = new Date(signal.expiresAt);
      const hoursRemaining = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)));

      return {
        id: signal.id,
        signalType: signal.signalType,
        value: signal.value,
        count: signal.count,
        expiresAt: signal.expiresAt.toISOString(),
        hoursRemaining,
        willPromoteAt: signal.count >= 2 ? "next_observation" : `${2 - signal.count} more observations`,
        createdAt: signal.createdAt.toISOString(),
        updatedAt: signal.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt.toISOString(),
      },
      summary: {
        totalMemories: memories.length,
        activeMemories: memories.filter((m) => m.isActive).length,
        inactiveMemories: memories.filter((m) => !m.isActive).length,
        totalSignals: signals.length,
        expiredSignals: expiredSignalsCount,
        signalsNearPromotion: signals.filter((s) => s.count >= 2).length,
      },
      memoryStats,
      signalStats,
      memories: transformedMemories,
      signals: transformedSignals,
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error fetching user memory overview:", error);
    return NextResponse.json(
      { error: "Failed to fetch memory overview" },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE Handler - Clear All User Memory Data
// =============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await params;

  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
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

    // Delete all memories and signals in a transaction
    const [memoriesDeleted, signalsDeleted] = await prisma.$transaction([
      prisma.userMemory.deleteMany({ where: { userId } }),
      prisma.userSignal.deleteMany({ where: { userId } }),
    ]);

    console.log(
      `[INTERNAL-API] Cleared memory data for user ${user.email}: ` +
      `${memoriesDeleted.count} memories, ${signalsDeleted.count} signals`
    );

    return NextResponse.json({
      success: true,
      userId,
      deleted: {
        memories: memoriesDeleted.count,
        signals: signalsDeleted.count,
      },
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error clearing user memory data:", error);
    return NextResponse.json(
      { error: "Failed to clear memory data" },
      { status: 500 }
    );
  }
}
