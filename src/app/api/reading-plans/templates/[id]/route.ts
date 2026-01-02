import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// Validation schema for updates
const updateTemplateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  subtitle: z.string().max(300).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  totalDays: z.number().int().min(1).max(365).optional(),
  estimatedMinutesMin: z.number().int().min(1).max(120).optional(),
  estimatedMinutesMax: z.number().int().min(1).max(120).optional(),
  theme: z.string().max(100).nullable().optional(),
  visibility: z.enum(["public", "private", "archived"]).optional(),
  isPublished: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

// Helper to check if user is admin
async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === "admin";
}

// GET /api/reading-plans/templates/[id]
// Get a specific template with its days
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const userIsAdmin = await isAdmin(authResult.userId);

    const template = await prisma.readingPlanTemplate.findFirst({
      where: {
        OR: [{ id }, { shortId: id }, { slug: id }],
        deletedAt: null,
        // Non-admins can only see published public templates
        ...(!userIsAdmin ? { isPublished: true, visibility: "public" } : {}),
      },
      include: {
        days: {
          orderBy: { dayNumber: "asc" },
        },
        createdBy: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
          },
        },
        _count: {
          select: { groupPlans: true },
        },
      },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      template: {
        id: template.id,
        shortId: template.shortId,
        slug: template.slug,
        title: template.title,
        subtitle: template.subtitle,
        description: template.description,
        coverImageUrl: template.coverImageUrl,
        totalDays: template.totalDays,
        estimatedMinutesMin: template.estimatedMinutesMin,
        estimatedMinutesMax: template.estimatedMinutesMax,
        theme: template.theme,
        visibility: template.visibility,
        isPublished: template.isPublished,
        isFeatured: template.isFeatured,
        groupPlansCount: template._count.groupPlans,
        createdBy: template.createdBy
          ? {
              id: template.createdBy.id,
              displayName: template.createdBy.displayName,
              firstName: template.createdBy.firstName,
            }
          : null,
        days: template.days.map((d) => ({
          id: d.id,
          dayNumber: d.dayNumber,
          passageRef: d.passageRef,
          // Legacy fields (deprecated): derived from scriptureBlocks
          bookId: (() => {
            const blocks = Array.isArray(d.scriptureBlocks)
              ? (d.scriptureBlocks as Array<Record<string, unknown>>)
              : [];
            const first = blocks[0];
            return typeof first?.bookId === "string" ? first.bookId : null;
          })(),
          startChapter: (() => {
            const blocks = Array.isArray(d.scriptureBlocks)
              ? (d.scriptureBlocks as Array<Record<string, unknown>>)
              : [];
            const first = blocks[0];
            return typeof first?.chapter === "number" ? first.chapter : null;
          })(),
          startVerse: (() => {
            const blocks = Array.isArray(d.scriptureBlocks)
              ? (d.scriptureBlocks as Array<Record<string, unknown>>)
              : [];
            const first = blocks[0];
            const v = first?.startVerse;
            return typeof v === "number" ? v : null;
          })(),
          endChapter: (() => {
            const blocks = Array.isArray(d.scriptureBlocks)
              ? (d.scriptureBlocks as Array<Record<string, unknown>>)
              : [];
            const last = blocks.length ? blocks[blocks.length - 1] : undefined;
            return typeof last?.chapter === "number" ? last.chapter : null;
          })(),
          endVerse: (() => {
            const blocks = Array.isArray(d.scriptureBlocks)
              ? (d.scriptureBlocks as Array<Record<string, unknown>>)
              : [];
            const last = blocks.length ? blocks[blocks.length - 1] : undefined;
            const v = last?.endVerse ?? last?.startVerse;
            return typeof v === "number" ? v : null;
          })(),
          title: d.title,
          summary: d.summary,
          reflectionPrompt: d.reflectionPrompt,
          prayerPrompt: d.prayerPrompt,
          contextIntro: d.contextIntro,
          extraMetadata: d.extraMetadata,
        })),
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching template:", error);
    return NextResponse.json(
      { error: "Failed to fetch template" },
      { status: 500 }
    );
  }
}

// PATCH /api/reading-plans/templates/[id]
// Update a template (admin only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(authResult.userId);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const validatedData = updateTemplateSchema.parse(body);

    // Find template
    const existingTemplate = await prisma.readingPlanTemplate.findFirst({
      where: {
        OR: [{ id }, { shortId: id }],
        deletedAt: null,
      },
    });

    if (!existingTemplate) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const template = await prisma.readingPlanTemplate.update({
      where: { id: existingTemplate.id },
      data: validatedData,
    });

    return NextResponse.json({
      success: true,
      template: {
        id: template.id,
        shortId: template.shortId,
        slug: template.slug,
        title: template.title,
        subtitle: template.subtitle,
        description: template.description,
        coverImageUrl: template.coverImageUrl,
        totalDays: template.totalDays,
        estimatedMinutesMin: template.estimatedMinutesMin,
        estimatedMinutesMax: template.estimatedMinutesMax,
        theme: template.theme,
        visibility: template.visibility,
        isPublished: template.isPublished,
        isFeatured: template.isFeatured,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating template:", error);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 }
    );
  }
}

// DELETE /api/reading-plans/templates/[id]
// Soft delete a template (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userIsAdmin = await isAdmin(authResult.userId);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existingTemplate = await prisma.readingPlanTemplate.findFirst({
      where: {
        OR: [{ id }, { shortId: id }],
        deletedAt: null,
      },
    });

    if (!existingTemplate) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Soft delete
    await prisma.readingPlanTemplate.update({
      where: { id: existingTemplate.id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting template:", error);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 }
    );
  }
}
