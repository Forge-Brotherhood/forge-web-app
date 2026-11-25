import type { ContextToolCall, ResponsesTool } from "@/lib/openai/responsesClient";

export type { ContextToolCall };

/** A note the Guide chose to remember for this conversation. The app keeps it; the server does not. */
export type SessionNote = {
  text: string;
  keywords: string[];
  expiresAtISO?: string;
};

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const normalizeKeyword = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const snake = raw
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!snake) return null;
  return snake.length > 24 ? snake.slice(0, 24) : snake;
};

const normalizeKeywords = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const k = normalizeKeyword(item);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= 8) break;
  }
  return out;
};

export const buildContextToolsForUser = (): ResponsesTool[] => [
  {
    type: "function",
    name: "get_bible_reading_sessions",
    description:
      "Get the user's recent Bible reading sessions and segments (what they read and for how long).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sinceISO: { type: "string", description: "ISO timestamp lower bound (optional)" },
        limit: { type: "integer", description: "Max items to return (default 10, max 25)" },
        bookId: { type: "string", description: "Optional book code filter (e.g., JHN)" },
        chapter: { type: "integer", description: "Optional chapter filter" },
      },
    },
  },
  {
    type: "function",
    name: "get_verse_notes",
    description: "Get the user's verse notes for a passage/verse and timeframe.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sinceISO: { type: "string", description: "ISO timestamp lower bound (optional)" },
        limit: { type: "integer", description: "Max items to return (default 10, max 25)" },
        bookId: { type: "string", description: "Optional book code filter (e.g., JHN)" },
        chapter: { type: "integer", description: "Optional chapter filter" },
        verse: { type: "integer", description: "Optional verse filter (matches ranges containing this verse)" },
      },
    },
  },
  {
    type: "function",
    name: "search_verse_notes",
    description: "Search the user's verse notes by topic/semantic similarity (optionally scoped to a passage).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query describing the note you're looking for." },
        sinceISO: { type: "string", description: "ISO timestamp lower bound (optional)" },
        limit: { type: "integer", description: "Max items to return (default 6, max 15)" },
        minScore: { type: "number", description: "Optional similarity threshold (0–1). Lower = broader." },
        book: { type: "string", description: "Optional book name scope (e.g., 'John')." },
        chapter: { type: "integer", description: "Optional chapter scope." },
        verse: { type: "integer", description: "Optional verse scope (matches ranges containing this verse)." },
      },
    },
  },
  {
    type: "function",
    name: "get_verse_highlights",
    description: "Get the user's verse highlights for a passage/verse and timeframe.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sinceISO: { type: "string", description: "ISO timestamp lower bound (optional)" },
        limit: { type: "integer", description: "Max items to return (default 10, max 25)" },
        bookId: { type: "string", description: "Optional book code filter (e.g., JHN)" },
        chapter: { type: "integer", description: "Optional chapter filter" },
        verse: { type: "integer", description: "Optional verse filter (matches ranges containing this verse)" },
      },
    },
  },
  {
    type: "function",
    name: "get_conversation_session_summaries",
    description: "Get summaries of prior Guide conversations for continuity.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sinceISO: { type: "string", description: "ISO timestamp lower bound (optional)" },
        limit: { type: "integer", description: "Max items to return (default 6, max 15)" },
      },
    },
  },
  {
    type: "function",
    name: "search_conversation_session_summaries",
    description: "Search prior Guide conversation session summaries by topic/semantic similarity.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query describing the prior conversation you're looking for." },
        sinceISO: { type: "string", description: "ISO timestamp lower bound (optional)" },
        limit: { type: "integer", description: "Max items to return (default 5, max 10)" },
        minScore: { type: "number", description: "Optional similarity threshold (0–1). Lower = broader." },
      },
    },
  },
  {
    type: "function",
    name: "get_life_context",
    description:
      "Get the user's current life context: their season of life, what they're carrying this week, what they're hoping for, prayer topics, and goals. Use this to personalize your responses based on what they've shared about their life.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: "function",
    name: "save_memory_candidate",
    description:
      "Capture a candidate LONG-TERM memory for later consolidation. Use for: (1) stable preferences/routines/goals, (2) ongoing spiritual or emotional struggles explicitly shared by the user (e.g., 'struggles with lust', 'dealing with anger', 'wrestling with doubt') - these are IMPORTANT for pastoral follow-up, (3) faith journey context. Do NOT store secrets/credentials, addresses/phone/financial details, medical diagnoses/medications, abuse disclosures, or political data.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text", "category", "confidence", "source"],
      properties: {
        text: {
          type: "string",
          description:
            "1–2 factual sentences in user-centric wording. No speculation. Examples: 'User prefers short (5–10 min) Bible reading sessions in the morning.' or 'User has an ongoing struggle with lust/pornography.'",
        },
        category: {
          type: "string",
          enum: ["preference", "routine", "goal", "bio", "struggle", "other"],
        },
        confidence: {
          type: "string",
          enum: ["explicit", "strong", "weak"],
          description: "Only call this tool when confidence is 'explicit'.",
        },
        source: {
          type: "string",
          enum: ["user_message", "user_profile_form", "other"],
        },
        keywords: {
          type: "array",
          maxItems: 8,
          description: "Optional retrieval tags (lowercase, snake_case, <= 24 chars).",
          items: { type: "string", maxLength: 24, pattern: "^[a-z0-9_]{1,24}$" },
        },
      },
    },
  },
  {
    type: "function",
    name: "save_temporary_memory",
    description:
      "Save a TEMPORARY note that expires after a TTL. ALWAYS use this when the user mentions: travel plans, upcoming trips, events, conferences, vacations, visits, temporary schedule changes, or time-bound situations. These are IMPORTANT for contextual follow-up. Do NOT store secrets/credentials or sensitive personal data.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text", "category", "ttlHours", "confidence", "source"],
      properties: {
        text: {
          type: "string",
          description: "1–2 factual sentences. Examples: 'User is traveling to Las Vegas next Thursday.' or 'User has a conference next week.'",
        },
        category: {
          type: "string",
          enum: ["travel", "event", "constraint", "plan", "preference", "other"],
        },
        ttlHours: {
          type: "number",
          description: "How long to keep this temporary note (e.g., 72, 168).",
          minimum: 1,
          maximum: 720,
        },
        confidence: {
          type: "string",
          enum: ["explicit", "strong", "weak"],
          description: "Allow 'explicit' or 'strong' for temporary notes.",
        },
        source: {
          type: "string",
          enum: ["user_message", "user_profile_form", "other"],
        },
        keywords: {
          type: "array",
          maxItems: 8,
          description: "Optional retrieval tags (lowercase, snake_case, <= 24 chars).",
          items: { type: "string", maxLength: 24, pattern: "^[a-z0-9_]{1,24}$" },
        },
      },
    },
  },
];


/**
 * Tools that read the user's own data. That data is encrypted with a key only their devices
 * hold, so the app answers these calls and sends the results back; the server cannot.
 */
export const CLIENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "get_bible_reading_sessions",
  "get_verse_notes",
  "search_verse_notes",
  "get_verse_highlights",
  "get_conversation_session_summaries",
  "search_conversation_session_summaries",
  "get_life_context",
  "get_notification_settings",
]);

/**
 * Runs a tool the server can answer itself. A note the Guide saves is handed back in `note` for
 * the app to keep; nothing is stored here.
 */
export async function executeServerToolCall(
  toolCall: ContextToolCall
): Promise<{ output: string; note?: SessionNote }> {
  const parsed = safeJsonParse(toolCall.argumentsJson);
  const params = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;

  switch (toolCall.name) {
    case "save_memory_candidate":
    case "save_temporary_memory": {
      const checked = checkMemoryNote(params, toolCall.name === "save_temporary_memory");
      return "note" in checked
        ? { output: JSON.stringify({ saved: true }), note: checked.note }
        : { output: JSON.stringify({ saved: false, reason: checked.reason }) };
    }
    default:
      return { output: JSON.stringify({ error: "unknown_tool" }) };
  }
}

export const looksSensitive = (text: string): boolean => {
  const t = text.toLowerCase();
  if (t.includes("api key") || t.includes("password") || t.includes("secret")) return true;
  if (t.includes("token") || t.includes("bearer ")) return true;
  if (t.includes("ssn") || t.includes("social security")) return true;
  if (t.includes("credit card") || t.includes("bank account")) return true;
  if (t.includes("address:") || t.includes("phone:")) return true;
  if (t.includes("diagnosis") || t.includes("medication")) return true;
  return false;
};

export const looksInstructional = (text: string): boolean => {
  const t = text.toLowerCase();
  if (t.includes("system prompt") || t.includes("ignore previous") || t.includes("developer message")) return true;
  return false;
};

/** Long-term candidates need explicit confidence; temporary notes also accept strong, and carry an expiry. */
export function checkMemoryNote(
  params: Record<string, unknown>,
  temporary: boolean
): { note: SessionNote } | { reason: string } {
  const text = typeof params.text === "string" ? params.text.trim() : "";
  if (!text) return { reason: "empty" };
  if (text.length > 400) return { reason: "too_long" };
  if (looksSensitive(text)) return { reason: "sensitive" };
  if (looksInstructional(text)) return { reason: "instruction_like" };

  if (typeof params.category !== "string" || !params.category.trim()) return { reason: "missing_category" };
  const confidence = typeof params.confidence === "string" ? params.confidence.trim() : "";
  if (!confidence) return { reason: "missing_confidence" };
  if (confidence !== "explicit" && !(temporary && confidence === "strong")) {
    return { reason: temporary ? "confidence_too_weak" : "confidence_not_explicit" };
  }
  if (typeof params.source !== "string" || !params.source.trim()) return { reason: "missing_source" };

  const keywords = normalizeKeywords(params.keywords);
  if (!temporary) return { note: { text, keywords } };

  const ttlHours = typeof params.ttlHours === "number" ? params.ttlHours : Number(params.ttlHours);
  if (!Number.isFinite(ttlHours)) return { reason: "invalid_ttlHours" };
  const expiresAtISO = new Date(Date.now() + clamp(ttlHours, 1, 720) * 60 * 60 * 1000).toISOString();
  return { note: { text, keywords, expiresAtISO } };
}
