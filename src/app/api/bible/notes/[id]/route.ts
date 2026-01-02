import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { deleteArtifact, updateArtifact } from "@/lib/artifacts/artifactService";
import { generateSafeNoteSummary } from "@/lib/pipeline/stages/noteSummary";
import type { VerseNoteMetadata } from "@/lib/artifacts/types";

const updateNoteSchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  isPrivate: z.boolean().optional(),
});

// PATCH /api/bible/notes/[id]
// Update a note (author only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Find the note
    const existingNote = await prisma.verseNote.findUnique({
      where: { id },
    });

    if (!existingNote) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Only the author can update
    if (existingNote.userId !== authResult.userId) {
      return NextResponse.json(
        { error: "Not authorized to update this note" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = updateNoteSchema.parse(body);

    // Update the note with provided fields
    const updatedNote = await prisma.verseNote.update({
      where: { id },
      data: {
        ...(validatedData.content && { content: validatedData.content }),
        ...(validatedData.isPrivate !== undefined && {
          isPrivate: validatedData.isPrivate,
        }),
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

    // Update artifact (content, metadata, embedding) if present
    try {
      const artifact = await prisma.artifact.findFirst({
        where: {
          userId: authResult.userId,
        type: "verse_note",
          status: "active",
          metadata: { path: ["noteId"], equals: id },
        },
      });

      if (artifact) {
        const existingMetadata = (artifact.metadata as VerseNoteMetadata | null) || ({} as VerseNoteMetadata);
        const summary = validatedData.content
          ? await generateSafeNoteSummary(validatedData.content)
          : undefined;

        const updatedMetadata: VerseNoteMetadata = {
          ...existingMetadata,
          ...(validatedData.isPrivate !== undefined ? { isPrivate: validatedData.isPrivate } : {}),
          ...(summary ? { noteSummary: summary.summary } : {}),
          ...(summary?.tags && summary.tags.length > 0 ? { noteTags: summary.tags } : {}),
        };

        await updateArtifact(artifact.id, authResult.userId, {
          ...(validatedData.content ? { content: validatedData.content } : {}),
          // Update title with new summary when content changes
          ...(summary ? { title: summary.summary } : {}),
          // Update tags array alongside metadata
          ...(summary?.tags && summary.tags.length > 0 ? { tags: summary.tags } : {}),
          ...(Object.keys(updatedMetadata).length > 0 ? { metadata: updatedMetadata as unknown as Record<string, unknown> } : {}),
        });
      }
    } catch (artifactError) {
      console.error("[Notes] Failed to update artifact:", artifactError);
    }

    return NextResponse.json({
      success: true,
      note: {
        id: updatedNote.id,
        verseId: updatedNote.verseId, // anchor (start verse)
        bookId: updatedNote.bookId,
        chapter: updatedNote.chapter,
        verseStart: updatedNote.verseStart,
        verseEnd: updatedNote.verseEnd,
        content: updatedNote.content,
        isPrivate: updatedNote.isPrivate,
        author: {
          id: updatedNote.user.id,
          displayName: updatedNote.user.displayName,
          firstName: updatedNote.user.firstName,
          profileImageUrl: updatedNote.user.profileImageUrl,
        },
        isOwn: true,
        createdAt: updatedNote.createdAt.toISOString(),
        updatedAt: updatedNote.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating note:", error);
    return NextResponse.json(
      { error: "Failed to update note" },
      { status: 500 }
    );
  }
}

// DELETE /api/bible/notes/[id]
// Delete a note (author only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Find the note
    const existingNote = await prisma.verseNote.findUnique({
      where: { id },
    });

    if (!existingNote) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Only the author can delete
    if (existingNote.userId !== authResult.userId) {
      return NextResponse.json(
        { error: "Not authorized to delete this note" },
        { status: 403 }
      );
    }

    await prisma.verseNote.delete({
      where: { id },
    });

    // Soft-delete corresponding artifact
    try {
      const artifact = await prisma.artifact.findFirst({
        where: {
          userId: authResult.userId,
          type: "verse_note",
          status: "active",
          metadata: { path: ["noteId"], equals: id },
        },
      });

      if (artifact) {
        await deleteArtifact(artifact.id, authResult.userId);
      }
    } catch (artifactError) {
      console.error("[Notes] Failed to delete artifact:", artifactError);
    }

    return NextResponse.json({
      success: true,
      deletedId: id,
    });
  } catch (error) {
    console.error("Error deleting note:", error);
    return NextResponse.json(
      { error: "Failed to delete note" },
      { status: 500 }
    );
  }
}
