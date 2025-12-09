import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import {
  getCachedExplanation,
  cacheExplanation,
  type ExplanationSummary,
} from "@/lib/explanationCache";
import { CACHE_TTL_SECONDS } from "@/lib/kv";

const requestSchema = z.object({
  verseReference: z.string().min(1),
  verseText: z.string().min(1).max(5000),
});

const SYSTEM_PROMPT = `You are a careful, theologically conservative Christian Bible explainer.
Given a Bible passage (which may be one verse or multiple consecutive verses), provide a clear 2-3 sentence summary explaining its meaning in pastoral language.
Avoid taking strong positions on disputed doctrines. Stay within the text.
If multiple verses are provided, explain them as a cohesive passage rather than individually.
Return ONLY valid JSON with this exact format: { "summary": "your summary here" }`;

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
    const validatedData = requestSchema.parse(body);

    // Check cache first
    const cached = await getCachedExplanation<ExplanationSummary>(
      validatedData.verseReference,
      "summary"
    );
    if (cached) {
      return new Response(JSON.stringify({ summary: cached.summary }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
        },
      });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const userMessage = `Summarize this Bible passage:\n\nReference: ${validatedData.verseReference}\n\n"${validatedData.verseText}"`;

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
          max_tokens: 300,
          temperature: 0.7,
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!openaiResponse.ok) {
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(JSON.stringify({ error: "No summary generated" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(content);
    const explanation: ExplanationSummary = {
      summary: parsed.summary,
      disclaimer:
        "This is an AI-generated explanation and not a replacement for pastoral guidance.",
    };

    // Cache the explanation
    await cacheExplanation(validatedData.verseReference, "summary", explanation);

    return new Response(JSON.stringify({ summary: parsed.summary }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({ error: "Invalid request data" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    console.error("Error in summary endpoint:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate summary" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
