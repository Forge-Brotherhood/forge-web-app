import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { nanoid } from "nanoid";

import { generateFullFromOutlineRequestSchema } from "@/lib/readingPlan/planGenerationTypes";
import { gatherUserContextForGeneration } from "@/lib/readingPlan/gatherUserContext";
import { generateFullPlanFromOutline, generatePassageRef } from "@/lib/readingPlan/generatePlan";
import type { ScriptureBlock } from "@/lib/readingPlan/planGenerationTypes";

// Helper to generate slug from title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

// POST /api/reading-plans/generate-full
// Generate full plan from outline (stage 2) and save to DB
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validationResult = generateFullFromOutlineRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request data",
          code: "VALIDATION_ERROR",
          details: validationResult.error.issues,
        },
        { status: 400 }
      );
    }

    const { outline, modifications } = validationResult.data;

    // Gather user context for personalized content
    const userContext = await gatherUserContextForGeneration(authResult.userId);

    // Generate full plan from outline
    const generationResult = await generateFullPlanFromOutline(
      outline,
      {
        topic: outline.template.title, // Use outline title as topic
        durationDays: outline.template.totalDays,
        mode: "user",
        userContext,
      },
      modifications
    );

    if (!generationResult.success) {
      console.error("[generate-full] Generation failed:", generationResult);
      return NextResponse.json(
        {
          success: false,
          error: generationResult.error,
          code: generationResult.code,
          details: generationResult.details,
        },
        { status: 500 }
      );
    }

    const { plan, passageRefs } = generationResult;

    // Generate unique slug
    let slug = generateSlug(plan.template.title);
    const existingSlug = await prisma.readingPlanTemplate.findUnique({
      where: { slug },
    });
    if (existingSlug) {
      slug = `${slug}-${nanoid(6)}`;
    }

    // Create template, days, and user plan in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const template = await tx.readingPlanTemplate.create({
        data: {
          shortId: nanoid(10),
          slug,
          title: plan.template.title,
          subtitle: plan.template.subtitle || null,
          description: plan.template.description || null,
          totalDays: plan.template.totalDays,
          estimatedMinutesMin: plan.template.estimatedMinutesMin,
          estimatedMinutesMax: plan.template.estimatedMinutesMax,
          theme: plan.template.theme || null,
          visibility: "private",
          isPublished: true,
          isFeatured: false,
          createdById: authResult.userId,
        },
      });

      const daysData = plan.days.map((day, index) => ({
        templateId: template.id,
        dayNumber: day.dayNumber,
        scriptureBlocks: day.scriptureBlocks,
        passageRef: passageRefs[index],
        title: day.title,
        summary: day.summary,
        reflectionPrompt: day.reflectionPrompt,
        prayerPrompt: day.prayerPrompt,
        contextIntro: day.contextIntro,
      }));

      await tx.readingPlanTemplateDay.createMany({
        data: daysData,
      });

      const userPlan = await tx.userReadingPlan.create({
        data: {
          shortId: nanoid(10),
          userId: authResult.userId,
          templateId: template.id,
          startDate: new Date(),
          status: "active",
          timezone: "America/New_York",
          notifyDaily: true,
        },
      });

      return { template, userPlan };
    });

    return NextResponse.json(
      {
        success: true,
        plan: {
          id: result.userPlan.id,
          shortId: result.userPlan.shortId,
          template: {
            id: result.template.id,
            shortId: result.template.shortId,
            title: result.template.title,
            subtitle: result.template.subtitle,
            totalDays: result.template.totalDays,
            theme: result.template.theme,
          },
          startDate: result.userPlan.startDate.toISOString(),
          status: result.userPlan.status,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request data",
          code: "VALIDATION_ERROR",
          details: error.issues,
        },
        { status: 400 }
      );
    }
    console.error("[generate-full] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate full plan",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}
