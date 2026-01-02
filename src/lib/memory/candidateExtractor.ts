/**
 * Memory Candidate Extractor
 *
 * Uses a small/fast LLM to extract memory candidates from conversations.
 * Candidates are constrained to closed vocabularies defined in vocabularies.ts.
 *
 * This runs AFTER the main response is generated (Step 5 in pipeline).
 * Candidates are ephemeral - they only become durable memories after
 * passing through the signal evaluation process.
 */

import {
  STRUGGLE_THEMES,
  FAITH_STAGES,
  MEMORY_CONFIG,
  isValidStruggleTheme,
  isValidFaithStage,
  type StruggleTheme,
  type FaithStage,
} from "./vocabularies";

// =============================================================================
// Types
// =============================================================================

export interface ExtractionContext {
  /** The user's message */
  message: string;
  /** The assistant's response */
  assistantResponse: string;
  /** Optional: rolling conversation summary for additional context */
  conversationSummary?: string;
}

export type MemoryCandidate =
  | {
      type: "struggle_theme";
      value: StruggleTheme;
      confidence: number;
      evidence: string;
    }
  | {
      type: "faith_stage";
      value: FaithStage;
      confidence: number;
      evidence: string;
    };

interface ExtractionResponse {
  candidates: Array<{
    type: string;
    value: string;
    confidence: number;
    evidence: string;
  }>;
}

// =============================================================================
// Extraction System Prompt
// =============================================================================

const EXTRACTION_SYSTEM_PROMPT = `You are analyzing a Bible study conversation to identify stable or recurring user characteristics.

## Your Task
Analyze the USER's message (not the assistant's response) to identify potential durable facts about them.

## IMPORTANT RULES
1. Only output values from the CLOSED LISTS below. Do NOT invent new values.
2. Only extract if there's CLEAR EVIDENCE in what the USER said.
3. Look for explicit statements ("I'm struggling with...", "I've been feeling...", "I always...")
4. Do NOT infer from the Bible passage being discussed - only from what the USER reveals about themselves.
5. Maximum 2 candidates per extraction.
6. If nothing qualifies, return empty candidates array.

## Confidence Guidelines
- 0.8-1.0: Explicit identity statement ("I struggle with fear of failure", "I'm in a season of rebuilding")
- 0.7-0.8: Strong implication with recurring language ("again", "always", "I keep...")
- Below 0.7: Do not include (too weak)

## CLOSED VOCABULARY - STRUGGLE THEMES
${STRUGGLE_THEMES.map((t) => `- ${t}`).join("\n")}

## CLOSED VOCABULARY - FAITH STAGES
${FAITH_STAGES.map((s) => `- ${s}`).join("\n")}

## Output Format (JSON only)
{
  "candidates": [
    {
      "type": "struggle_theme" | "faith_stage",
      "value": "<value from closed list above>",
      "confidence": 0.7-1.0,
      "evidence": "<direct quote or paraphrase from user message>"
    }
  ]
}

If no candidates meet the criteria, output:
{ "candidates": [] }`;

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract memory candidates from a conversation turn.
 *
 * @param context - The conversation context to analyze
 * @returns Array of validated memory candidates (max 2)
 */
export async function extractCandidates(
  context: ExtractionContext
): Promise<MemoryCandidate[]> {
  const prompt = buildExtractionPrompt(context);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 300,
        reasoning_effort: "minimal", // Minimize reasoning to preserve tokens for output
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.error(
        "[CandidateExtractor] API error:",
        response.status,
        await response.text()
      );
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.warn("[CandidateExtractor] No content in response");
      return [];
    }

    const parsed = JSON.parse(content) as ExtractionResponse;
    return validateAndFilterCandidates(parsed.candidates || []);
  } catch (error) {
    console.error("[CandidateExtractor] Extraction failed:", error);
    return [];
  }
}

// =============================================================================
// Internal Helpers
// =============================================================================

function buildExtractionPrompt(context: ExtractionContext): string {
  const parts: string[] = [];

  parts.push(`## User Message\n"${context.message}"`);

  if (context.conversationSummary) {
    parts.push(`\n## Conversation Context\n${context.conversationSummary}`);
  }

  parts.push("\n## Task\nExtract memory candidates from the user message:");

  return parts.join("\n");
}

function validateAndFilterCandidates(
  rawCandidates: ExtractionResponse["candidates"]
): MemoryCandidate[] {
  const validated: MemoryCandidate[] = [];

  for (const candidate of rawCandidates) {
    // Skip low confidence candidates
    if (candidate.confidence < MEMORY_CONFIG.MIN_EXTRACTION_CONFIDENCE) {
      continue;
    }

    // Validate struggle_theme
    if (candidate.type === "struggle_theme") {
      if (isValidStruggleTheme(candidate.value)) {
        validated.push({
          type: "struggle_theme",
          value: candidate.value as StruggleTheme,
          confidence: candidate.confidence,
          evidence: candidate.evidence || "",
        });
      } else {
        console.warn(
          `[CandidateExtractor] Invalid struggle theme: ${candidate.value}`
        );
      }
    }

    // Validate faith_stage
    else if (candidate.type === "faith_stage") {
      if (isValidFaithStage(candidate.value)) {
        validated.push({
          type: "faith_stage",
          value: candidate.value as FaithStage,
          confidence: candidate.confidence,
          evidence: candidate.evidence || "",
        });
      } else {
        console.warn(
          `[CandidateExtractor] Invalid faith stage: ${candidate.value}`
        );
      }
    }

    // Unknown type
    else {
      console.warn(`[CandidateExtractor] Unknown candidate type: ${candidate.type}`);
    }
  }

  // Enforce max candidates per turn
  return validated.slice(0, MEMORY_CONFIG.MAX_CANDIDATES_PER_TURN);
}
