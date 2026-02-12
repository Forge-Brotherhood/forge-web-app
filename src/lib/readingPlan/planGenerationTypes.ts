/**
 * Reading Plan Generation Types & Validation
 *
 * Zod schemas and TypeScript types for AI-generated reading plans.
 */

import { z } from "zod";

// Valid Bible book IDs (API.Bible format)
export const BIBLE_BOOK_IDS = [
  "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA",
  "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO",
  "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO",
  "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL",
  "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH",
  "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS",
  "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV"
] as const;

export type BibleBookId = typeof BIBLE_BOOK_IDS[number];

// Scripture block schema (matches admin app ScriptureBlock interface)
export const scriptureBlockSchema = z.object({
  bookId: z.string().refine(
    (id) => BIBLE_BOOK_IDS.includes(id as BibleBookId),
    { message: "Invalid book ID" }
  ),
  chapter: z.number().int().min(1),
  startVerse: z.number().int().min(1).nullable().optional(),
  endVerse: z.number().int().min(1).nullable().optional(),
  order: z.number().int().min(0),
}).refine(
  (block) => {
    // Validate verse range if both are provided
    if (block.startVerse && block.endVerse) {
      return block.startVerse <= block.endVerse;
    }
    return true;
  },
  { message: "startVerse must be <= endVerse" }
);

export type ScriptureBlock = z.infer<typeof scriptureBlockSchema>;

// Generated day schema
export const generatedDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  scriptureBlocks: z.array(scriptureBlockSchema).min(1).max(10),
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(3000),
  reflectionPrompt: z.string().min(1).max(1000),
  prayerPrompt: z.string().min(1).max(1000),
  contextIntro: z.string().min(1).max(3000),
});

export type GeneratedDay = z.infer<typeof generatedDaySchema>;

// Generated template schema
export const generatedTemplateSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).nullable().optional(),
  description: z.string().max(3000).nullable().optional(),
  totalDays: z.number().int().min(1).max(90),
  estimatedMinutesMin: z.number().int().min(1).max(60),
  estimatedMinutesMax: z.number().int().min(1).max(60),
  theme: z.string().max(100).nullable().optional(),
});

export type GeneratedTemplate = z.infer<typeof generatedTemplateSchema>;

// Full generated plan schema
export const generatedPlanSchema = z.object({
  template: generatedTemplateSchema,
  days: z.array(generatedDaySchema).min(1).max(90),
}).refine(
  (plan) => plan.days.length === plan.template.totalDays,
  { message: "Days count must match totalDays" }
).refine(
  (plan) => {
    // Validate unique day numbers
    const nums = plan.days.map(d => d.dayNumber);
    return new Set(nums).size === nums.length;
  },
  { message: "Day numbers must be unique" }
).refine(
  (plan) => {
    // Validate day numbers are sequential starting from 1
    const sorted = [...plan.days].sort((a, b) => a.dayNumber - b.dayNumber);
    return sorted.every((day, idx) => day.dayNumber === idx + 1);
  },
  { message: "Day numbers must be sequential starting from 1" }
);

export type GeneratedPlan = z.infer<typeof generatedPlanSchema>;

// API request schema for user-facing generation
export const generatePlanRequestSchema = z.object({
  topic: z.string().min(3, "Topic must be at least 3 characters").max(500),
  durationDays: z.number().int().min(3).max(30).optional().default(7),
  includeContext: z.boolean().optional().default(true),
});

export type GeneratePlanRequest = z.infer<typeof generatePlanRequestSchema>;

// API response types
export interface GeneratePlanSuccessResponse {
  success: true;
  plan: {
    id: string;
    shortId: string;
    template: {
      id: string;
      shortId: string;
      title: string;
      subtitle: string | null;
      totalDays: number;
      theme: string | null;
    };
    startDate: string;
    status: string;
  };
}

export interface GeneratePlanErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: unknown;
}

export type GeneratePlanResponse = GeneratePlanSuccessResponse | GeneratePlanErrorResponse;

// --- Outline schemas (two-stage generation) ---

// Outline day schema — lightweight day structure without full content
export const outlineDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(500),
  scriptureBlocks: z.array(scriptureBlockSchema).min(1).max(10),
});

export type OutlineDay = z.infer<typeof outlineDaySchema>;

// Plan outline schema — same cross-field validation as generatedPlanSchema
export const planOutlineSchema = z.object({
  template: generatedTemplateSchema,
  days: z.array(outlineDaySchema).min(1).max(90),
}).refine(
  (plan) => plan.days.length === plan.template.totalDays,
  { message: "Days count must match totalDays" }
).refine(
  (plan) => {
    const nums = plan.days.map(d => d.dayNumber);
    return new Set(nums).size === nums.length;
  },
  { message: "Day numbers must be unique" }
).refine(
  (plan) => {
    const sorted = [...plan.days].sort((a, b) => a.dayNumber - b.dayNumber);
    return sorted.every((day, idx) => day.dayNumber === idx + 1);
  },
  { message: "Day numbers must be sequential starting from 1" }
);

export type PlanOutline = z.infer<typeof planOutlineSchema>;

// Request schema for outline generation (same shape as generate plan request)
export const generateOutlineRequestSchema = z.object({
  topic: z.string().min(3, "Topic must be at least 3 characters").max(500),
  durationDays: z.number().int().min(3).max(30).optional().default(7),
  includeContext: z.boolean().optional().default(true),
});

export type GenerateOutlineRequest = z.infer<typeof generateOutlineRequestSchema>;

// Request schema for full generation from an approved outline
export const generateFullFromOutlineRequestSchema = z.object({
  outline: planOutlineSchema,
  modifications: z.string().max(2000).optional(),
});

export type GenerateFullFromOutlineRequest = z.infer<typeof generateFullFromOutlineRequestSchema>;

// Generation mode
export type GenerationMode = "admin" | "user";

// Generation input
export interface GeneratePlanInput {
  topic: string;
  durationDays: number;
  mode: GenerationMode;
  userContext?: UserContextForGeneration;
}

// User context structure for generation (simplified from full context)
export interface UserContextForGeneration {
  // Profile
  name?: string;
  experienceLevel: string;
  explanationStyle: string;
  preferredTranslation: string;

  // Life context
  currentSeason?: string;
  seasonNote?: string;
  weeklyCarrying?: string;
  weeklyHoping?: string;
  prayerTopics: string[];
  goals: string[];

  // Memories
  memoryNotes: string[];

  // Bible engagement
  recentHighlights: Array<{
    bookId: string;
    chapter: number;
    verse: number;
    createdAt: Date;
  }>;
  recentNotes: Array<{
    bookId: string;
    chapter: number;
    content: string;
  }>;
  frequentBooks: Array<{
    bookId: string;
    totalMinutes: number;
  }>;

  // Previous reflections
  recentReflections: Array<{
    content: string;
    createdAt: Date;
  }>;
}
