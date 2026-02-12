import { prisma } from "@/lib/prisma";
import { searchSimilar } from "@/lib/artifacts/embeddingService";
import { getActiveLifeContextForAI } from "@/lib/lifeContext";
import { searchTemplates } from "@/lib/readingPlan/templateEmbeddingService";
import type { ContextToolCall, ResponsesTool } from "@/lib/openai/responsesClient";

export type { ContextToolCall };

type MemoryNote = {
  text: string;
  keywords?: string[];
  createdAtISO?: string;
  expiresAtISO?: string;
  category?: string;
  confidence?: string;
  source?: string;
};

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

const truncate = (text: string, maxLen: number): string =>
  text.length > maxLen ? `${text.slice(0, Math.max(0, maxLen - 1))}…` : text;

const toIsoOrNull = (d: Date | null | undefined): string | null =>
  d instanceof Date ? d.toISOString() : null;

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
    name: "search_reading_plans",
    description:
      "Search for Bible reading plan templates by topic or theme. Use this when the user asks about reading plans, wants to start a new plan, or when you want to recommend a plan based on their interests or life situation. Returns public, published reading plan templates that match the query.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            "Search query describing what kind of reading plan to find. Examples: 'anxiety and peace', 'marriage relationships', 'spiritual growth', 'psalms for comfort', 'new believer basics'.",
        },
        limit: {
          type: "integer",
          description: "Max plans to return (default 5, max 10)",
        },
      },
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

export async function executeContextToolCall(args: {
  userId: string;
  conversationId: string;
  toolCall: ContextToolCall;
}): Promise<string> {
  const parsed = safeJsonParse(args.toolCall.argumentsJson);
  const params = (typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;

  switch (args.toolCall.name) {
    case "get_bible_reading_sessions":
      return JSON.stringify(await getBibleReadingSessions(args.userId, params));
    case "get_verse_notes":
      return JSON.stringify(await getVerseNotes(args.userId, params));
    case "search_verse_notes":
      return JSON.stringify(await searchVerseNotes(args.userId, params));
    case "get_verse_highlights":
      return JSON.stringify(await getVerseHighlights(args.userId, params));
    case "get_conversation_session_summaries":
      return JSON.stringify(await getConversationSessionSummaries(args.userId, params));
    case "search_conversation_session_summaries":
      return JSON.stringify(await searchConversationSessionSummaries(args.userId, params));
    case "get_life_context":
      return JSON.stringify(await getLifeContext(args.userId));
    case "search_reading_plans":
      return JSON.stringify(await searchReadingPlans(params));
    case "save_memory_candidate":
      return JSON.stringify(await saveMemoryCandidate(args.userId, args.conversationId, params));
    case "save_temporary_memory":
      return JSON.stringify(await saveTemporaryMemory(args.userId, args.conversationId, params));
    default:
      return JSON.stringify({ error: "unknown_tool" });
  }
}

const looksSensitive = (text: string): boolean => {
  const t = text.toLowerCase();
  if (t.includes("api key") || t.includes("password") || t.includes("secret")) return true;
  if (t.includes("token") || t.includes("bearer ")) return true;
  if (t.includes("ssn") || t.includes("social security")) return true;
  if (t.includes("credit card") || t.includes("bank account")) return true;
  if (t.includes("address:") || t.includes("phone:")) return true;
  if (t.includes("diagnosis") || t.includes("medication")) return true;
  return false;
};

const looksInstructional = (text: string): boolean => {
  const t = text.toLowerCase();
  if (t.includes("system prompt") || t.includes("ignore previous") || t.includes("developer message")) return true;
  return false;
};

async function saveMemoryCandidate(
  userId: string,
  conversationId: string,
  params: Record<string, unknown>
): Promise<{ saved: boolean; reason?: string; note?: MemoryNote; noteCount?: number }> {
  const rawText = typeof params.text === "string" ? params.text : "";
  const text = rawText.trim();
  if (!text) return { saved: false, reason: "empty" };
  if (text.length > 400) return { saved: false, reason: "too_long" };
  if (looksSensitive(text)) return { saved: false, reason: "sensitive" };
  if (looksInstructional(text)) return { saved: false, reason: "instruction_like" };

  const category = typeof params.category === "string" ? params.category.trim() : "";
  if (!category) return { saved: false, reason: "missing_category" };
  const confidence = typeof params.confidence === "string" ? params.confidence.trim() : "";
  if (!confidence) return { saved: false, reason: "missing_confidence" };
  if (confidence !== "explicit") return { saved: false, reason: "confidence_not_explicit" };
  const source = typeof params.source === "string" ? params.source.trim() : "";
  if (!source) return { saved: false, reason: "missing_source" };

  const keywords = normalizeKeywords(params.keywords);

  const note: MemoryNote = {
    text,
    keywords,
    createdAtISO: new Date().toISOString(),
    category,
    confidence,
    source,
  };

  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const conversation = await prisma.chatConversation.upsert({
    where: { conversationId },
    create: {
      conversationId,
      userId,
      entrypoint: "other",
      mode: "general",
      previousResponseId: null,
    },
    update: {
      updatedAt: new Date(),
    },
    select: { userId: true },
  });

  if (conversation.userId !== userId) return { saved: false, reason: "wrong_user" };

  const existingNotes = await prisma.chatSessionMemoryNote.findMany({
    where: { conversationId, userId },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    select: { text: true },
  });

  const already = existingNotes.some(
    (n) => String(n.text ?? "").toLowerCase().replace(/\s+/g, " ") === normalized
  );
  if (already) {
    const noteCount = await prisma.chatSessionMemoryNote.count({ where: { conversationId, userId } });
    return { saved: false, reason: "duplicate", noteCount };
  }

  await prisma.chatSessionMemoryNote.create({
    data: {
      conversationId,
      userId,
      text,
      keywords,
    },
    select: { id: true },
  });

  const noteCount = await prisma.chatSessionMemoryNote.count({ where: { conversationId, userId } });
  return { saved: true, note, noteCount };
}

async function saveTemporaryMemory(
  userId: string,
  conversationId: string,
  params: Record<string, unknown>
): Promise<{ saved: boolean; reason?: string; note?: MemoryNote; noteCount?: number }> {
  const rawText = typeof params.text === "string" ? params.text : "";
  const text = rawText.trim();
  if (!text) return { saved: false, reason: "empty" };
  if (text.length > 400) return { saved: false, reason: "too_long" };
  if (looksSensitive(text)) return { saved: false, reason: "sensitive" };
  if (looksInstructional(text)) return { saved: false, reason: "instruction_like" };

  const category = typeof params.category === "string" ? params.category.trim() : "";
  if (!category) return { saved: false, reason: "missing_category" };
  const confidence = typeof params.confidence === "string" ? params.confidence.trim() : "";
  if (!confidence) return { saved: false, reason: "missing_confidence" };
  if (confidence !== "explicit" && confidence !== "strong") return { saved: false, reason: "confidence_too_weak" };
  const source = typeof params.source === "string" ? params.source.trim() : "";
  if (!source) return { saved: false, reason: "missing_source" };

  const rawTtlHours = typeof params.ttlHours === "number" ? params.ttlHours : Number(params.ttlHours);
  if (!Number.isFinite(rawTtlHours)) return { saved: false, reason: "invalid_ttlHours" };
  const ttlHours = clamp(rawTtlHours, 1, 720);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const expiresAtISO = expiresAt.toISOString();

  const keywords = normalizeKeywords(params.keywords);

  const note: MemoryNote = {
    text,
    keywords,
    createdAtISO: new Date().toISOString(),
    expiresAtISO,
    category,
    confidence,
    source,
  };

  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const conversation = await prisma.chatConversation.upsert({
    where: { conversationId },
    create: {
      conversationId,
      userId,
      entrypoint: "other",
      mode: "general",
      previousResponseId: null,
    },
    update: {
      updatedAt: new Date(),
    },
    select: { userId: true },
  });

  if (conversation.userId !== userId) return { saved: false, reason: "wrong_user" };

  const existingNotes = await prisma.chatSessionMemoryNote.findMany({
    where: { conversationId, userId },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    select: { text: true },
  });

  const already = existingNotes.some(
    (n) => String(n.text ?? "").toLowerCase().replace(/\s+/g, " ") === normalized
  );
  if (already) {
    const noteCount = await prisma.chatSessionMemoryNote.count({ where: { conversationId, userId } });
    return { saved: false, reason: "duplicate", noteCount };
  }

  await prisma.chatSessionMemoryNote.create({
    data: {
      conversationId,
      userId,
      text,
      keywords,
      expiresAt,
    },
    select: { id: true },
  });

  const noteCount = await prisma.chatSessionMemoryNote.count({ where: { conversationId, userId } });
  return { saved: true, note, noteCount };
}

async function getBibleReadingSessions(
  userId: string,
  params: Record<string, unknown>
): Promise<{
  sessions: Array<{
    endedAtISO: string | null;
    durationSeconds: number;
    bookId: string | null;
    chapter: number | null;
    readRanges: string[];
  }>;
}> {
  const limit = clamp(Number(params.limit ?? 10) || 10, 1, 25);
  const sinceISO = typeof params.sinceISO === "string" ? params.sinceISO : null;
  const since = sinceISO ? new Date(sinceISO) : null;
  const bookId = typeof params.bookId === "string" && params.bookId.trim() ? params.bookId.trim() : null;
  const chapter = Number.isFinite(Number(params.chapter)) ? Number(params.chapter) : null;

  const segments = await prisma.bibleReadingSessionSegment.findMany({
    where: {
      userId,
      ...(since ? { endedAt: { gte: since } } : {}),
      ...(bookId ? { bookId } : {}),
      ...(chapter ? { chapter } : {}),
    },
    orderBy: [{ endedAt: "desc" }],
    take: limit,
    select: {
      endedAt: true,
      durationSeconds: true,
      bookId: true,
      chapter: true,
      readRanges: true,
    },
  });

  return {
    sessions: segments.map((s) => ({
      endedAtISO: toIsoOrNull(s.endedAt),
      durationSeconds: s.durationSeconds,
      bookId: s.bookId ?? null,
      chapter: s.chapter ?? null,
      readRanges: Array.isArray(s.readRanges) ? s.readRanges.slice(0, 5) : [],
    })),
  };
}

async function getVerseNotes(
  userId: string,
  params: Record<string, unknown>
): Promise<{
  notes: Array<{
    reference: string;
    contentPreview: string;
    createdAtISO: string | null;
    updatedAtISO: string | null;
  }>;
}> {
  const limit = clamp(Number(params.limit ?? 10) || 10, 1, 25);
  const sinceISO = typeof params.sinceISO === "string" ? params.sinceISO : null;
  const since = sinceISO ? new Date(sinceISO) : null;
  const bookId = typeof params.bookId === "string" && params.bookId.trim() ? params.bookId.trim() : null;
  const chapter = Number.isFinite(Number(params.chapter)) ? Number(params.chapter) : null;
  const verse = Number.isFinite(Number(params.verse)) ? Number(params.verse) : null;

  const notes = await prisma.verseNote.findMany({
    where: {
      userId,
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(bookId ? { bookId } : {}),
      ...(chapter ? { chapter } : {}),
      ...(verse ? { verseStart: { lte: verse }, verseEnd: { gte: verse } } : {}),
      isPrivate: false,
    },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
    select: {
      bookId: true,
      chapter: true,
      verseStart: true,
      verseEnd: true,
      content: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    notes: notes.map((n) => ({
      reference: `${n.bookId} ${n.chapter}:${n.verseStart}${n.verseEnd !== n.verseStart ? `-${n.verseEnd}` : ""}`,
      contentPreview: truncate(n.content ?? "", 280),
      createdAtISO: toIsoOrNull(n.createdAt),
      updatedAtISO: toIsoOrNull(n.updatedAt),
    })),
  };
}

async function searchVerseNotes(
  userId: string,
  params: Record<string, unknown>
): Promise<{
  notes: Array<{
    reference: string;
    contentPreview: string;
    createdAtISO: string | null;
  }>;
}> {
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) return { notes: [] };

  const limit = clamp(Number(params.limit ?? 6) || 6, 1, 15);

  const sinceISO = typeof params.sinceISO === "string" ? params.sinceISO : null;
  const since = sinceISO ? new Date(sinceISO) : null;

  const rawMinScore = typeof params.minScore === "number" ? params.minScore : Number(params.minScore);
  const minScore = Number.isFinite(rawMinScore) ? clamp(rawMinScore, 0, 1) : null;

  const book = typeof params.book === "string" ? params.book.trim() : "";
  const chapter = Number.isFinite(Number(params.chapter)) ? Number(params.chapter) : null;
  const verse = Number.isFinite(Number(params.verse)) ? Number(params.verse) : null;

  const results = await searchSimilar(
    query,
    {
      userId,
      types: ["verse_note"],
      scopes: ["private"],
      status: "active",
      ...(since ? { createdAfter: since } : {}),
    },
    Math.max(30, limit * 5)
  );

  const filteredByScore = minScore !== null ? results.filter((r) => r.score >= minScore) : results;

  const filteredByPassage = filteredByScore.filter((r) => {
    if (!book && !chapter && !verse) return true;

    const meta = r.artifact.metadata as
      | { reference?: { book?: unknown; chapter?: unknown; verseStart?: unknown; verseEnd?: unknown } }
      | null;

    const ref = meta?.reference;
    const refBook = typeof ref?.book === "string" ? ref.book.trim() : null;
    const refChapter = Number.isFinite(Number(ref?.chapter)) ? Number(ref?.chapter) : null;
    const refVerseStart = Number.isFinite(Number(ref?.verseStart)) ? Number(ref?.verseStart) : null;
    const refVerseEnd = Number.isFinite(Number(ref?.verseEnd)) ? Number(ref?.verseEnd) : null;

    if (book && (!refBook || refBook.toLowerCase() !== book.toLowerCase())) return false;
    if (chapter !== null && refChapter !== chapter) return false;
    if (verse !== null) {
      if (refVerseStart === null || refVerseEnd === null) return false;
      if (verse < refVerseStart || verse > refVerseEnd) return false;
    }

    return true;
  });

  const top = filteredByPassage.slice(0, limit);

  return {
    notes: top.map((r) => {
      const meta = r.artifact.metadata as
        | { reference?: { book?: unknown; chapter?: unknown; verseStart?: unknown; verseEnd?: unknown } }
        | null;
      const ref = meta?.reference;
      const refBook = typeof ref?.book === "string" ? ref.book.trim() : null;
      const refChapter = Number.isFinite(Number(ref?.chapter)) ? Number(ref?.chapter) : null;
      const refVerseStart = Number.isFinite(Number(ref?.verseStart)) ? Number(ref?.verseStart) : null;
      const refVerseEnd = Number.isFinite(Number(ref?.verseEnd)) ? Number(ref?.verseEnd) : null;

      const reference =
        refBook && refChapter && refVerseStart && refVerseEnd
          ? `${refBook} ${refChapter}:${refVerseStart}${refVerseEnd !== refVerseStart ? `-${refVerseEnd}` : ""}`
          : "Unknown reference";

      return {
        reference,
        contentPreview: truncate(r.artifact.content ?? "", 280),
        createdAtISO: toIsoOrNull(r.artifact.createdAt),
      };
    }),
  };
}

async function getVerseHighlights(
  userId: string,
  params: Record<string, unknown>
): Promise<{
  highlights: Array<{
    reference: string;
    color: string;
    createdAtISO: string | null;
  }>;
}> {
  const limit = clamp(Number(params.limit ?? 10) || 10, 1, 25);
  const sinceISO = typeof params.sinceISO === "string" ? params.sinceISO : null;
  const since = sinceISO ? new Date(sinceISO) : null;
  const bookId = typeof params.bookId === "string" && params.bookId.trim() ? params.bookId.trim() : null;
  const chapter = Number.isFinite(Number(params.chapter)) ? Number(params.chapter) : null;
  const verse = Number.isFinite(Number(params.verse)) ? Number(params.verse) : null;

  const highlights = await prisma.bibleHighlight.findMany({
    where: {
      userId,
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(bookId ? { bookId } : {}),
      ...(chapter ? { chapter } : {}),
      ...(verse ? { verseStart: { lte: verse }, verseEnd: { gte: verse } } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    select: {
      bookId: true,
      chapter: true,
      verseStart: true,
      verseEnd: true,
      color: true,
      createdAt: true,
    },
  });

  return {
    highlights: highlights.map((h) => ({
      reference: `${h.bookId} ${h.chapter}:${h.verseStart}${h.verseEnd !== h.verseStart ? `-${h.verseEnd}` : ""}`,
      color: h.color,
      createdAtISO: toIsoOrNull(h.createdAt),
    })),
  };
}

async function getConversationSessionSummaries(
  userId: string,
  params: Record<string, unknown>
): Promise<{
  conversations: Array<{
    title: string | null;
    summary: string;
    createdAtISO: string | null;
  }>;
}> {
  const limit = clamp(Number(params.limit ?? 6) || 6, 1, 15);
  const sinceISO = typeof params.sinceISO === "string" ? params.sinceISO : null;
  const since = sinceISO ? new Date(sinceISO) : null;

  const artifacts = await prisma.artifact.findMany({
    where: {
      userId,
      type: "conversation_session_summary",
      status: "active",
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    select: {
      title: true,
      content: true,
      createdAt: true,
    },
  });

  return {
    conversations: artifacts.map((a) => ({
      title: a.title ?? null,
      summary: truncate(a.content ?? "", 500),
      createdAtISO: toIsoOrNull(a.createdAt),
    })),
  };
}

async function searchConversationSessionSummaries(
  userId: string,
  params: Record<string, unknown>
): Promise<{
  conversations: Array<{
    title: string | null;
    summary: string;
    createdAtISO: string | null;
  }>;
}> {
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) return { conversations: [] };

  const limit = clamp(Number(params.limit ?? 5) || 5, 1, 10);

  const sinceISO = typeof params.sinceISO === "string" ? params.sinceISO : null;
  const since = sinceISO ? new Date(sinceISO) : null;

  const rawMinScore = typeof params.minScore === "number" ? params.minScore : Number(params.minScore);
  const minScore = Number.isFinite(rawMinScore) ? clamp(rawMinScore, 0, 1) : null;

  const results = await searchSimilar(
    query,
    {
      userId,
      types: ["conversation_session_summary"],
      scopes: ["private"],
      status: "active",
      ...(since ? { createdAfter: since } : {}),
    },
    Math.max(20, limit)
  );

  const filtered = minScore !== null ? results.filter((r) => r.score >= minScore) : results;
  const top = filtered.slice(0, limit);

  return {
    conversations: top.map((r) => ({
      title: r.artifact.title ?? null,
      summary: truncate(r.artifact.content ?? "", 500),
      createdAtISO: toIsoOrNull(r.artifact.createdAt),
    })),
  };
}

async function getLifeContext(
  userId: string
): Promise<{
  hasContext: boolean;
  currentSeason: string | null;
  seasonNote: string | null;
  weeklyIntention: {
    carrying: string | null;
    hoping: string | null;
  } | null;
  prayerTopics: string[];
  goals: string[];
  sessionPreference: string | null;
  encouragementStyle: string;
}> {
  const context = await getActiveLifeContextForAI(userId);

  const hasContext = !!(
    context.currentSeason ||
    context.weeklyIntention?.carrying ||
    context.weeklyIntention?.hoping ||
    (context.prayerTopics && context.prayerTopics.length > 0) ||
    (context.goals && context.goals.length > 0)
  );

  return {
    hasContext,
    currentSeason: context.currentSeason ?? null,
    seasonNote: context.seasonNote ?? null,
    weeklyIntention: context.weeklyIntention
      ? {
          carrying: context.weeklyIntention.carrying ?? null,
          hoping: context.weeklyIntention.hoping ?? null,
        }
      : null,
    prayerTopics: context.prayerTopics ?? [],
    goals: context.goals ?? [],
    sessionPreference: context.sessionPreference ?? null,
    encouragementStyle: context.encouragementStyle,
  };
}

async function searchReadingPlans(params: Record<string, unknown>): Promise<{
  plans: Array<{
    id: string;
    shortId: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    totalDays: number;
    estimatedMinutes: string;
    theme: string | null;
    isFeatured: boolean;
    relevanceScore: number;
  }>;
}> {
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) return { plans: [] };

  const limit = clamp(Number(params.limit ?? 5) || 5, 1, 10);

  const results = await searchTemplates(query, limit);

  return {
    plans: results.map((r) => ({
      id: r.template.id,
      shortId: r.template.shortId,
      title: r.template.title,
      subtitle: r.template.subtitle,
      description: r.template.description ? truncate(r.template.description, 300) : null,
      totalDays: r.template.totalDays,
      estimatedMinutes: `${r.template.estimatedMinutesMin}-${r.template.estimatedMinutesMax}`,
      theme: r.template.theme,
      isFeatured: r.template.isFeatured,
      relevanceScore: Math.round(r.score * 100) / 100,
    })),
  };
}


