/**
 * Reading Plan Generation
 *
 * Core logic for AI-powered reading plan generation using OpenAI.
 */

import {
  generatedPlanSchema,
  planOutlineSchema,
  type GeneratedPlan,
  type GeneratePlanInput,
  type PlanOutline,
  type ScriptureBlock,
} from "./planGenerationTypes";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildOutlineSystemPrompt,
  buildFullGenerationUserPrompt,
  FULL_FROM_OUTLINE_SYSTEM_PROMPT,
} from "./planGenerationPrompts";

// Book code to human-readable name mapping (duplicated from admin app for independence)
const BOOK_CODE_TO_NAME: Record<string, string> = {
  GEN: "Genesis", EXO: "Exodus", LEV: "Leviticus", NUM: "Numbers", DEU: "Deuteronomy",
  JOS: "Joshua", JDG: "Judges", RUT: "Ruth", "1SA": "1 Samuel", "2SA": "2 Samuel",
  "1KI": "1 Kings", "2KI": "2 Kings", "1CH": "1 Chronicles", "2CH": "2 Chronicles",
  EZR: "Ezra", NEH: "Nehemiah", EST: "Esther", JOB: "Job", PSA: "Psalms", PRO: "Proverbs",
  ECC: "Ecclesiastes", SNG: "Song of Solomon", ISA: "Isaiah", JER: "Jeremiah",
  LAM: "Lamentations", EZK: "Ezekiel", DAN: "Daniel", HOS: "Hosea", JOL: "Joel",
  AMO: "Amos", OBA: "Obadiah", JON: "Jonah", MIC: "Micah", NAM: "Nahum", HAB: "Habakkuk",
  ZEP: "Zephaniah", HAG: "Haggai", ZEC: "Zechariah", MAL: "Malachi",
  MAT: "Matthew", MRK: "Mark", LUK: "Luke", JHN: "John", ACT: "Acts", ROM: "Romans",
  "1CO": "1 Corinthians", "2CO": "2 Corinthians", GAL: "Galatians", EPH: "Ephesians",
  PHP: "Philippians", COL: "Colossians", "1TH": "1 Thessalonians", "2TH": "2 Thessalonians",
  "1TI": "1 Timothy", "2TI": "2 Timothy", TIT: "Titus", PHM: "Philemon", HEB: "Hebrews",
  JAS: "James", "1PE": "1 Peter", "2PE": "2 Peter", "1JN": "1 John", "2JN": "2 John",
  "3JN": "3 John", JUD: "Jude", REV: "Revelation",
};

function getBookName(bookId: string): string {
  return BOOK_CODE_TO_NAME[bookId.toUpperCase()] || bookId;
}

/**
 * Generate human-readable passageRef from scripture blocks.
 *
 * Examples:
 * - Single range: "Romans 8:1-17"
 * - Same chapter, multiple ranges: "1 Samuel 17:1-11, 32-50"
 * - Multiple chapters from same book: "Matthew 5:1-12; 6:9-13"
 */
function generatePassageRef(blocks: ScriptureBlock[]): string {
  if (blocks.length === 0) return "";

  const sortedBlocks = [...blocks].sort((a, b) => a.order - b.order);

  // Group blocks by book
  const bookOrder: string[] = [];
  const bookGroups = new Map<string, ScriptureBlock[]>();

  for (const block of sortedBlocks) {
    if (!bookGroups.has(block.bookId)) {
      bookOrder.push(block.bookId);
      bookGroups.set(block.bookId, []);
    }
    bookGroups.get(block.bookId)!.push(block);
  }

  const bookRefs: string[] = [];

  for (const bookId of bookOrder) {
    const bookBlocks = bookGroups.get(bookId)!;
    const bookName = getBookName(bookId);

    // Group by chapter within book
    const chapterOrder: number[] = [];
    const chapterGroups = new Map<number, ScriptureBlock[]>();

    for (const block of bookBlocks) {
      if (!chapterGroups.has(block.chapter)) {
        chapterOrder.push(block.chapter);
        chapterGroups.set(block.chapter, []);
      }
      chapterGroups.get(block.chapter)!.push(block);
    }

    const chapterRefs: string[] = [];

    for (const chapter of chapterOrder) {
      const chapterBlocks = chapterGroups.get(chapter)!;

      const verseRanges = chapterBlocks
        .map((b) => {
          if (b.startVerse == null && b.endVerse == null) return "";
          if (b.startVerse == null) return `1-${b.endVerse}`;
          if (b.endVerse == null || b.startVerse === b.endVerse) return `${b.startVerse}`;
          return `${b.startVerse}-${b.endVerse}`;
        })
        .filter((r) => r !== "");

      if (verseRanges.length === 0) {
        chapterRefs.push(`${chapter}`);
      } else {
        chapterRefs.push(`${chapter}:${verseRanges.join(", ")}`);
      }
    }

    if (chapterRefs.length === 1) {
      bookRefs.push(`${bookName} ${chapterRefs[0]}`);
    } else {
      bookRefs.push(`${bookName} ${chapterRefs.join("; ")}`);
    }
  }

  return bookRefs.join("; ");
}

export interface GeneratePlanResult {
  success: true;
  plan: GeneratedPlan;
  passageRefs: string[]; // passageRef for each day
}

export interface GeneratePlanError {
  success: false;
  error: string;
  code: "VALIDATION_ERROR" | "API_ERROR" | "PARSE_ERROR" | "CONFIG_ERROR";
  details?: unknown;
}

/**
 * Generate a reading plan using OpenAI.
 *
 * @param input - Generation parameters including topic, duration, mode, and optional user context
 * @returns Generated plan with validated schema and computed passageRefs
 */
export async function generateReadingPlan(
  input: GeneratePlanInput
): Promise<GeneratePlanResult | GeneratePlanError> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "OpenAI API key not configured",
      code: "CONFIG_ERROR",
    };
  }

  const systemPrompt = buildSystemPrompt(input.mode);
  const userPrompt = buildUserPrompt(input.topic, input.durationDays, input.userContext);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 16000, // Large plans can be verbose
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error("[generateReadingPlan] OpenAI API error:", response.status, errorText);
      return {
        success: false,
        error: `OpenAI API error: ${response.status}`,
        code: "API_ERROR",
        details: errorText,
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return {
        success: false,
        error: "No content in OpenAI response",
        code: "API_ERROR",
      };
    }

    // Parse JSON response
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("[generateReadingPlan] JSON parse error:", parseError);
      return {
        success: false,
        error: "Failed to parse JSON from OpenAI response",
        code: "PARSE_ERROR",
        details: content.slice(0, 500),
      };
    }

    // Validate with Zod schema
    const validationResult = generatedPlanSchema.safeParse(parsed);

    if (!validationResult.success) {
      console.error("[generateReadingPlan] Validation error:", validationResult.error);
      return {
        success: false,
        error: "Generated plan failed validation",
        code: "VALIDATION_ERROR",
        details: validationResult.error.format(),
      };
    }

    const plan = validationResult.data;

    // Generate passageRefs for each day
    const passageRefs = plan.days.map((day) =>
      generatePassageRef(day.scriptureBlocks as ScriptureBlock[])
    );

    return {
      success: true,
      plan,
      passageRefs,
    };
  } catch (error) {
    console.error("[generateReadingPlan] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error during generation",
      code: "API_ERROR",
      details: error,
    };
  }
}

// --- Two-stage generation ---

export interface GenerateOutlineResult {
  success: true;
  outline: PlanOutline;
  passageRefs: string[];
}

/**
 * Generate a plan outline (stage 1) using OpenAI.
 */
export async function generatePlanOutline(
  input: GeneratePlanInput
): Promise<GenerateOutlineResult | GeneratePlanError> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: "OpenAI API key not configured", code: "CONFIG_ERROR" };
  }

  const systemPrompt = buildOutlineSystemPrompt(input.mode);
  const userPrompt = buildUserPrompt(input.topic, input.durationDays, input.userContext);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error("[generatePlanOutline] OpenAI API error:", response.status, errorText);
      return { success: false, error: `OpenAI API error: ${response.status}`, code: "API_ERROR", details: errorText };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return { success: false, error: "No content in OpenAI response", code: "API_ERROR" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("[generatePlanOutline] JSON parse error:", parseError);
      return { success: false, error: "Failed to parse JSON from OpenAI response", code: "PARSE_ERROR", details: content.slice(0, 500) };
    }

    const validationResult = planOutlineSchema.safeParse(parsed);
    if (!validationResult.success) {
      console.error("[generatePlanOutline] Validation error:", validationResult.error);
      return { success: false, error: "Generated outline failed validation", code: "VALIDATION_ERROR", details: validationResult.error.format() };
    }

    const outline = validationResult.data;
    const passageRefs = outline.days.map((day) =>
      generatePassageRef(day.scriptureBlocks as ScriptureBlock[])
    );

    return { success: true, outline, passageRefs };
  } catch (error) {
    console.error("[generatePlanOutline] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error during generation",
      code: "API_ERROR",
      details: error,
    };
  }
}

/**
 * Generate full plan content from an approved outline (stage 2) using OpenAI.
 */
export async function generateFullPlanFromOutline(
  outline: PlanOutline,
  input: GeneratePlanInput,
  modifications?: string
): Promise<GeneratePlanResult | GeneratePlanError> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: "OpenAI API key not configured", code: "CONFIG_ERROR" };
  }

  const userPrompt = buildFullGenerationUserPrompt(outline, modifications, input.userContext);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: FULL_FROM_OUTLINE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error("[generateFullPlanFromOutline] OpenAI API error:", response.status, errorText);
      return { success: false, error: `OpenAI API error: ${response.status}`, code: "API_ERROR", details: errorText };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return { success: false, error: "No content in OpenAI response", code: "API_ERROR" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("[generateFullPlanFromOutline] JSON parse error:", parseError);
      return { success: false, error: "Failed to parse JSON from OpenAI response", code: "PARSE_ERROR", details: content.slice(0, 500) };
    }

    const validationResult = generatedPlanSchema.safeParse(parsed);
    if (!validationResult.success) {
      console.error("[generateFullPlanFromOutline] Validation error:", validationResult.error);
      return { success: false, error: "Generated plan failed validation", code: "VALIDATION_ERROR", details: validationResult.error.format() };
    }

    const plan = validationResult.data;
    const passageRefs = plan.days.map((day) =>
      generatePassageRef(day.scriptureBlocks as ScriptureBlock[])
    );

    return { success: true, plan, passageRefs };
  } catch (error) {
    console.error("[generateFullPlanFromOutline] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unexpected error during generation",
      code: "API_ERROR",
      details: error,
    };
  }
}

/**
 * Re-export generatePassageRef for use by API routes when saving plans.
 */
export { generatePassageRef };
