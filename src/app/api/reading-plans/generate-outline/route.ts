import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { z } from "zod";

import { generateOutlineRequestSchema } from "@/lib/readingPlan/planGenerationTypes";
import { gatherUserContextForGeneration } from "@/lib/readingPlan/gatherUserContext";
import { generatePlanOutline } from "@/lib/readingPlan/generatePlan";

// POST /api/reading-plans/generate-outline
// Generate a plan outline (stage 1) using AI
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validationResult = generateOutlineRequestSchema.safeParse(body);

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

    // Generate the outline
    const result = await generatePlanOutline({
      topic,
      durationDays,
      mode: "user",
      userContext,
    });

    if (!result.success) {
      console.error("[generate-outline] Generation failed:", result);
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          code: result.code,
          details: result.details,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      outline: result.outline,
      passageRefs: result.passageRefs,
    });
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
    console.error("[generate-outline] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate plan outline",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}
