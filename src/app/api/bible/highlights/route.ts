import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  createArtifact,
  deleteArtifact,
  updateArtifact,
} from "@/lib/artifacts/artifactService";
import type { VerseHighlightMetadata } from "@/lib/artifacts/types";
import { getBookDisplayNameFromCode } from "@/lib/bible";

// Validation schemas
const getHighlightsSchema = z.object({
  bookId: z.string().min(1),
  chapter: z.string().regex(/^\d+$/),
});

// Schema for individual verse in the array
const verseInputSchema = z.object({
  verseId: z.string().min(1),          // e.g., "JHN_3_16"
  reference: z.string().min(1),        // e.g., "John 3:16"
  content: z.string().optional(),      // verse text (unused for storage)
});

// Unified schema for creating highlights (1-4 verses)
const createHighlightsSchema = z.object({
  verses: z.array(verseInputSchema).min(1).max(4),
  color: z.enum(["yellow", "green", "blue", "pink", "orange", "purple"]),
  translation: z.string().min(1),      // e.g., "BSB"
  book: z.string().min(1),             // e.g., "John"
  chapter: z.number().int().positive(),
});

const deleteHighlightsSchema = z.object({
  verseIds: z.array(z.string().min(1)).min(1),
});

// GET /api/bible/highlights?bookId=GEN&chapter=1
// Returns highlights for a specific chapter (with optional artifact IDs)
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

    // Get all highlight ranges for this chapter
    const highlights = await prisma.bibleHighlight.findMany({
      where: {
        userId: authResult.userId,
        bookId: validatedParams.bookId,
        chapter: chapterNumber,
      },
      orderBy: {
        verseStart: "asc",
      },
    });

    return NextResponse.json({
      success: true,
      highlights: highlights.map((h) => ({
        id: h.id,
        bookId: h.bookId,
        chapter: h.chapter,
        verseStart: h.verseStart,
        verseEnd: h.verseEnd,
        color: h.color,
        artifactId: h.artifactId ?? null,
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
// Create highlights for selected verses (1-4 verses per request)
// Each verse creates 1 BibleHighlight + 1 artifact (1:1 mapping)
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
    const data = createHighlightsSchema.parse(body);

    const results: Array<{
      id: string;
      bookId: string;
      chapter: number;
      verseStart: number;
      verseEnd: number;
      color: string;
      artifactId: string | null;
      createdAt: string;
      updatedAt: string;
    }> = [];

    const parsedVerses = data.verses.map((v) => {
      const [bookId, chapterStr, verseStr] = v.verseId.split("_");
      return {
        bookId: bookId ?? "",
        chapter: parseInt(chapterStr ?? "0", 10),
        verse: parseInt(verseStr ?? "0", 10),
      };
    });

    if (parsedVerses.some((p) => !p.bookId || p.chapter <= 0 || p.verse <= 0)) {
      return NextResponse.json({ error: "Invalid verseId format" }, { status: 400 });
    }

    const bookId = parsedVerses[0]!.bookId;
    const chapter = parsedVerses[0]!.chapter;
    if (!parsedVerses.every((p) => p.bookId === bookId && p.chapter === chapter)) {
      return NextResponse.json({ error: "Verses must be from the same chapter" }, { status: 400 });
    }

    const sorted = [...parsedVerses].sort((a, b) => a.verse - b.verse);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.verse !== sorted[i - 1]!.verse + 1) {
        return NextResponse.json({ error: "Verses must be contiguous" }, { status: 400 });
      }
    }

    const verseStart = sorted[0]!.verse;
    const verseEnd = sorted[sorted.length - 1]!.verse;

    const bookName = getBookDisplayNameFromCode(bookId) ?? data.book;
    const scriptureRef =
      verseStart === verseEnd
        ? `${bookName} ${chapter}:${verseStart}`
        : `${bookName} ${chapter}:${verseStart}-${verseEnd}`;

    const newMetadata: VerseHighlightMetadata = {
      bibleVersion: data.translation,
      reference: { book: bookName, chapter, verseStart, verseEnd },
      style: { color: data.color },
    };

    // Prevent overlap by carving the selection out of existing ranges (may split existing ranges)
    const overlapping = await prisma.bibleHighlight.findMany({
        where: {
            userId: authResult.userId,
        bookId,
        chapter,
        verseStart: { lte: verseEnd },
        verseEnd: { gte: verseStart },
      },
      orderBy: { verseStart: "asc" },
    });

    const makeScriptureRef = (b: string, c: number, start: number, end: number) =>
      start === end ? `${b} ${c}:${start}` : `${b} ${c}:${start}-${end}`;

    const makeMetadata = (
      bibleVersion: string,
      b: string,
      c: number,
      start: number,
      end: number,
      color: string
    ): VerseHighlightMetadata => ({
      bibleVersion,
      reference: { book: b, chapter: c, verseStart: start, verseEnd: end },
      style: { color },
    });

    for (const existing of overlapping) {
      const overlapStart = Math.max(existing.verseStart, verseStart);
      const overlapEnd = Math.min(existing.verseEnd, verseEnd);
      if (overlapStart > overlapEnd) continue;

      const leftStart = existing.verseStart;
      const leftEnd = overlapStart - 1;
      const rightStart = overlapEnd + 1;
      const rightEnd = existing.verseEnd;

      const hasLeft = leftEnd >= leftStart;
      const hasRight = rightEnd >= rightStart;

      const existingBookName = getBookDisplayNameFromCode(existing.bookId) ?? existing.bookId;

      if (!hasLeft && !hasRight) {
        await prisma.bibleHighlight.delete({ where: { id: existing.id } });
        if (existing.artifactId) await deleteArtifact(existing.artifactId, authResult.userId);
        continue;
      }

      if (hasLeft && !hasRight) {
        await prisma.bibleHighlight.update({
          where: { id: existing.id },
          data: { verseStart: leftStart, verseEnd: leftEnd },
        });
        if (existing.artifactId) {
          await updateArtifact(existing.artifactId, authResult.userId, {
            content: "",
            scriptureRefs: [makeScriptureRef(existingBookName, existing.chapter, leftStart, leftEnd)],
            tags: ["highlight"],
            metadata: makeMetadata(existing.bibleVersion, existingBookName, existing.chapter, leftStart, leftEnd, existing.color) as unknown as Record<string, unknown>,
          });
        }
        continue;
      }

      if (!hasLeft && hasRight) {
        await prisma.bibleHighlight.update({
          where: { id: existing.id },
          data: { verseStart: rightStart, verseEnd: rightEnd },
        });
        if (existing.artifactId) {
          await updateArtifact(existing.artifactId, authResult.userId, {
            content: "",
            scriptureRefs: [makeScriptureRef(existingBookName, existing.chapter, rightStart, rightEnd)],
            tags: ["highlight"],
            metadata: makeMetadata(existing.bibleVersion, existingBookName, existing.chapter, rightStart, rightEnd, existing.color) as unknown as Record<string, unknown>,
          });
        }
        continue;
      }

      // Split into two ranges
      await prisma.bibleHighlight.update({
        where: { id: existing.id },
        data: { verseStart: leftStart, verseEnd: leftEnd },
      });
      if (existing.artifactId) {
        await updateArtifact(existing.artifactId, authResult.userId, {
          content: "",
          scriptureRefs: [makeScriptureRef(existingBookName, existing.chapter, leftStart, leftEnd)],
          tags: ["highlight"],
          metadata: makeMetadata(existing.bibleVersion, existingBookName, existing.chapter, leftStart, leftEnd, existing.color) as unknown as Record<string, unknown>,
        });
      }

      const rightArtifact = await createArtifact({
          userId: authResult.userId,
        type: "verse_highlight",
        scope: "private",
        content: "",
        scriptureRefs: [makeScriptureRef(existingBookName, existing.chapter, rightStart, rightEnd)],
        tags: ["highlight"],
        metadata: makeMetadata(existing.bibleVersion, existingBookName, existing.chapter, rightStart, rightEnd, existing.color) as unknown as Record<string, unknown>,
      });

      await prisma.bibleHighlight.create({
        data: {
          userId: authResult.userId,
          bookId: existing.bookId,
          chapter: existing.chapter,
          verseStart: rightStart,
          verseEnd: rightEnd,
          color: existing.color,
          bibleVersion: existing.bibleVersion,
          artifactId: rightArtifact.id,
        },
      });
    }

          const artifact = await createArtifact({
            userId: authResult.userId,
            type: "verse_highlight",
            scope: "private",
      content: "",
      scriptureRefs: [scriptureRef],
      tags: ["highlight"],
      metadata: newMetadata as unknown as Record<string, unknown>,
          });

    const highlight = await prisma.bibleHighlight.create({
      data: {
        userId: authResult.userId,
        bookId,
        chapter,
        verseStart,
        verseEnd,
        color: data.color,
        bibleVersion: data.translation,
        artifactId: artifact.id,
      },
    });

      results.push({
        id: highlight.id,
      bookId: highlight.bookId,
      chapter: highlight.chapter,
      verseStart: highlight.verseStart,
      verseEnd: highlight.verseEnd,
        color: highlight.color,
      artifactId: highlight.artifactId ?? null,
        createdAt: highlight.createdAt.toISOString(),
        updatedAt: highlight.updatedAt.toISOString(),
      });

    return NextResponse.json({
      success: true,
      highlights: results,
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
// Remove highlights for specified verses (also soft-deletes corresponding artifacts)
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

    const parsed = validatedData.verseIds.map((verseId) => {
      const [bookId, chapterStr, verseStr] = verseId.split("_");
      return {
        bookId: bookId ?? "",
        chapter: parseInt(chapterStr ?? "0", 10),
        verse: parseInt(verseStr ?? "0", 10),
      };
    });

    if (parsed.some((p) => !p.bookId || p.chapter <= 0 || p.verse <= 0)) {
      return NextResponse.json({ error: "Invalid verseId format" }, { status: 400 });
    }

    const bookId = parsed[0]!.bookId;
    const chapter = parsed[0]!.chapter;
    if (!parsed.every((p) => p.bookId === bookId && p.chapter === chapter)) {
      return NextResponse.json({ error: "Verses must be from the same chapter" }, { status: 400 });
    }

    const sorted = [...parsed].sort((a, b) => a.verse - b.verse);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.verse !== sorted[i - 1]!.verse + 1) {
        return NextResponse.json({ error: "Verses must be contiguous" }, { status: 400 });
      }
    }

    const selStart = sorted[0]!.verse;
    const selEnd = sorted[sorted.length - 1]!.verse;

    const overlapping = await prisma.bibleHighlight.findMany({
      where: {
        userId: authResult.userId,
        bookId,
        chapter,
        verseStart: { lte: selEnd },
        verseEnd: { gte: selStart },
        },
      orderBy: { verseStart: "asc" },
    });

    let deletedCount = 0;
    let trimmedCount = 0;
    let artifactsDeleted = 0;

    const makeScriptureRef = (b: string, c: number, start: number, end: number) =>
      start === end ? `${b} ${c}:${start}` : `${b} ${c}:${start}-${end}`;

    for (const existing of overlapping) {
      // Reject middle removals (matches UX: can't deselect from the middle)
      const wouldSplit = selStart > existing.verseStart && selEnd < existing.verseEnd;
      if (wouldSplit) {
        return NextResponse.json(
          { error: "Cannot remove highlight from the middle of a range" },
          { status: 400 }
        );
      }

      const removeWhole = selStart <= existing.verseStart && selEnd >= existing.verseEnd;
      if (removeWhole) {
        await prisma.bibleHighlight.delete({ where: { id: existing.id } });
        deletedCount++;
        if (existing.artifactId) {
          await deleteArtifact(existing.artifactId, authResult.userId);
          artifactsDeleted++;
        }
        continue;
      }

      const existingBookName = getBookDisplayNameFromCode(existing.bookId) ?? existing.bookId;

      // Trim left edge
      if (selStart <= existing.verseStart && selEnd < existing.verseEnd) {
        const newStart = selEnd + 1;
        await prisma.bibleHighlight.update({
          where: { id: existing.id },
          data: { verseStart: newStart },
        });
        trimmedCount++;
        if (existing.artifactId) {
          const metadata: VerseHighlightMetadata = {
            bibleVersion: existing.bibleVersion,
            reference: {
              book: existingBookName,
              chapter: existing.chapter,
              verseStart: newStart,
              verseEnd: existing.verseEnd,
            },
            style: { color: existing.color },
          };
          await updateArtifact(existing.artifactId, authResult.userId, {
            content: "",
            scriptureRefs: [makeScriptureRef(existingBookName, existing.chapter, newStart, existing.verseEnd)],
            tags: ["highlight"],
            metadata: metadata as unknown as Record<string, unknown>,
          });
        }
        continue;
      }

      // Trim right edge
      if (selStart > existing.verseStart && selEnd >= existing.verseEnd) {
        const newEnd = selStart - 1;
        await prisma.bibleHighlight.update({
          where: { id: existing.id },
          data: { verseEnd: newEnd },
        });
        trimmedCount++;
        if (existing.artifactId) {
          const metadata: VerseHighlightMetadata = {
            bibleVersion: existing.bibleVersion,
            reference: {
              book: existingBookName,
              chapter: existing.chapter,
              verseStart: existing.verseStart,
              verseEnd: newEnd,
            },
            style: { color: existing.color },
          };
          await updateArtifact(existing.artifactId, authResult.userId, {
            content: "",
            scriptureRefs: [makeScriptureRef(existingBookName, existing.chapter, existing.verseStart, newEnd)],
            tags: ["highlight"],
            metadata: metadata as unknown as Record<string, unknown>,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      deletedCount,
      trimmedCount,
      artifactsDeleted,
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
