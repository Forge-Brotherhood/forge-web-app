import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Validation schemas
const getNotesSchema = z.object({
  bookId: z.string().min(1),
  chapter: z.string().regex(/^\d+$/),
});

const createNoteSchema = z.object({
  verseId: z.string().min(1),
  content: z.string().min(1).max(2000),
  isPrivate: z.boolean().default(false),
});

// GET /api/bible/notes?bookId=GEN&chapter=1
// Returns notes for a specific chapter:
// - All of the user's own notes (private and shared)
// - Shared notes from users who share at least one group with the requesting user
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's active group memberships
    const memberships = await prisma.groupMember.findMany({
      where: { userId: authResult.userId, status: "active" },
      select: { groupId: true },
    });

    // Parse query params
    const { searchParams } = new URL(request.url);
    const params = {
      bookId: searchParams.get("bookId") || "",
      chapter: searchParams.get("chapter") || "",
    };

    const validatedParams = getNotesSchema.parse(params);
    const chapterNumber = parseInt(validatedParams.chapter, 10);

    // Build the verseId prefix pattern for this chapter (e.g., "GEN_1_")
    const verseIdPrefix = `${validatedParams.bookId}_${chapterNumber}_`;

    // Get all group IDs the user is a member of
    const userGroupIds = memberships.map((m) => m.groupId);

    // Get user IDs of people in the same groups (fellow group members)
    let fellowMemberIds: string[] = [];
    if (userGroupIds.length > 0) {
      const groupMembers = await prisma.groupMember.findMany({
        where: {
          groupId: { in: userGroupIds },
          status: "active",
        },
        select: { userId: true },
      });
      fellowMemberIds = [...new Set(groupMembers.map((m) => m.userId))];
    }

    // Get all notes for this chapter where:
    // 1. Author is the requesting user (show all their notes), OR
    // 2. Author shares a group with requesting user AND isPrivate = false
    const notes = await prisma.verseNote.findMany({
      where: {
        verseId: { startsWith: verseIdPrefix },
        OR: [
          { userId: authResult.userId }, // Always show user's own notes
          {
            userId: { in: fellowMemberIds },
            isPrivate: false,
          }, // Show shared notes from group members
        ],
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
      orderBy: [{ verseId: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({
      success: true,
      notes: notes.map((n) => ({
        id: n.id,
        verseId: n.verseId,
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

    // Create the note
    const note = await prisma.verseNote.create({
      data: {
        userId: authResult.userId,
        verseId: validatedData.verseId,
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

    return NextResponse.json(
      {
        success: true,
        note: {
          id: note.id,
          verseId: note.verseId,
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
