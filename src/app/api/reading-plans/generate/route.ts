import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { nanoid } from "nanoid";

import { generatePlanRequestSchema } from "@/lib/readingPlan/planGenerationTypes";
import { gatherUserContextForGeneration } from "@/lib/readingPlan/gatherUserContext";
import { generateReadingPlan, generatePassageRef } from "@/lib/readingPlan/generatePlan";

// Helper to generate slug from title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

// POST /api/reading-plans/generate
// Generate a personalized reading plan using AI
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validationResult = generatePlanRequestSchema.safeParse(body);

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

    const { topic, durationDays, includeContext } = validationResult.data;

    // Gather user context if requested
    const userContext = includeContext
      ? await gatherUserContextForGeneration(authResult.userId)
      : undefined;

    // Generate the plan using AI
    const generationResult = await generateReadingPlan({
      topic,
      durationDays,
      mode: "user", // Personal devotional mode
      userContext,
    });

    if (!generationResult.success) {
      console.error("[generate] Generation failed:", generationResult);
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
      // Create private template
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
          visibility: "private", // User-generated plans are private
          isPublished: true, // But published so the user can access them
          isFeatured: false,
          createdById: authResult.userId,
        },
      });

      // Create all days
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

      // Create user reading plan starting today
      const userPlan = await tx.userReadingPlan.create({
        data: {
          shortId: nanoid(10),
          userId: authResult.userId,
          templateId: template.id,
          startDate: new Date(),
          status: "active",
          timezone: "America/New_York", // TODO: Get from user preferences
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
    console.error("[generate] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate reading plan",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}
