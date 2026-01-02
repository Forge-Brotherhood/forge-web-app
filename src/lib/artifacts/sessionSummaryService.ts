/**
 * Session Summary Service
 *
 * Generates structured, retrieval-optimized conversation summaries.
 * Can be called from debug runs, production conversations, or any context.
 */

import { createArtifact } from "./artifactService";

// =============================================================================
// Types
// =============================================================================

export type SessionTurn = {
  role: "user" | "assistant";
  content: string;
};

export interface SessionForSummary {
  sessionId: string;
  userId: string;
  startedAtISO: string;
  endedAtISO: string;
  turns: SessionTurn[];
}

export interface SessionSummaryOutput {
  oneSentenceSummary: string;
  summary: string;
  topics: string[];
  scriptureRefs: string[];
  openQuestions: string[];
  userExpressedConcerns: string[];
  suggestedResumePrompt: string;
}

export interface GenerateSessionSummaryInput {
  userId: string;
  sessionId: string;
  turns: Array<{ role: string; content: string }>;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Prompts
// =============================================================================

const SESSION_SUMMARY_SYSTEM_PROMPT = `
You are generating a "Conversation Session Summary" artifact for a faith-based chat app.

This artifact will be:
- saved and shown later in a "Recent Conversations" list
- retrieved by semantic search to resume the conversation
- injected into a future LLM prompt as context

PRIMARY GOAL:
Produce a resumable record of THIS specific conversation (not a general article about the topic).

STYLE:
- Concise, factual, grounded in the turns
- Neutral pastoral tone
- Focus on what the user asked, what was explained, and what remains open
- Do not write an encyclopedia entry; write a "what happened in this session" record

BOUNDARIES:
- Do NOT infer personality traits, diagnoses, or stable struggles unless explicitly stated in this session.
- Do NOT label the user (avoid "the user struggles with X"). Prefer: "The user said..." or "The user asked..."
- Do NOT invent scripture references, dates, or historical claims beyond what appears in the turns.
- If the user asked multiple questions, prioritize the most central 1–2.
- Prefer returning empty arrays rather than guessing.

OUTPUT:
Return ONLY valid JSON that matches the provided schema exactly (no markdown, no extra keys).
`.trim();

function buildSessionSummaryPrompt(session: SessionForSummary): string {
  return `
SESSION:
- sessionId: ${session.sessionId}
- startedAt: ${session.startedAtISO}
- endedAt: ${session.endedAtISO}

CONVERSATION TURNS (chronological):
${session.turns.map((t, i) => `Turn ${i + 1} — ${t.role.toUpperCase()}: ${t.content}`).join("\n")}

TASK:
Generate a "session summary artifact" that makes it easy to:
1) recognize what this session was about at a glance
2) resume the conversation naturally later
3) retrieve it via search (topics + scripture references)

IMPORTANT:
- Summarize THIS session (what the user asked + what was answered), not general background.
- Capture the user's main curiosity and the assistant's main explanation.
- Include any unresolved questions or natural next step.
- Keep topics as short phrases (2–5 words each). Include key proper nouns if relevant.

SCHEMA (return JSON only, exact keys, no extras):
{
  "oneSentenceSummary": string,            // One sentence describing THIS session's focus (not generic)
  "summary": string,                       // 3–5 sentences capturing: user ask → assistant answer → what remains open
  "topics": string[],                      // 3–7 short phrases that would help retrieval
  "scriptureRefs": string[],               // Scripture references explicitly mentioned (e.g., "Romans 8" or "Romans 8:1-11")
  "openQuestions": string[],               // Unresolved questions explicitly asked by the user (or implied next question if none explicit)
  "userExpressedConcerns": string[],       // The user's own phrasing about their concern/confusion (no labels), max 3
  "suggestedResumePrompt": string          // A single question the assistant could ask next time to continue naturally
}

FIELD RULES:
- oneSentenceSummary: must mention the primary topic (e.g., "Romans 8") if present.
- summary: must include (a) what user requested, (b) what assistant provided, (c) the most natural continuation.
- topics: must include key entities when present (book/chapter, people, places).
- scriptureRefs: ONLY include refs that are present in the turns. If none, return [].
- openQuestions: If the user asked nothing explicit, include one inferred "next step" question phrased cautiously.
- userExpressedConcerns: Only if the user expressed confusion/concern in their own words; else [].
- suggestedResumePrompt: must be a question; avoid being pushy; 1 sentence.

Now produce the JSON object.
`.trim();
}

// =============================================================================
// Pre-processing
// =============================================================================

function prepareSessionForSummary(
  input: GenerateSessionSummaryInput
): SessionForSummary {
  // Cap to last 30 turns
  const cappedTurns = input.turns.slice(-30);

  // Filter out very short acknowledgements from user
  const filteredTurns = cappedTurns.filter(
    (t) => t.content.length > 10 || t.role === "assistant"
  );

  return {
    sessionId: input.sessionId,
    userId: input.userId,
    startedAtISO: new Date().toISOString(),
    endedAtISO: new Date().toISOString(),
    turns: filteredTurns.map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.content,
    })),
  };
}

// =============================================================================
// Main Service Function
// =============================================================================

/**
 * Generate a structured session summary from conversation turns.
 * Returns the parsed summary output without creating an artifact.
 */
export async function generateSessionSummary(
  input: GenerateSessionSummaryInput
): Promise<SessionSummaryOutput> {
  const session = prepareSessionForSummary(input);

  if (session.turns.length === 0) {
    throw new Error("No valid turns to summarize");
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SESSION_SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: buildSessionSummaryPrompt(session) },
      ],
      max_tokens: 500,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No content in OpenAI response");
  }

  const parsed = JSON.parse(content) as SessionSummaryOutput;

  // Ensure arrays exist even if not returned by model
  return {
    oneSentenceSummary: parsed.oneSentenceSummary || "",
    summary: parsed.summary || "",
    topics: parsed.topics || [],
    scriptureRefs: parsed.scriptureRefs || [],
    openQuestions: parsed.openQuestions || [],
    userExpressedConcerns: parsed.userExpressedConcerns || [],
    suggestedResumePrompt: parsed.suggestedResumePrompt || "",
  };
}

// =============================================================================
// Convenience: Generate and Create Artifact
// =============================================================================

/**
 * Generate a structured session summary and create an artifact.
 * This is the main entry point for creating session summary artifacts.
 */
export async function generateAndCreateSessionSummaryArtifact(
  input: GenerateSessionSummaryInput
): Promise<void> {
  const session = prepareSessionForSummary(input);
  const summary = await generateSessionSummary(input);

  await createArtifact({
    userId: input.userId,
    sessionId: input.sessionId,
    type: "conversation_session_summary",
    scope: "private",
    title: summary.oneSentenceSummary,
    content: summary.summary,
    scriptureRefs:
      summary.scriptureRefs.length > 0 ? summary.scriptureRefs : undefined,
    tags: summary.topics.length > 0 ? summary.topics : undefined,
    metadata: {
      ...input.metadata,
      turnCount: session.turns.length,
      openQuestions: summary.openQuestions,
      userExpressedConcerns: summary.userExpressedConcerns,
      suggestedResumePrompt: summary.suggestedResumePrompt,
      generatedAt: new Date().toISOString(),
    },
  });
}
