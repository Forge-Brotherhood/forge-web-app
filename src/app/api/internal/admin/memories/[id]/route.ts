/**
 * /api/internal/admin/memories/[id]
 *
 * Internal API for single memory CRUD operations.
 * GET - Fetch single memory
 * PATCH - Update memory
 * DELETE - Hard delete memory
 *
 * Called by forge-admin-app. Protected by INTERNAL_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
// Update Schema
// =============================================================================

const updateSchema = z.object({
  memoryType: z.enum([
    "struggle_theme",
    "faith_stage",
    "scripture_affinity",
    "tone_preference",
    "group_role",
  ]).optional(),
  value: z.record(z.string(), z.unknown()).optional(),
  strength: z.number().min(0).max(1).optional(),
  isActive: z.boolean().optional(),
});

// =============================================================================
// GET Handler - Single Memory
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    const memory = await prisma.userMemory.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });

    if (!memory) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      memory: {
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
      },
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error fetching memory:", error);
    return NextResponse.json(
      { error: "Failed to fetch memory" },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH Handler - Update Memory
// =============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    // Check memory exists
    const existing = await prisma.userMemory.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const updates = updateSchema.parse(body);
    const data: Prisma.UserMemoryUpdateInput = {
      ...updates,
      value: updates.value
        ? (updates.value as unknown as Prisma.InputJsonValue)
        : undefined,
    };

    // Update memory
    const updated = await prisma.userMemory.update({
      where: { id },
      data,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      memory: {
        id: updated.id,
        userId: updated.userId,
        userEmail: updated.user.email,
        userDisplayName: updated.user.displayName,
        memoryType: updated.memoryType,
        value: updated.value,
        strength: updated.strength,
        occurrences: updated.occurrences,
        source: updated.source,
        isActive: updated.isActive,
        firstSeenAt: updated.firstSeenAt.toISOString(),
        lastSeenAt: updated.lastSeenAt.toISOString(),
        decayedAt: updated.decayedAt?.toISOString() || null,
        createdAt: updated.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("[INTERNAL-API] Error updating memory:", error);
    return NextResponse.json(
      { error: "Failed to update memory" },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE Handler - Hard Delete Memory
// =============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!validateInternalApiKey(request)) {
    return NextResponse.json(
      { error: "Invalid or missing internal API key" },
      { status: 401 }
    );
  }

  try {
    // Check memory exists
    const existing = await prisma.userMemory.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Memory not found" },
        { status: 404 }
      );
    }

    // Hard delete
    await prisma.userMemory.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      deletedId: id,
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error deleting memory:", error);
    return NextResponse.json(
      { error: "Failed to delete memory" },
      { status: 500 }
    );
  }
}
