import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAiContextForUser } from "@/lib/ai/userContext";
import {
  extractTraceContext,
  AIDebugEnvelopeBuilder,
  aiLogger,
  createRequestReceivedEvent,
  createModelCalledEvent,
  createResponseDeliveredEvent,
  createErrorEvent,
  estimateTokens,
} from "@/lib/observability";

const selectedVersesSchema = z.object({
  reference: z.string().min(1),      // e.g., "Romans 8:1-4"
  verseNumbers: z.array(z.number().int().positive()).min(1),
  verseText: z.string().min(1).max(5000),
});

const requestSchema = z.object({
  bookName: z.string().min(1),
  bookId: z.string().min(1),
  chapter: z.number().int().positive(),
  visibleVerses: z.array(z.number().int()).max(50).transform(arr => arr.filter(n => n > 0)),  // Filter to valid verse numbers
  visibleVerseText: z.string().max(5000).optional(),
  // Selected verse context for explanation mode
  selectedVerses: selectedVersesSchema.optional(),
});

/**
 * POST /api/bible/chat/start
 *
 * Dual-mode endpoint:
 * 1. GREETING MODE (no selectedVerses): Personalized greeting based on reading location + life context
 * 2. EXPLANATION MODE (selectedVerses provided): Quick explanation of selected verses
 */
export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();

  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extract trace context from request headers
    const traceCtx = extractTraceContext(request, clerkUserId);
    const envelope = new AIDebugEnvelopeBuilder(traceCtx);

    // Log request received event
    await aiLogger.event(
      createRequestReceivedEvent(
        traceCtx.traceId,
        traceCtx.requestId,
        traceCtx.entryPoint,
        traceCtx.userId,
        traceCtx.platform
      )
    );

    const body = await request.json();
    const validatedData = requestSchema.parse(body);

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: "AI service not configured" },
        { status: 500 }
      );
    }

    // Find our internal user (include name for personalized greeting)
    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { id: true, firstName: true, displayName: true },
    });

    // Get user's AI context including life context
    const aiContext = user ? await getAiContextForUser(user.id) : null;
    const lifeContext = aiContext?.lifeContext;
    const profileContext = aiContext?.aiProfileContext;
    const userName =
      user?.firstName?.trim() ||
      user?.displayName?.trim() ||
      aiContext?.userProfile?.firstName?.trim() ||
      aiContext?.userProfile?.displayName?.trim() ||
      undefined;

    // Set context in envelope
    envelope.setVerseContext(
      validatedData.selectedVerses?.reference || `${validatedData.bookName} ${validatedData.chapter}`,
      validatedData.selectedVerses?.verseText || validatedData.visibleVerseText
    );
    envelope.setContextReport({
      lifeContextUsed: !!lifeContext,
    });

    // Determine mode based on whether selectedVerses is provided
    const isExplanationMode = !!validatedData.selectedVerses;

    if (isExplanationMode) {
      // EXPLANATION MODE: Generate explanation for selected verses
      const selectedVerses = validatedData.selectedVerses!;
      console.log(`[Chat Start] Explanation mode for ${selectedVerses.reference}`);

      // Run explanation and question generation in parallel
      const [explanationResult, suggestedQuestions] = await Promise.all([
        generateExplanation(
          selectedVerses.reference,
          selectedVerses.verseText,
          userName,
          openaiApiKey
        ),
        generateSmartQuestions(
          {
            verseReference: selectedVerses.reference,
            verseText: selectedVerses.verseText,
            explanationStyle: profileContext?.explanationStyle,
            experienceLevel: profileContext?.experienceLevel,
            userGuidance: profileContext?.userGuidance,
            currentSeason: lifeContext?.currentSeason,
            seasonNote: lifeContext?.seasonNote,
            weeklyCarrying: lifeContext?.weeklyIntention?.carrying,
            weeklyHoping: lifeContext?.weeklyIntention?.hoping,
            prayerTopics: lifeContext?.prayerTopics,
            encouragementStyle: lifeContext?.encouragementStyle,
          },
          openaiApiKey
        ),
      ]);

      // Build and log envelope for explanation mode
      envelope.setResponse(explanationResult.summary, "explanation", 0);
      envelope.setModelCall({
        model: "gpt-4-turbo",
        temperature: 0.7,
        maxTokens: 300,
        latencyMs: Date.now() - requestStartTime,
        finishReason: "stop",
        toolCallsMade: [],
      });

      // Log envelope and response delivered event
      await Promise.all([
        aiLogger.envelope(envelope.build()),
        aiLogger.event(
          createResponseDeliveredEvent(
            traceCtx.traceId,
            traceCtx.requestId,
            explanationResult.summary.length,
            0,
            "explanation",
            Date.now() - requestStartTime
          )
        ),
      ]);

      return NextResponse.json({
        mode: "explanation" as const,
        greeting: explanationResult.summary,
        explanation: {
          summary: explanationResult.summary,
        },
        suggestedQuestions,
        _traceId: traceCtx.traceId,
      });
    } else {
      // GREETING MODE: Personalized greeting based on reading location
      const systemPrompt = buildGreetingSystemPrompt();
      const userPrompt = buildGreetingUserPrompt(
        userName,
        validatedData.bookName,
        validatedData.chapter,
        validatedData.visibleVerses,
        validatedData.visibleVerseText
      );

      console.log(`[Chat Start] Greeting mode for ${validatedData.bookName} ${validatedData.chapter}`);
      if (lifeContext?.currentSeason) {
        console.log(`[Chat Start] User season: ${lifeContext.currentSeason}`);
      }
      if (lifeContext?.weeklyIntention?.carrying) {
        console.log(`[Chat Start] User carrying: ${lifeContext.weeklyIntention.carrying}`);
      }

      // Build messages for greeting
      const greetingMessages: Array<{ role: "system" | "user"; content: string }> = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];

      // Set replay data for observability
      await envelope.setPromptArtifacts(systemPrompt, greetingMessages, []);
      envelope.setReplayData(greetingMessages, {
        model: "gpt-4-turbo",
        temperature: 0.8,
        maxTokens: 200,
      });

      // Run greeting and question generation in parallel
      const [greetingResponse, suggestedQuestions] = await Promise.all([
        fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiApiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4-turbo",
            messages: greetingMessages,
            max_tokens: 200,
            temperature: 0.8,
          }),
        }),
        generateSmartQuestions(
          {
            verseReference: `${validatedData.bookName} ${validatedData.chapter}`,
            verseText: validatedData.visibleVerseText || "",
            explanationStyle: profileContext?.explanationStyle,
            experienceLevel: profileContext?.experienceLevel,
            userGuidance: profileContext?.userGuidance,
            currentSeason: lifeContext?.currentSeason,
            seasonNote: lifeContext?.seasonNote,
            weeklyCarrying: lifeContext?.weeklyIntention?.carrying,
            weeklyHoping: lifeContext?.weeklyIntention?.hoping,
            prayerTopics: lifeContext?.prayerTopics,
            encouragementStyle: lifeContext?.encouragementStyle,
          },
          openaiApiKey
        ),
      ]);

      if (!greetingResponse.ok) {
        const errorText = await greetingResponse.text();
        console.error("OpenAI error:", errorText);

        // Log error event
        await aiLogger.event(
          createErrorEvent(
            traceCtx.traceId,
            traceCtx.requestId,
            "OpenAIError",
            errorText,
            "model_call",
            false
          )
        );

        return NextResponse.json(
          { error: "AI service error" },
          { status: 502 }
        );
      }

      const openaiData = await greetingResponse.json();
      const greeting = openaiData.choices?.[0]?.message?.content || "";

      // Build and log envelope for greeting mode
      envelope.setResponse(greeting, "greeting", 0);
      envelope.setModelCall({
        model: "gpt-4-turbo",
        temperature: 0.8,
        maxTokens: 200,
        latencyMs: Date.now() - requestStartTime,
        finishReason: openaiData.choices?.[0]?.finish_reason || "stop",
        inputTokens: openaiData.usage?.prompt_tokens,
        outputTokens: openaiData.usage?.completion_tokens,
        toolCallsMade: [],
      });

      // Log envelope and response delivered event
      await Promise.all([
        aiLogger.envelope(envelope.build()),
        aiLogger.event(
          createResponseDeliveredEvent(
            traceCtx.traceId,
            traceCtx.requestId,
            greeting.length,
            0,
            "greeting",
            Date.now() - requestStartTime
          )
        ),
      ]);

      return NextResponse.json({
        mode: "greeting" as const,
        greeting,
        suggestedQuestions,
        _traceId: traceCtx.traceId,
      });
    }
  } catch (error) {
    // Log error with trace context if available
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error in chat start endpoint:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate greeting" },
      { status: 500 }
    );
  }
}

function buildGreetingSystemPrompt(): string {
  return `You are a warm, pastoral Bible study companion. Generate a brief, welcoming greeting (2-3 sentences max) for someone who just opened a chat while reading the Bible.

GUIDELINES:
- Be warm and inviting, not formal or preachy
- Reference their current reading location naturally
- End with an open invitation to explore or ask questions
- Keep it conversational and brief
- Focus on the passage itself - do not reference the reader's personal situation
- Do NOT use generic phrases like "I'm here to help" or "How can I assist you today"
- If the reader's name is provided, you may use it naturally (e.g., "Hey Sarah, Romans 8..."), but only if it feels warm - don't force it
- Write in plain prose, no bullet points or lists

EXAMPLES OF GOOD GREETINGS:
- "Romans 8 - such a rich chapter about living in the Spirit. What's catching your attention as you read?"
- "Psalm 23 is one of those passages that meets us differently each time. What draws you here today?"
- "The Sermon on the Mount always has something new to show us. What would you like to explore?"`;
}

function buildGreetingUserPrompt(
  userName: string | undefined,
  bookName: string,
  chapter: number,
  visibleVerses: number[],
  visibleVerseText: string | undefined
): string {
  let prompt = `Generate a greeting for someone reading ${bookName} ${chapter}`;

  if (userName) {
    prompt += `.\nReader name: ${userName}`;
  }

  if (visibleVerses.length > 0) {
    const verseRange = formatVerseRange(visibleVerses);
    prompt += ` (currently viewing verses ${verseRange})`;
  }

  prompt += ".\n\n";

  if (visibleVerseText) {
    prompt += `The visible passage text:\n"${visibleVerseText.substring(0, 500)}${visibleVerseText.length > 500 ? '...' : ''}"\n\n`;
  }

  prompt += "Generate the greeting now:";

  return prompt;
}

function formatVerseRange(verses: number[]): string {
  if (verses.length === 0) return "";
  if (verses.length === 1) return String(verses[0]);

  const sorted = [...verses].sort((a, b) => a - b);
  const ranges: string[] = [];
  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === rangeEnd + 1) {
      rangeEnd = sorted[i];
    } else {
      ranges.push(rangeStart === rangeEnd ? String(rangeStart) : `${rangeStart}-${rangeEnd}`);
      rangeStart = sorted[i];
      rangeEnd = sorted[i];
    }
  }
  ranges.push(rangeStart === rangeEnd ? String(rangeStart) : `${rangeStart}-${rangeEnd}`);

  return ranges.join(", ");
}

// FALLBACK QUESTIONS
const FALLBACK_QUESTIONS = [
  "What is the main message of this passage?",
  "How does this connect to the rest of Scripture?",
  "How might this apply to daily life?"
];

// SMART QUESTION GENERATION

interface SmartQuestionContext {
  // Verse context (required)
  verseReference: string;
  verseText: string;

  // User signals (all optional)
  explanationStyle?: string;      // gentle | balanced | deep | questions
  experienceLevel?: string;       // new | growing | mature | scholar
  userGuidance?: string;          // "appreciates peaceful explanations"
  currentSeason?: string;         // anxious | grieving | thankful | etc.
  seasonNote?: string;            // Additional context about their season
  weeklyCarrying?: string;        // What they're carrying
  weeklyHoping?: string;          // What they're hoping for
  prayerTopics?: string[];        // Active prayer topics
  encouragementStyle?: string;    // gentle | encouraging | direct
}

const QUESTION_GENERATION_PROMPT = `Generate 3 short follow-up questions a Bible reader might ask about this passage.

GUIDELINES:
- Questions should be specific to THIS passage (reference characters, events, themes from the text)
- Keep questions under 12 words each
- Questions should feel natural, like what a real person would ask
- DEFAULT: All 3 questions should be verse-focused (meaning, context, connections, application)

USER CONTEXT SIGNALS:
You may receive optional signals about the reader. These can ONLY influence a question if there's an OBVIOUS, DIRECT thematic connection to the passage.

WHAT QUALIFIES AS HIGH CONFIDENCE (examples):
- Passage about anxiety/worry + user season "anxious" → YES, direct match
- Passage about God's promises + user hoping for something → MAYBE, only if passage is about hope/trust
- Passage about genealogy/history + user is traveling → NO, no connection
- Passage about forgiveness + user carrying guilt → YES, direct match
- Passage about creation + user struggling with doubt → NO, too indirect

RULES:
- Experience level/style can subtly influence question complexity, NOT topic
- Life seasons (anxious, grieving, etc.) ONLY connect if passage explicitly addresses that theme
- Prayer topics ONLY connect if passage directly speaks to that subject
- When in doubt, keep ALL 3 questions purely verse-focused

Return ONLY a JSON array with exactly 3 questions: ["question1", "question2", "question3"]`;

/**
 * Build the user context section for the prompt.
 * Only includes signals that are present.
 */
function buildUserContextSection(ctx: SmartQuestionContext): string {
  const signals: string[] = [];

  if (ctx.experienceLevel) {
    signals.push(`Bible study experience: ${ctx.experienceLevel}`);
  }
  if (ctx.explanationStyle) {
    signals.push(`Prefers ${ctx.explanationStyle} explanations`);
  }
  if (ctx.userGuidance) {
    signals.push(`User ${ctx.userGuidance}`);
  }
  if (ctx.currentSeason) {
    let seasonLine = `Current life season: ${ctx.currentSeason}`;
    if (ctx.seasonNote) seasonLine += ` (${ctx.seasonNote})`;
    signals.push(seasonLine);
  }
  if (ctx.weeklyCarrying) {
    signals.push(`Currently carrying: ${ctx.weeklyCarrying}`);
  }
  if (ctx.weeklyHoping) {
    signals.push(`Hoping for: ${ctx.weeklyHoping}`);
  }
  if (ctx.prayerTopics && ctx.prayerTopics.length > 0) {
    signals.push(`Prayer focus: ${ctx.prayerTopics.slice(0, 3).join(", ")}`);
  }

  if (signals.length === 0) return "";

  return `\n\nUSER SIGNALS (incorporate ONLY if naturally relevant to the passage):\n${signals.map(s => `- ${s}`).join("\n")}`;
}

async function generateSmartQuestions(
  ctx: SmartQuestionContext,
  openaiApiKey: string
): Promise<string[]> {
  try {
    let userPrompt = `Passage: ${ctx.verseReference}\n\n"${ctx.verseText}"`;

    // Add user context signals if any are present
    const contextSection = buildUserContextSection(ctx);
    if (contextSection) {
      userPrompt += contextSection;
    }

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4-turbo",
          messages: [
            { role: "system", content: QUESTION_GENERATION_PROMPT },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 150,
          temperature: 0.7,
        }),
      }
    );

    if (!response.ok) {
      console.error("OpenAI error in question generation:", await response.text());
      return FALLBACK_QUESTIONS;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const questions = JSON.parse(jsonMatch[0]);
      if (Array.isArray(questions) && questions.length >= 3) {
        return questions.slice(0, 3);
      }
    }

    return FALLBACK_QUESTIONS;
  } catch (error) {
    console.error("Error generating smart questions:", error);
    return FALLBACK_QUESTIONS;
  }
}

// EXPLANATION MODE FUNCTIONS

const EXPLANATION_SYSTEM_PROMPT = `You are a warm, pastoral Bible teacher. When given a Bible passage, provide a clear, accessible explanation that helps the reader understand its meaning.

GUIDELINES:
- Write in a conversational, pastoral tone (not academic or preachy)
- Keep the explanation to 3-4 sentences
- Focus on what the passage means and why it matters
- Avoid taking strong positions on disputed doctrines
- End with an invitation for the reader to reflect or ask questions
- Focus purely on explaining the passage - do not reference the reader's personal situation
- If the reader's name is provided, you may address them naturally (e.g., "Sarah, this passage shows..."), but only if it feels warm - don't force it

FORMATTING:
- Write in plain prose paragraphs
- You may use **bold** or *italic* for emphasis
- Do NOT use bullet points, numbered lists, or tables

EXAMPLES OF GOOD EXPLANATIONS:
- "This passage shows us that God's love isn't based on our performance - it's unconditional. Paul is reminding believers that nothing can separate them from this love. What a comforting truth to hold onto. What part of this speaks to you most?"
- "Here Jesus teaches about worry by pointing to how God cares for birds and flowers. The implication is clear: if God provides for them, how much more will He care for you? It's an invitation to trust. What would it look like to trust more deeply today?"`;

async function generateExplanation(
  verseReference: string,
  verseText: string,
  userName: string | undefined,
  openaiApiKey: string
): Promise<{ summary: string }> {
  // Focus purely on the passage - no personal context in the explanation
  const userPrompt = `Explain this Bible passage:\n\nReference: ${verseReference}\n\n"${verseText}"${userName ? `\n\nReader name (optional): ${userName}` : ""}`;

  const openaiResponse = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: EXPLANATION_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    }
  );

  if (!openaiResponse.ok) {
    console.error("OpenAI error in explanation:", await openaiResponse.text());
    throw new Error("Failed to generate explanation");
  }

  const openaiData = await openaiResponse.json();
  const summary = openaiData.choices?.[0]?.message?.content || "";

  return { summary };
}
