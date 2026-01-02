/**
 * Life Context Safety Rules
 *
 * Guardrails to prevent the AI from making claims about user identity
 * or using life context in inappropriate ways.
 */

// =============================================================================
// Prohibited Patterns
// =============================================================================

/**
 * Patterns that should NEVER appear in AI responses when using life context.
 * These prevent the AI from making definitive claims about the user's identity.
 */
export const PROHIBITED_PATTERNS = [
  /you always/i,
  /you never/i,
  /you are an? \w+ person/i,    // "you are an anxious person"
  /because you're anxious/i,     // Direct causation from state
  /because you're grieving/i,
  /because you're struggling/i,
  /your personality/i,
  /your nature is/i,
  /you tend to be/i,
  /you're typically/i,
  /you seem to be the type/i,
  /based on who you are/i,
  /knowing you as I do/i,
];

/**
 * Safer alternatives to prohibited phrases.
 * These focus on the current moment rather than identity.
 */
export const SAFER_ALTERNATIVES: Record<string, string> = {
  "you always": "you've been experiencing",
  "you never": "you haven't yet",
  "you are anxious": "you're in a season of anxiety",
  "because you're anxious": "during this season of anxiety",
  "your personality": "the way you've shared",
  "you tend to be": "in this season you seem to be",
};

// =============================================================================
// Safety Checking Functions
// =============================================================================

/**
 * Check if a response contains prohibited patterns.
 * Returns an array of matched patterns (empty if safe).
 */
export function checkForProhibitedPatterns(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of PROHIBITED_PATTERNS) {
    if (pattern.test(text)) {
      matches.push(pattern.source);
    }
  }
  return matches;
}

/**
 * Check if life context should be used for a given query.
 * Returns false for factual/reference queries where personalization is inappropriate.
 */
export function shouldUseLifeContext(message: string): boolean {
  // Patterns that indicate factual/reference queries
  const factualPatterns = [
    /^who wrote/i,
    /^when was .+ written/i,
    /^what does .+ mean in (hebrew|greek)/i,
    /^show me .+:\d+/i,           // Direct verse reference
    /^read .+:\d+/i,
    /^go to .+:\d+/i,
    /^what is the context of/i,
    /^who is .+ in the bible/i,
    /^where is .+ mentioned/i,
    /^how many .+ are in the bible/i,
  ];

  for (const pattern of factualPatterns) {
    if (pattern.test(message)) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// Content Validation
// =============================================================================

/**
 * Maximum lengths for user-entered content.
 */
export const MAX_LENGTHS = {
  seasonNote: 100,
  prayerTopic: 200,
  weeklyCarrying: 500,
  weeklyHoping: 500,
  goal: 500,
};

/**
 * Validate and sanitize user-entered text.
 * Trims whitespace and enforces max length.
 */
export function sanitizeText(text: string, maxLength: number): string {
  return text.trim().slice(0, maxLength);
}

/**
 * Check if content is appropriate for storage.
 * Returns null if valid, or an error message if invalid.
 */
export function validateContent(text: string, field: keyof typeof MAX_LENGTHS): string | null {
  if (!text || text.trim().length === 0) {
    return "Content cannot be empty";
  }

  const maxLength = MAX_LENGTHS[field];
  if (text.length > maxLength) {
    return `Content exceeds maximum length of ${maxLength} characters`;
  }

  return null;
}

// =============================================================================
// Logging
// =============================================================================

/**
 * Log a safety-related event for monitoring.
 * In production, this could send to a monitoring service.
 */
export function logSafetyEvent(
  event: "prohibited_pattern" | "factual_query" | "content_too_long",
  details: Record<string, unknown>
): void {
  console.warn(`[LifeContext Safety] ${event}:`, details);
}
