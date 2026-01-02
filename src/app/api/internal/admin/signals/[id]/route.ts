/**
 * /api/internal/admin/signals/[id]
 *
 * Internal API for single signal operations.
 * GET - Fetch single signal
 * PATCH - Update signal (count, expiresAt)
 * DELETE - Hard delete signal
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
  signalType: z.enum([
    "struggle_theme_signal",
    "faith_stage_signal",
    "tone_preference_signal",
  ]).optional(),
  value: z.record(z.string(), z.unknown()).optional(),
  count: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

// =============================================================================
// GET Handler - Single Signal
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
    const signal = await prisma.userSignal.findUnique({
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

    if (!signal) {
      return NextResponse.json(
        { error: "Signal not found" },
        { status: 404 }
      );
    }

    const now = new Date();
    const expiresAt = new Date(signal.expiresAt);
    const isExpired = expiresAt < now;
    const hoursRemaining = isExpired
      ? 0
      : Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)));

    return NextResponse.json({
      success: true,
      signal: {
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
      },
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error fetching signal:", error);
    return NextResponse.json(
      { error: "Failed to fetch signal" },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH Handler - Update Signal
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
    // Check signal exists
    const existing = await prisma.userSignal.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Signal not found" },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const updates = updateSchema.parse(body);

    // Convert expiresAt string to Date if provided
    const data: Prisma.UserSignalUpdateInput = {
      ...updates,
      value: updates.value
        ? (updates.value as unknown as Prisma.InputJsonValue)
        : undefined,
      expiresAt: updates.expiresAt ? new Date(updates.expiresAt) : undefined,
    };

    // Update signal
    const updated = await prisma.userSignal.update({
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

    const now = new Date();
    const expiresAt = new Date(updated.expiresAt);
    const isExpired = expiresAt < now;
    const hoursRemaining = isExpired
      ? 0
      : Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)));

    return NextResponse.json({
      success: true,
      signal: {
        id: updated.id,
        userId: updated.userId,
        userEmail: updated.user.email,
        userDisplayName: updated.user.displayName,
        signalType: updated.signalType,
        value: updated.value,
        count: updated.count,
        expiresAt: updated.expiresAt.toISOString(),
        isExpired,
        hoursRemaining,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("[INTERNAL-API] Error updating signal:", error);
    return NextResponse.json(
      { error: "Failed to update signal" },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE Handler - Hard Delete Signal
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
    // Check signal exists
    const existing = await prisma.userSignal.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Signal not found" },
        { status: 404 }
      );
    }

    // Hard delete
    await prisma.userSignal.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      deletedId: id,
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error deleting signal:", error);
    return NextResponse.json(
      { error: "Failed to delete signal" },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST Handler - Promote Signal to Memory
// =============================================================================

export async function POST(
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
    const body = await request.json();
    const action = body.action;

    if (action !== "promote") {
      return NextResponse.json(
        { error: "Unknown action. Use action: 'promote' to convert signal to memory." },
        { status: 400 }
      );
    }

    // Get the signal
    const signal = await prisma.userSignal.findUnique({
      where: { id },
    });

    if (!signal) {
      return NextResponse.json(
        { error: "Signal not found" },
        { status: 404 }
      );
    }

    // Map signal type to memory type
    const memoryTypeMap: Record<string, string> = {
      struggle_theme_signal: "struggle_theme",
      faith_stage_signal: "faith_stage",
      tone_preference_signal: "tone_preference",
    };

    const memoryType = memoryTypeMap[signal.signalType];
    if (!memoryType) {
      return NextResponse.json(
        { error: `Cannot map signal type ${signal.signalType} to memory type` },
        { status: 400 }
      );
    }

    // Create memory and delete signal in a transaction
    const [memory] = await prisma.$transaction([
      prisma.userMemory.create({
        data: {
          userId: signal.userId,
          memoryType,
          value: signal.value as unknown as Prisma.InputJsonValue,
          strength: 0.5,
          occurrences: signal.count,
          source: "admin_promotion",
        },
      }),
      prisma.userSignal.delete({
        where: { id },
      }),
    ]);

    console.log(`[INTERNAL-API] Promoted signal ${id} to memory ${memory.id}`);

    return NextResponse.json({
      success: true,
      action: "promote",
      memory: {
        id: memory.id,
        memoryType: memory.memoryType,
        value: memory.value,
        strength: memory.strength,
      },
      deletedSignalId: id,
    });
  } catch (error) {
    console.error("[INTERNAL-API] Error promoting signal:", error);
    return NextResponse.json(
      { error: "Failed to promote signal" },
      { status: 500 }
    );
  }
}
