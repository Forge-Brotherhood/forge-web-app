import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReadingPlanVisibility } from "@prisma/client";
import { z } from "zod";
import { nanoid } from "nanoid";

// Validation schemas
const createTemplateSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  coverImageUrl: z.string().url().optional(),
  totalDays: z.number().int().min(1).max(365),
  estimatedMinutesMin: z.number().int().min(1).max(120).default(7),
  estimatedMinutesMax: z.number().int().min(1).max(120).default(12),
  theme: z.string().max(100).optional(),
  visibility: z.enum(["public", "private", "archived"]).default("public"),
  isPublished: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
});

// Helper to generate slug from title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

// Helper to check if user is admin
async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === "admin";
}

// GET /api/reading-plans/templates
// Returns list of published templates (any authenticated user)
export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const featured = searchParams.get("featured") === "true";
    const includeUnpublished = searchParams.get("includeUnpublished") === "true";
    const includeMine = searchParams.get("includeMine") === "true";

    // Only admins can see unpublished templates
    const userIsAdmin = await isAdmin(authResult.userId);

    // Build visibility filter
    let visibilityFilter;
    if (userIsAdmin && includeUnpublished) {
      // Admins with includeUnpublished see everything
      visibilityFilter = {};
    } else if (includeMine) {
      // Include public templates AND user's own private templates
      visibilityFilter = {
        OR: [
          { isPublished: true, visibility: ReadingPlanVisibility.public },
          { visibility: ReadingPlanVisibility.private, createdById: authResult.userId },
        ],
      };
    } else {
      // Default: only public published templates
      visibilityFilter = { isPublished: true, visibility: ReadingPlanVisibility.public };
    }

    const templates = await prisma.readingPlanTemplate.findMany({
      where: {
        deletedAt: null,
        ...(featured ? { isFeatured: true } : {}),
        ...visibilityFilter,
      },
      include: {
        _count: {
          select: { days: true, userPlans: true },
        },
        createdBy: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
          },
        },
      },
      orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({
      success: true,
      templates: templates.map((t) => ({
        id: t.id,
        shortId: t.shortId,
        slug: t.slug,
        title: t.title,
        subtitle: t.subtitle,
        description: t.description,
        coverImageUrl: t.coverImageUrl,
        totalDays: t.totalDays,
        estimatedMinutesMin: t.estimatedMinutesMin,
        estimatedMinutesMax: t.estimatedMinutesMax,
        theme: t.theme,
        visibility: t.visibility,
        isPublished: t.isPublished,
        isFeatured: t.isFeatured,
        daysCount: t._count.days,
        userPlansCount: t._count.userPlans,
        createdBy: t.createdBy
          ? {
              id: t.createdBy.id,
              displayName: t.createdBy.displayName,
              firstName: t.createdBy.firstName,
            }
          : null,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching templates:", error);
    return NextResponse.json(
      { error: "Failed to fetch templates" },
      { status: 500 }
    );
  }
}

// POST /api/reading-plans/templates
// Create a new template (admin only)
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Admin check
    const userIsAdmin = await isAdmin(authResult.userId);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validatedData = createTemplateSchema.parse(body);

    // Generate unique slug
    let slug = generateSlug(validatedData.title);
    const existingSlug = await prisma.readingPlanTemplate.findUnique({
      where: { slug },
    });
    if (existingSlug) {
      slug = `${slug}-${nanoid(6)}`;
    }

    const template = await prisma.readingPlanTemplate.create({
      data: {
        shortId: nanoid(10),
        slug,
        title: validatedData.title,
        subtitle: validatedData.subtitle,
        description: validatedData.description,
        coverImageUrl: validatedData.coverImageUrl,
        totalDays: validatedData.totalDays,
        estimatedMinutesMin: validatedData.estimatedMinutesMin,
        estimatedMinutesMax: validatedData.estimatedMinutesMax,
        theme: validatedData.theme,
        visibility: validatedData.visibility,
        isPublished: validatedData.isPublished,
        isFeatured: validatedData.isFeatured,
        createdById: authResult.userId,
      },
    });

    return NextResponse.json(
      {
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
    console.error("Error creating template:", error);
    return NextResponse.json(
      { error: "Failed to create template" },
      { status: 500 }
    );
  }
}
