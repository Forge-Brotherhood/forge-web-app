import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Validation schemas
const getHighlightsSchema = z.object({
  bookId: z.string().min(1),
  chapter: z.string().regex(/^\d+$/),
});

const createHighlightsSchema = z.object({
  verseIds: z.array(z.string().min(1)).min(1),
  color: z.enum(["yellow", "green", "blue", "pink", "orange"]),
});

const deleteHighlightsSchema = z.object({
  verseIds: z.array(z.string().min(1)).min(1),
});

// GET /api/bible/highlights?bookId=GEN&chapter=1
// Returns highlights for a specific chapter
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const params = {
      bookId: searchParams.get("bookId") || "",
      chapter: searchParams.get("chapter") || "",
    };

    const validatedParams = getHighlightsSchema.parse(params);
    const chapterNumber = parseInt(validatedParams.chapter, 10);

    // Build the verseId prefix pattern for this chapter (e.g., "GEN_1_")
    const verseIdPrefix = `${validatedParams.bookId}_${chapterNumber}_`;

    // Get all highlights for this chapter
    const highlights = await prisma.bibleHighlight.findMany({
      where: {
        userId: user.id,
        verseId: {
          startsWith: verseIdPrefix,
        },
      },
      orderBy: {
        verseId: "asc",
      },
    });

    return NextResponse.json({
      success: true,
      highlights: highlights.map((h) => ({
        id: h.id,
        verseId: h.verseId,
        color: h.color,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request parameters", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error fetching highlights:", error);
    return NextResponse.json(
      { error: "Failed to fetch highlights" },
      { status: 500 }
    );
  }
}

// POST /api/bible/highlights
// Create highlights for selected verses
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validatedData = createHighlightsSchema.parse(body);

    // Upsert highlights for each verse (update color if exists, create if not)
    const highlights = await Promise.all(
      validatedData.verseIds.map(async (verseId) => {
        return prisma.bibleHighlight.upsert({
          where: {
            userId_verseId: {
              userId: user.id,
              verseId: verseId,
            },
          },
          update: {
            color: validatedData.color,
          },
          create: {
            userId: user.id,
            verseId: verseId,
            color: validatedData.color,
          },
        });
      })
    );

    return NextResponse.json({
      success: true,
      highlights: highlights.map((h) => ({
        id: h.id,
        verseId: h.verseId,
        color: h.color,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString(),
      })),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating highlights:", error);
    return NextResponse.json(
      { error: "Failed to create highlights" },
      { status: 500 }
    );
  }
}

// DELETE /api/bible/highlights
// Remove highlights for specified verses
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validatedData = deleteHighlightsSchema.parse(body);

    // Delete highlights for the specified verses
    const result = await prisma.bibleHighlight.deleteMany({
      where: {
        userId: user.id,
        verseId: {
          in: validatedData.verseIds,
        },
      },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error deleting highlights:", error);
    return NextResponse.json(
      { error: "Failed to delete highlights" },
      { status: 500 }
    );
  }
}
