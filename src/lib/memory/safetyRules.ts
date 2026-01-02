/**
 * Safety Rules Service
 *
 * Non-negotiable safety constraints for memory usage.
 * These rules are HARD requirements, not suggestions.
 */

import type { RetrievalPolicy } from "@/lib/ai/userContext";

// =============================================================================
// Memory Interface (minimal for safety checks)
// =============================================================================

/**
 * Minimal interface for memories that can be safety-checked.
 */
interface SafetyCheckableMemory {
  id: string;
  insight?: string;
  preview?: string;
}

// =============================================================================
// Types
// =============================================================================

export interface SafetyCheckResult {
  safe: boolean;
  issues: string[];
  sanitizedContent?: string;
}

// =============================================================================
// Safety Patterns
// =============================================================================

/**
 * Patterns that indicate sensitive personal details
 * These are only filtered when combined with personal disclosure (first-person language nearby)
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // Family/relationships
  /\b(spouse|husband|wife|partner|marriage|married|divorce|divorced|separated)\b/i,
  /\b(children|kids|son|daughter|child|baby|pregnant|pregnancy)\b/i,
  /\b(family|parent|mother|father|mom|dad|sibling|brother|sister)\b/i,

  // Employment/financial
  /\b(job|work|career|employer|boss|fired|laid off|unemployed)\b/i,
  /\b(salary|income|money|debt|financial|bankrupt|mortgage)\b/i,

  // Health
  /\b(sick|illness|disease|diagnosis|cancer|hospital|surgery|doctor)\b/i,
  /\b(mental health|depression|anxiety|therapy|therapist|counselor)\b/i,
  /\b(addiction|addict|alcoholic|drug|substance)\b/i,

  // Trauma
  /\b(abuse|abused|assault|trauma|traumatic|violence|victim)\b/i,
  /\b(suicide|suicidal|self-harm|cutting)\b/i,

  // Legal
  /\b(arrest|arrested|jail|prison|court|lawsuit|legal trouble)\b/i,
];

/**
 * First-person indicators that signal personal disclosure
 * Content is only considered sensitive when these appear near sensitive patterns
 */
const FIRST_PERSON_INDICATORS: RegExp[] = [
  /\bI\b/,
  /\bI'm\b/i,
  /\bI've\b/i,
  /\bI'd\b/i,
  /\bI'll\b/i,
  /\bmy\b/i,
  /\bmine\b/i,
  /\bme\b/i,
  /\bmyself\b/i,
  /\bwe\b/i,
  /\bwe're\b/i,
  /\bwe've\b/i,
  /\bour\b/i,
  /\bours\b/i,
  /\bus\b/i,
  /\bourselves\b/i,
];

/**
 * Check if first-person language appears within N words of a sensitive term
 */
function hasPersonalDisclosure(
  text: string,
  sensitivePattern: RegExp,
  proximityWords: number = 5
): boolean {
  const words = text.split(/\s+/);

  // Find indices where sensitive pattern matches
  for (let i = 0; i < words.length; i++) {
    if (sensitivePattern.test(words[i])) {
      // Check surrounding words for first-person indicators
      const start = Math.max(0, i - proximityWords);
      const end = Math.min(words.length, i + proximityWords + 1);
      const surroundingText = words.slice(start, end).join(" ");

      for (const indicator of FIRST_PERSON_INDICATORS) {
        if (indicator.test(surroundingText)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Phrases that claim beliefs - NEVER use these
 * Use neutral exploration language instead
 */
const PROHIBITED_BELIEF_PHRASES: string[] = [
  "you believe",
  "your belief",
  "you think that",
  "you feel that",
  "you always",
  "you never",
  "your conviction",
  "you are convinced",
  "in your opinion",
  "you disagree with",
  "you agree with",
];

/**
 * Safe alternative phrasings
 */
const SAFE_PHRASE_ALTERNATIVES: Record<string, string> = {
  "you believe": "previously you explored",
  "your belief": "the perspective you examined",
  "you think that": "you once reflected on",
  "you feel that": "you expressed wondering about",
  "you always": "you have explored",
  "you never": "you haven't yet explored",
  "your conviction": "the theme you studied",
  "in your opinion": "in your reflection",
};

// =============================================================================
// Safety Functions
// =============================================================================

/**
 * Check if a memory contains sensitive personal disclosure
 * Only returns true if sensitive terms appear WITH first-person language nearby
 * General/theological discussion of sensitive topics is allowed
 */
export function containsSensitiveContent(text: string): boolean {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text) && hasPersonalDisclosure(text, pattern)) {
      return true; // Sensitive term + personal disclosure = filter
    }
  }
  return false; // No personal disclosure near sensitive terms = allow
}

/**
 * Sanitize memory content for safe inclusion in prompts
 * Returns null if memory is too sensitive to use at all
 */
export function sanitizeMemoryForPrompt(
  memory: SafetyCheckableMemory
): string | null {
  const content = memory.insight || memory.preview || "";

  // Check for sensitive content
  if (containsSensitiveContent(content)) {
    console.log(`[Memory Safety] Blocked sensitive memory: ${memory.id}`);
    return null;
  }

  // Memory is safe to use
  return content;
}

/**
 * Validate that a prompt doesn't contain prohibited phrasing
 */
export function validatePromptSafety(prompt: string): SafetyCheckResult {
  const issues: string[] = [];

  // Check for prohibited belief claims
  for (const phrase of PROHIBITED_BELIEF_PHRASES) {
    if (prompt.toLowerCase().includes(phrase.toLowerCase())) {
      issues.push(`Contains prohibited phrase: "${phrase}"`);
    }
  }

  // Check for sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(prompt)) {
      issues.push(`Contains sensitive topic: ${pattern.source.slice(0, 30)}...`);
    }
  }

  return {
    safe: issues.length === 0,
    issues,
  };
}

/**
 * Replace prohibited phrases with safe alternatives
 */
export function sanitizePhrasings(text: string): string {
  let sanitized = text;

  for (const [prohibited, safe] of Object.entries(SAFE_PHRASE_ALTERNATIVES)) {
    const regex = new RegExp(prohibited, "gi");
    sanitized = sanitized.replace(regex, safe);
  }

  return sanitized;
}

/**
 * Filter memories to only include safe ones
 */
export function filterSafeMemories<T extends SafetyCheckableMemory>(
  memories: T[]
): T[] {
  return memories.filter((memory) => {
    const sanitized = sanitizeMemoryForPrompt(memory);
    return sanitized !== null;
  });
}

/**
 * Check if memory consent mode allows retrieval
 * @deprecated Use isMemoryAllowedByPolicy instead
 */
export function isMemoryAllowedByConsent(
  consentMode: string,
  memoryType: string
): boolean {
  switch (consentMode) {
    case "off":
      return false;

    case "minimal":
      // Only allow study memories, not reflections or prayers
      return memoryType === "study";

    case "standard":
      // Allow study and reflection, not prayers
      return memoryType === "study" || memoryType === "reflection";

    case "full":
      // Allow all memory types
      return true;

    default:
      return true;
  }
}

/**
 * Check if memory is allowed by the retrieval policy
 */
export function isMemoryAllowedByPolicy(
  policy: RetrievalPolicy | null | undefined,
  memoryType: string
): boolean {
  // If no policy, allow all (backwards compatible)
  if (!policy) {
    return true;
  }

  // If retrieval is disabled, block all
  if (!policy.enabled) {
    return false;
  }

  // Check if memory type is in allowed types
  return policy.allowedTypes.includes(memoryType as "study" | "reflection" | "prayer");
}

/**
 * Log safety-related events for audit
 */
export function logSafetyEvent(
  eventType: "blocked" | "sanitized" | "allowed",
  memoryId: string,
  reason?: string
): void {
  const timestamp = new Date().toISOString();
  console.log(
    `[Memory Safety] ${timestamp} | ${eventType.toUpperCase()} | ${memoryId}${reason ? ` | ${reason}` : ""}`
  );
}
