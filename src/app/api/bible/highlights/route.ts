import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
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
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
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
        userId: authResult.userId,
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
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
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
              userId: authResult.userId,
              verseId: verseId,
            },
          },
          update: {
            color: validatedData.color,
          },
          create: {
            userId: authResult.userId,
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
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = deleteHighlightsSchema.parse(body);

    // Delete highlights for the specified verses
    const result = await prisma.bibleHighlight.deleteMany({
      where: {
        userId: authResult.userId,
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
