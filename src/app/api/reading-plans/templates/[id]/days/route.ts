import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Prisma } from "@prisma/client";

// Validation schema for a single day
const daySchema = z.object({
  dayNumber: z.number().int().min(1),
  passageRef: z.string().min(1).max(100),
  bookId: z.string().min(1).max(10),
  startChapter: z.number().int().min(1),
  startVerse: z.number().int().min(1).nullable().optional(),
  endChapter: z.number().int().min(1),
  endVerse: z.number().int().min(1).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  summary: z.string().max(500).nullable().optional(),
  reflectionPrompt: z.string().max(500).nullable().optional(),
  prayerPrompt: z.string().max(500).nullable().optional(),
  contextIntro: z.string().max(2000).nullable().optional(),
  extraMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

// Schema for bulk upsert
const upsertDaysSchema = z.object({
  days: z.array(daySchema),
});

// Helper to check if user is admin
async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === "admin";
}

// GET /api/reading-plans/templates/[id]/days
// Get all days for a template
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
        ...(!userIsAdmin ? { isPublished: true, visibility: "public" } : {}),
      },
      include: {
        days: {
          orderBy: { dayNumber: "asc" },
        },
      },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      templateId: template.id,
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
    });
  } catch (error) {
    console.error("Error fetching template days:", error);
    return NextResponse.json(
      { error: "Failed to fetch template days" },
      { status: 500 }
    );
  }
}

// POST /api/reading-plans/templates/[id]/days
// Bulk upsert days for a template (admin only)
// This replaces all existing days with the provided ones
export async function POST(
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
    const validatedData = upsertDaysSchema.parse(body);

    // Find template
    const template = await prisma.readingPlanTemplate.findFirst({
      where: {
        OR: [{ id }, { shortId: id }],
        deletedAt: null,
      },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Validate day numbers are unique and within totalDays
    const dayNumbers = validatedData.days.map((d) => d.dayNumber);
    if (new Set(dayNumbers).size !== dayNumbers.length) {
      return NextResponse.json(
        { error: "Day numbers must be unique" },
        { status: 400 }
      );
    }

    const maxDayNumber = Math.max(...dayNumbers);
    if (maxDayNumber > template.totalDays) {
      return NextResponse.json(
        {
          error: `Day number ${maxDayNumber} exceeds template total days (${template.totalDays})`,
        },
        { status: 400 }
      );
    }

    // Use transaction to replace all days
    const result = await prisma.$transaction(async (tx) => {
      // Delete existing days
      await tx.readingPlanTemplateDay.deleteMany({
        where: { templateId: template.id },
      });

      // Create new days
      const createdDays = await Promise.all(
        validatedData.days.map((day) => {
          const blocks: Array<Record<string, unknown>> = [];
          for (let c = day.startChapter; c <= day.endChapter; c++) {
            const isFirst = c === day.startChapter;
            const isLast = c === day.endChapter;
            blocks.push({
              bookId: day.bookId,
              chapter: c,
              startVerse: isFirst ? (day.startVerse ?? 1) : 1,
              endVerse: isLast ? (day.endVerse ?? null) : null,
              order: blocks.length,
            });
          }

          return tx.readingPlanTemplateDay.create({
            data: {
              templateId: template.id,
              dayNumber: day.dayNumber,
              passageRef: day.passageRef,
              scriptureBlocks: blocks as unknown as Prisma.InputJsonValue,
              title: day.title ?? null,
              summary: day.summary ?? null,
              reflectionPrompt: day.reflectionPrompt ?? null,
              prayerPrompt: day.prayerPrompt ?? null,
              contextIntro: day.contextIntro ?? null,
              extraMetadata: day.extraMetadata
                ? (day.extraMetadata as unknown as Prisma.InputJsonValue)
                : undefined,
            },
          });
        })
      );

      return createdDays;
    });

    return NextResponse.json(
      {
        success: true,
        templateId: template.id,
        days: result.map((d) => ({
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
    console.error("Error upserting template days:", error);
    return NextResponse.json(
      { error: "Failed to upsert template days" },
      { status: 500 }
    );
  }
}
