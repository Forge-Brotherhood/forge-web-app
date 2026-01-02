/**
 * GET /api/internal/admin/memories
 *
 * Internal API for listing user memories (UserMemory records).
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
// DELETE Handler - Bulk Delete Memories by User
// =============================================================================

export async function DELETE(request: NextRequest) {
  // 1. Validate internal API key
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

    // Count memories before deletion
    const count = await prisma.userMemory.count({
      where: { userId },
    });

    // Delete all memories for this user
    await prisma.userMemory.deleteMany({
      where: { userId },
    });

    // Also delete any signals
    await prisma.userSignal.deleteMany({
      where: { userId },
    });

    console.log(`[INTERNAL-API] Deleted ${count} memories for user ${user.email}`);

    return NextResponse.json({
      success: true,
      deletedCount: count,
      userId,
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error bulk deleting memories:", error);
    return NextResponse.json(
      { error: "Failed to delete memories" },
      { status: 500 }
    );
  }
}

// =============================================================================
// GET Handler - List Memories
// =============================================================================

export async function GET(request: NextRequest) {
  // Validate internal API key
  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);

    // Parse query params
    const search = searchParams.get("search") || "";
    const userId = searchParams.get("userId") || "";
    const memoryType = searchParams.get("memoryType") || "";
    const isActive = searchParams.get("isActive");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

    // Build where clause
    const where: Prisma.UserMemoryWhereInput = {};

    // User filter
    if (userId) {
      where.userId = userId;
    }

    // Memory type filter
    if (memoryType && memoryType !== "all") {
      where.memoryType = memoryType;
    }

    // Active filter
    if (isActive === "true") {
      where.isActive = true;
    } else if (isActive === "false") {
      where.isActive = false;
    }

    // Search filter (search in value JSON or user email)
    if (search) {
      where.OR = [
        { user: { email: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Get total count
    const total = await prisma.userMemory.count({ where });

    // Get memories with user info
    const memories = await prisma.userMemory.findMany({
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

    // Transform response
    const transformedMemories = memories.map((memory) => ({
      id: memory.id,
      userId: memory.userId,
      userEmail: memory.user.email,
      userDisplayName: memory.user.displayName,
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

    return NextResponse.json({
      success: true,
      memories: transformedMemories,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error listing memories:", error);
    return NextResponse.json(
      { error: "Failed to list memories" },
      { status: 500 }
    );
  }
}
