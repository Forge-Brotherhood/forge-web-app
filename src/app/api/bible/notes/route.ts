import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { createArtifact } from "@/lib/artifacts/artifactService";
import { generateSafeNoteSummary } from "@/lib/ai/noteSummary";
import type { VerseNoteMetadata } from "@/lib/artifacts/types";
import { getBookDisplayNameFromCode } from "@/lib/bible";

// Validation schemas
const getNotesSchema = z.object({
  bookId: z.string().min(1),
  chapter: z.string().regex(/^\d+$/),
});

const createNoteSchema = z
  .object({
    // New contract: contiguous selection in one chapter
    verseIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    // Back-compat: single verse
    verseId: z.string().min(1).optional(),
    content: z.string().min(1).max(2000),
    isPrivate: z.boolean().default(false),
  })
  .refine((v) => v.verseIds?.length || v.verseId, {
    message: "Must provide verseIds or verseId",
  });

type ParsedVerseId = { bookId: string; chapter: number; verse: number };
function parseVerseId(verseId: string): ParsedVerseId | null {
  const [bookId, chapterStr, verseStr] = verseId.split("_");
  const chapter = parseInt(chapterStr ?? "", 10);
  const verse = parseInt(verseStr ?? "", 10);
  if (!bookId || !Number.isFinite(chapter) || !Number.isFinite(verse)) return null;
  if (chapter <= 0 || verse <= 0) return null;
  return { bookId, chapter, verse };
}

function makeVerseId(bookId: string, chapter: number, verse: number): string {
  return `${bookId}_${chapter}_${verse}`;
}

function makeScriptureRef(bookName: string, chapter: number, verseStart: number, verseEnd: number): string {
  return verseStart === verseEnd
    ? `${bookName} ${chapter}:${verseStart}`
    : `${bookName} ${chapter}:${verseStart}-${verseEnd}`;
}

// GET /api/bible/notes?bookId=GEN&chapter=1
// Returns notes for a specific chapter (user's own notes only)
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const params = {
      bookId: searchParams.get("bookId") || "",
      chapter: searchParams.get("chapter") || "",
    };

    const validatedParams = getNotesSchema.parse(params);
    const chapterNumber = parseInt(validatedParams.chapter, 10);

    // Get user's own notes for this chapter
    const notes = await prisma.verseNote.findMany({
      where: {
        bookId: validatedParams.bookId,
        chapter: chapterNumber,
        userId: authResult.userId,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            profileImageUrl: true,
          },
        },
      },
      orderBy: [{ verseStart: "asc" }, { verseEnd: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({
      success: true,
      notes: notes.map((n) => ({
        id: n.id,
        verseId: n.verseId, // anchor (start verse)
        bookId: n.bookId,
        chapter: n.chapter,
        verseStart: n.verseStart,
        verseEnd: n.verseEnd,
        content: n.content,
        isPrivate: n.isPrivate,
        author: {
          id: n.user.id,
          displayName: n.user.displayName,
          firstName: n.user.firstName,
          profileImageUrl: n.user.profileImageUrl,
        },
        isOwn: n.userId === authResult.userId,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request parameters", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error fetching notes:", error);
    return NextResponse.json(
      { error: "Failed to fetch notes" },
      { status: 500 }
    );
  }
}

// POST /api/bible/notes
// Create a note on a verse
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = createNoteSchema.parse(body);

    const requestedVerseIds = validatedData.verseIds ?? (validatedData.verseId ? [validatedData.verseId] : []);
    if (requestedVerseIds.length === 0) {
      return NextResponse.json({ error: "Must provide verseIds or verseId" }, { status: 400 });
    }

    const parsed = requestedVerseIds.map(parseVerseId);
    if (parsed.some((p) => !p)) {
      return NextResponse.json({ error: "Invalid verseId format" }, { status: 400 });
    }

    const normalized = (parsed as ParsedVerseId[]).sort((a, b) => a.verse - b.verse);
    const bookId = normalized[0]!.bookId;
    const chapter = normalized[0]!.chapter;
    if (!normalized.every((p) => p.bookId === bookId && p.chapter === chapter)) {
      return NextResponse.json({ error: "Verses must be from the same chapter" }, { status: 400 });
    }

    for (let i = 1; i < normalized.length; i++) {
      if (normalized[i]!.verse !== normalized[i - 1]!.verse + 1) {
        return NextResponse.json({ error: "Verses must be contiguous" }, { status: 400 });
      }
    }

    const verseStart = normalized[0]!.verse;
    const verseEnd = normalized[normalized.length - 1]!.verse;
    const anchorVerseId = makeVerseId(bookId, chapter, verseStart);

    // Create the note
    const note = await prisma.verseNote.create({
      data: {
        userId: authResult.userId,
        verseId: anchorVerseId,
        bookId,
        chapter,
        verseStart,
        verseEnd,
        content: validatedData.content,
        isPrivate: validatedData.isPrivate,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            profileImageUrl: true,
          },
        },
      },
    });

    // Create artifact for AI context
    try {
      const bookName = getBookDisplayNameFromCode(bookId) ?? bookId;

      const readerSettings = await prisma.readerSettings.findUnique({
        where: { userId: authResult.userId },
        select: { selectedTranslation: true },
      });
      const bibleVersion = readerSettings?.selectedTranslation ?? "BSB";

      // Generate LLM summary and tags for the note
      const summaryResult = await generateSafeNoteSummary(validatedData.content);

      const metadata: VerseNoteMetadata = {
        noteId: note.id,
        bibleVersion,
        reference: {
          book: bookName,
          chapter,
          verseStart,
          verseEnd,
        },
        isPrivate: validatedData.isPrivate,
        // Store LLM-generated summary and tags
        noteSummary: summaryResult.summary,
        noteTags: summaryResult.tags,
      };

      await createArtifact({
        userId: authResult.userId,
        type: "verse_note",
        scope: "private",
        // Use LLM summary as title instead of just verse reference
        title: summaryResult.summary,
        content: validatedData.content,
        scriptureRefs: [makeScriptureRef(bookName, chapter, verseStart, verseEnd)],
        // Use LLM-generated tags for artifact retrieval
        tags: summaryResult.tags,
        metadata: metadata as unknown as Record<string, unknown>,
      });
    } catch (artifactError) {
      console.error("[Notes] Failed to create artifact:", artifactError);
      // Don't fail note creation if artifact fails
    }

    return NextResponse.json(
      {
        success: true,
        note: {
          id: note.id,
          verseId: note.verseId, // anchor (start verse)
          bookId: note.bookId,
          chapter: note.chapter,
          verseStart: note.verseStart,
          verseEnd: note.verseEnd,
          content: note.content,
          isPrivate: note.isPrivate,
          author: {
            id: note.user.id,
            displayName: note.user.displayName,
            firstName: note.user.firstName,
            profileImageUrl: note.user.profileImageUrl,
          },
          isOwn: true,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error creating note:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
}
