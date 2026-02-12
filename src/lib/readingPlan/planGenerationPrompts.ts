/**
 * Reading Plan Generation Prompts
 *
 * System prompts and user context injection for AI-generated reading plans.
 */

import { BIBLE_BOOK_IDS, type UserContextForGeneration, type GenerationMode, type PlanOutline } from "./planGenerationTypes";

/**
 * Base system prompt for reading plan generation
 */
const BASE_SYSTEM_PROMPT = `You are a Bible reading plan generator for a Christian devotional app.

You must respond with valid JSON matching this exact structure:
{
  "template": {
    "title": "string - compelling, spiritually meaningful title for the plan",
    "subtitle": "string or null - optional subtitle that adds context",
    "description": "string - 4-6 sentence description explaining what the plan covers and what readers will gain",
    "totalDays": number,
    "estimatedMinutesMin": number (typically 10-15),
    "estimatedMinutesMax": number (typically 15-20),
    "theme": "string or null - optional theme"
  },
  "days": [
    {
      "dayNumber": number starting at 1,
      "scriptureBlocks": [
        {
          "bookId": "3-letter book code (ROM, PHP, GEN, etc.)",
          "chapter": number,
          "startVerse": number or null (null = start of chapter),
          "endVerse": number or null (null = end of chapter),
          "order": 0
        }
      ],
      "title": "engaging title for the day's reading",
      "summary": "5-7 sentences explaining the passage and its significance",
      "reflectionPrompt": "thoughtful question for personal application",
      "prayerPrompt": "specific prayer direction related to the passage",
      "contextIntro": "5-7 sentences of historical/cultural background"
    }
  ]
}

SCRIPTURE REFERENCE RULES:
- Use ONLY these book IDs: ${BIBLE_BOOK_IDS.join(", ")}
- scriptureBlocks array supports non-contiguous ranges (multiple blocks per day)
- For contiguous passage: single block with startVerse and endVerse
- For non-contiguous (e.g., skipping genealogy): use multiple blocks with incrementing order
- startVerse/endVerse as null = from/to chapter boundary
- Each day: 5-30 verses typically (one chapter maximum)

PASSAGE LENGTH REQUIREMENTS:
- NEVER use single verse readings
- Minimum: 5+ verses for adequate context
- Maximum: one chapter per day
- Choose natural thought units (complete conversations, arguments, narratives)

CONTENT GUIDELINES:
- Warm, pastoral tone that is theologically sound
- Each day should build on previous days where possible
- Reflection prompts encourage personal introspection
- Prayer prompts are specific to passage themes
- For plans >14 days: keep summary/contextIntro to 3-4 sentences`;

/**
 * Additional prompt for user-facing (personal) plan generation
 */
const USER_MODE_ADDITION = `

AUDIENCE: This is for PERSONAL devotional use by an individual believer.
- Write in second person ("you") addressing the reader directly
- Reflection prompts are for personal journaling
- Prayer prompts guide individual prayer time
- Make the plan feel like a personal journey tailored to them`;

/**
 * Additional prompt for admin (group) plan generation
 */
const ADMIN_MODE_ADDITION = `

AUDIENCE: This is for CHRISTIAN believers in a GROUP SETTING.
- Write with group discussion in mind
- Reflection prompts should encourage both personal introspection AND group discussion
- Prayer prompts should encourage praying for one another
- Make the plan suitable for small group Bible study`;

/**
 * Build the complete system prompt based on mode
 */
export function buildSystemPrompt(mode: GenerationMode): string {
  let prompt = BASE_SYSTEM_PROMPT;

  if (mode === "user") {
    prompt += USER_MODE_ADDITION;
  } else {
    prompt += ADMIN_MODE_ADDITION;
  }

  return prompt;
}

/**
 * Build user context block for prompt injection
 */
export function buildUserContextBlock(context: UserContextForGeneration): string {
  const lines: string[] = [];
  lines.push("<user_context>");

  // Name for personalization
  if (context.name) {
    lines.push(`Name: ${context.name}`);
  }

  // Experience level affects depth
  if (context.experienceLevel) {
    const levelDescriptions: Record<string, string> = {
      new: "New to the Bible. Use accessible language, provide more context and background.",
      growing: "Growing faith. Balance depth with accessibility.",
      mature: "Mature believer. Can handle deeper theological concepts.",
      scholar: "Deep Bible knowledge. Can include scholarly insights and original language references.",
    };
    lines.push(`Experience: ${levelDescriptions[context.experienceLevel] || context.experienceLevel}`);
  }

  // Explanation style
  if (context.explanationStyle) {
    const styleDescriptions: Record<string, string> = {
      gentle: "Prefers gentle, encouraging explanations.",
      balanced: "Appreciates balanced explanations with application.",
      deep: "Enjoys deep theological exploration.",
      questions: "Learns best through thought-provoking questions.",
    };
    lines.push(`Style: ${styleDescriptions[context.explanationStyle] || context.explanationStyle}`);
  }

  // Current life season
  if (context.currentSeason) {
    const seasonNote = context.seasonNote ? ` (${context.seasonNote})` : "";
    lines.push(`Current season: ${context.currentSeason}${seasonNote}`);
  }

  // Weekly carrying/hoping
  if (context.weeklyCarrying) {
    lines.push(`Currently carrying: ${context.weeklyCarrying}`);
  }
  if (context.weeklyHoping) {
    lines.push(`Hoping for: ${context.weeklyHoping}`);
  }

  // Prayer topics
  if (context.prayerTopics.length > 0) {
    lines.push(`Prayer topics: ${context.prayerTopics.slice(0, 5).join(", ")}`);
  }

  // Spiritual goals
  if (context.goals.length > 0) {
    lines.push(`Goals: ${context.goals.slice(0, 3).join(", ")}`);
  }

  // Memory notes (AI-captured insights about the user)
  if (context.memoryNotes.length > 0) {
    lines.push("");
    lines.push("Recent memories:");
    for (const note of context.memoryNotes.slice(0, 5)) {
      lines.push(`- ${note}`);
    }
  }

  // Bible engagement history
  if (context.recentHighlights.length > 0 || context.recentNotes.length > 0) {
    lines.push("");
    lines.push("Bible engagement:");

    // Highlighted verses
    for (const h of context.recentHighlights.slice(0, 5)) {
      lines.push(`- Highlighted: ${h.bookId} ${h.chapter}:${h.verse}`);
    }

    // Notes on passages
    for (const n of context.recentNotes.slice(0, 3)) {
      const preview = n.content.length > 50 ? n.content.slice(0, 50) + "..." : n.content;
      lines.push(`- Notes on ${n.bookId} ${n.chapter}: "${preview}"`);
    }

    // Frequent books
    if (context.frequentBooks.length > 0) {
      const topBooks = context.frequentBooks
        .slice(0, 3)
        .map(b => b.bookId)
        .join(", ");
      lines.push(`- Frequently reads: ${topBooks}`);

      // Identify gaps (books not in frequent list for exploration suggestions)
      const frequentSet = new Set(context.frequentBooks.map(b => b.bookId));
      const potentialGaps = BIBLE_BOOK_IDS.filter(b => !frequentSet.has(b));
      if (potentialGaps.length > 0) {
        lines.push(`- Hasn't explored: ${potentialGaps.slice(0, 5).join(", ")}`);
      }
    }
  }

  // Previous reflections
  if (context.recentReflections.length > 0) {
    lines.push("");
    lines.push("Previous reflections:");
    for (const r of context.recentReflections.slice(0, 3)) {
      const preview = r.content.length > 80 ? r.content.slice(0, 80) + "..." : r.content;
      lines.push(`- "${preview}"`);
    }
  }

  lines.push("</user_context>");
  lines.push("");
  lines.push(`Use this context to create a deeply personalized reading plan that:
1. Addresses their current emotional/spiritual state
2. Builds on passages they've already engaged with
3. Introduces new but relevant scripture they haven't explored
4. Connects to their prayer topics and goals
5. Matches their experience level and preferred style`);

  return lines.join("\n");
}

// --- Outline prompts (two-stage generation) ---

/**
 * Base system prompt for outline-only generation
 */
const BASE_OUTLINE_SYSTEM_PROMPT = `You are a Bible reading plan generator for a Christian devotional app.

You must respond with valid JSON matching this exact structure:
{
  "template": {
    "title": "string - compelling, spiritually meaningful title for the plan",
    "subtitle": "string or null - optional subtitle that adds context",
    "description": "string - 4-6 sentence description explaining what the plan covers and what readers will gain",
    "totalDays": number,
    "estimatedMinutesMin": number (typically 10-15),
    "estimatedMinutesMax": number (typically 15-20),
    "theme": "string or null - optional theme"
  },
  "days": [
    {
      "dayNumber": number starting at 1,
      "title": "engaging title for the day's reading",
      "description": "1-2 sentence summary of what this day covers",
      "scriptureBlocks": [
        {
          "bookId": "3-letter book code (ROM, PHP, GEN, etc.)",
          "chapter": number,
          "startVerse": number or null (null = start of chapter),
          "endVerse": number or null (null = end of chapter),
          "order": 0
        }
      ]
    }
  ]
}

IMPORTANT: Only generate the OUTLINE — day titles, short descriptions, and scripture references.
Do NOT generate summaries, contextIntro, reflectionPrompt, or prayerPrompt. Those will be added later.

SCRIPTURE REFERENCE RULES:
- Use ONLY these book IDs: ${BIBLE_BOOK_IDS.join(", ")}
- scriptureBlocks array supports non-contiguous ranges (multiple blocks per day)
- For contiguous passage: single block with startVerse and endVerse
- For non-contiguous (e.g., skipping genealogy): use multiple blocks with incrementing order
- startVerse/endVerse as null = from/to chapter boundary
- Each day: 5-30 verses typically (one chapter maximum)

PASSAGE LENGTH REQUIREMENTS:
- NEVER use single verse readings
- Minimum: 5+ verses for adequate context
- Maximum: one chapter per day
- Choose natural thought units (complete conversations, arguments, narratives)

CONTENT GUIDELINES:
- Warm, pastoral tone that is theologically sound
- Each day should build on previous days where possible`;

/**
 * Build the outline system prompt based on mode
 */
export function buildOutlineSystemPrompt(mode: GenerationMode): string {
  let prompt = BASE_OUTLINE_SYSTEM_PROMPT;

  if (mode === "user") {
    prompt += USER_MODE_ADDITION;
  } else {
    prompt += ADMIN_MODE_ADDITION;
  }

  return prompt;
}

/**
 * System prompt for generating full content from an approved outline
 */
export const FULL_FROM_OUTLINE_SYSTEM_PROMPT = `You are a Bible reading plan content writer for a Christian devotional app.

You will be given an APPROVED plan outline with day titles, descriptions, and scripture references already chosen.
Your job is to generate the detailed content for each day.

You must respond with valid JSON matching this exact structure:
{
  "template": {
    "title": "string (keep from outline)",
    "subtitle": "string or null (keep from outline)",
    "description": "string (keep from outline)",
    "totalDays": number (keep from outline),
    "estimatedMinutesMin": number (keep from outline),
    "estimatedMinutesMax": number (keep from outline),
    "theme": "string or null (keep from outline)"
  },
  "days": [
    {
      "dayNumber": number (keep from outline),
      "scriptureBlocks": [...] (keep EXACTLY from outline),
      "title": "string (keep from outline)",
      "summary": "5-7 sentences explaining the passage and its significance",
      "reflectionPrompt": "thoughtful question for personal application",
      "prayerPrompt": "specific prayer direction related to the passage",
      "contextIntro": "5-7 sentences of historical/cultural background"
    }
  ]
}

CRITICAL RULES:
- Keep the template fields EXACTLY as provided in the outline
- Keep each day's scriptureBlocks, dayNumber, and title EXACTLY as provided
- Focus your creative energy on writing excellent summary, contextIntro, reflectionPrompt, and prayerPrompt
- For plans >14 days: keep summary/contextIntro to 3-4 sentences

CONTENT GUIDELINES:
- Warm, pastoral tone that is theologically sound
- Each day should build on previous days where possible
- Reflection prompts encourage personal introspection
- Prayer prompts are specific to passage themes
- Summary should help readers understand what they're about to read
- Context intro should provide meaningful historical/cultural background`;

/**
 * Build the user prompt for full generation from outline
 */
export function buildFullGenerationUserPrompt(
  outline: PlanOutline,
  modifications?: string,
  userContext?: UserContextForGeneration
): string {
  let prompt = `Generate full content for this approved reading plan outline:\n\n${JSON.stringify(outline, null, 2)}`;

  if (modifications) {
    prompt += `\n\nThe user requested these modifications:\n${modifications}`;
  }

  if (userContext) {
    prompt += "\n\n" + buildUserContextBlock(userContext);
  }

  return prompt;
}

/**
 * Build the user prompt (the actual request)
 */
export function buildUserPrompt(
  topic: string,
  durationDays: number,
  userContext?: UserContextForGeneration
): string {
  let prompt = `Create a ${durationDays}-day Bible reading plan on the topic: "${topic}"`;

  if (userContext) {
    prompt += "\n\n" + buildUserContextBlock(userContext);
  }

  return prompt;
}
