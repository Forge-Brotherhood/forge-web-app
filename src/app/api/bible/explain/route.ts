import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import {
  getCachedExplanation,
  cacheExplanation,
  type ExplanationFull,
} from "@/lib/explanationCache";
import { CACHE_TTL_SECONDS } from "@/lib/kv";

const explainSchema = z.object({
  verseReference: z.string().min(1),
  verseText: z.string().min(1).max(5000),
});

const SYSTEM_PROMPT = `You are a careful, theologically conservative Christian Bible explainer.
Explain the passage in clear, pastoral language.
Avoid taking strong positions on disputed doctrines.
Stay within the text and provide historical and cultural context.

Return your answer in structured JSON with these exact keys:
- summary: A clear 2-3 sentence explanation of the passage's meaning
- historical_context: A paragraph explaining the historical, cultural, and literary context of this passage (who wrote it, when, to whom, what was happening at the time, relevant customs or practices)
- cross_references: Array of objects with "ref" (Bible reference) and "note" (brief explanation of connection)
- disclaimer: Always include "This is an AI-generated explanation and not a replacement for pastoral guidance."

Respond ONLY with valid JSON, no markdown or other formatting.`;

// Response schema for validation
const explanationResponseSchema = z.object({
  summary: z.string(),
  historical_context: z.string(),
  cross_references: z.array(
    z.object({
      ref: z.string(),
      note: z.string(),
    })
  ),
  disclaimer: z.string(),
});

// POST /api/bible/explain
// Returns a structured AI explanation of a Bible verse using OpenAI
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const validatedData = explainSchema.parse(body);

    // Check cache first
    const cached = await getCachedExplanation<ExplanationFull>(
      validatedData.verseReference,
      "full"
    );
    if (cached) {
      return new Response(JSON.stringify({ explanation: cached }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
        },
      });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      console.error("OPENAI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Create the user message
    const userMessage = `Please explain this Bible passage:

Reference: ${validatedData.verseReference}

"${validatedData.verseText}"`;

    // Call OpenAI (non-streaming for structured JSON response)
    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          max_tokens: 1500,
          temperature: 0.7,
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error("OpenAI API error:", errorText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content;

    if (!content) {
      console.error("No content in OpenAI response");
      return new Response(
        JSON.stringify({ error: "No explanation generated" }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Parse and validate the JSON response
    let explanation: ExplanationFull;
    try {
      explanation = JSON.parse(content);
      // Validate against our schema
      explanation = explanationResponseSchema.parse(explanation);
    } catch (parseError) {
      console.error("Failed to parse OpenAI JSON response:", parseError);
      console.error("Raw content:", content);
      return new Response(
        JSON.stringify({ error: "Failed to parse explanation" }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Cache the explanation
    await cacheExplanation(validatedData.verseReference, "full", explanation);

    return new Response(JSON.stringify({ explanation }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({ error: "Invalid request data", details: error.issues }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    console.error("Error in explain endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate explanation" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
