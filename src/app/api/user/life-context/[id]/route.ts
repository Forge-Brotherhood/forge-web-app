import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { invalidateAiContextCache } from "@/lib/ai/userContext";
import {
  getLifeContextById,
  updateLifeContext,
  deleteLifeContext,
} from "@/lib/lifeContext";

// =============================================================================
// Validation Schemas
// =============================================================================

const updateRequestSchema = z.object({
  value: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  pinnedUntil: z.string().datetime().nullable().optional(),
});

// =============================================================================
// GET /api/user/life-context/[id]
// Get a single life context item
// =============================================================================

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const item = await getLifeContextById(id, user.id);

    if (!item) {
      return NextResponse.json({ error: "Context not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      item,
    });
  } catch (error) {
    console.error("Error fetching life context:", error);
    return NextResponse.json(
      { error: "Failed to fetch life context" },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH /api/user/life-context/[id]
// Update a life context item (value, expiry, or pin)
// =============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const validated = updateRequestSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Build update object
    const updates: Parameters<typeof updateLifeContext>[2] = {};

    if (validated.value !== undefined) {
      updates.value = validated.value as Parameters<typeof updateLifeContext>[2]["value"];
    }

    if (validated.expiresAt !== undefined) {
      updates.expiresAt = validated.expiresAt ? new Date(validated.expiresAt) : null;
    }

    if (validated.pinnedUntil !== undefined) {
      updates.pinnedUntil = validated.pinnedUntil ? new Date(validated.pinnedUntil) : null;
    }

    const item = await updateLifeContext(id, user.id, updates);

    if (!item) {
      return NextResponse.json({ error: "Context not found" }, { status: 404 });
    }

    // Invalidate AI context cache
    await invalidateAiContextCache(user.id);

    return NextResponse.json({
      success: true,
      item,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating life context:", error);
    return NextResponse.json(
      { error: "Failed to update life context" },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE /api/user/life-context/[id]
// Delete a single life context item
// =============================================================================

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const deleted = await deleteLifeContext(id, user.id);

    if (!deleted) {
      return NextResponse.json({ error: "Context not found" }, { status: 404 });
    }

    // Invalidate AI context cache
    await invalidateAiContextCache(user.id);

    return NextResponse.json({
      success: true,
      deleted: true,
    });
  } catch (error) {
    console.error("Error deleting life context:", error);
    return NextResponse.json(
      { error: "Failed to delete life context" },
      { status: 500 }
    );
  }
}
