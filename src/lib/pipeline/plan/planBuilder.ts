import type { ArtifactType } from "@/lib/artifacts/types";
import { parseReference } from "@/lib/bibleReference";
import {
  RESPONSE_MODES,
  RETRIEVAL_NEEDS,
  type Plan,
  type ResponseMode,
  type RetrievalNeed,
  type TemporalFilter,
  type ScriptureScope,
} from "./types";

type BuildPlanInput = {
  message: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  isFirstMessage: boolean;
};

// NOTE: Keep this mapping self-contained to avoid importing heavier modules with side effects.
const BOOK_NAME_TO_CODE: Record<string, string> = {
  genesis: "GEN",
  exodus: "EXO",
  leviticus: "LEV",
  numbers: "NUM",
  deuteronomy: "DEU",
  joshua: "JOS",
  judges: "JDG",
  ruth: "RUT",
  "1 samuel": "1SA",
  "2 samuel": "2SA",
  "1 kings": "1KI",
  "2 kings": "2KI",
  "1 chronicles": "1CH",
  "2 chronicles": "2CH",
  ezra: "EZR",
  nehemiah: "NEH",
  esther: "EST",
  job: "JOB",
  psalms: "PSA",
  psalm: "PSA",
  proverbs: "PRO",
  ecclesiastes: "ECC",
  "song of solomon": "SNG",
  "song of songs": "SNG",
  isaiah: "ISA",
  jeremiah: "JER",
  lamentations: "LAM",
  ezekiel: "EZK",
  daniel: "DAN",
  hosea: "HOS",
  joel: "JOL",
  amos: "AMO",
  obadiah: "OBA",
  jonah: "JON",
  micah: "MIC",
  nahum: "NAM",
  habakkuk: "HAB",
  zephaniah: "ZEP",
  haggai: "HAG",
  zechariah: "ZEC",
  malachi: "MAL",
  matthew: "MAT",
  mark: "MRK",
  luke: "LUK",
  john: "JHN",
  acts: "ACT",
  romans: "ROM",
  "1 corinthians": "1CO",
  "2 corinthians": "2CO",
  galatians: "GAL",
  ephesians: "EPH",
  philippians: "PHP",
  colossians: "COL",
  "1 thessalonians": "1TH",
  "2 thessalonians": "2TH",
  "1 timothy": "1TI",
  "2 timothy": "2TI",
  titus: "TIT",
  philemon: "PHM",
  hebrews: "HEB",
  james: "JAS",
  "1 peter": "1PE",
  "2 peter": "2PE",
  "1 john": "1JN",
  "2 john": "2JN",
  "3 john": "3JN",
  jude: "JUD",
  revelation: "REV",
};

const PERSONAL_ARTIFACT_TYPES: ArtifactType[] = [
  "conversation_session_summary",
  "journal_entry",
  "prayer_request",
  "prayer_update",
  "testimony",
  "verse_highlight",
  "verse_note",
];

const SELF_HARM_PATTERN = /\b(suicid|self.?harm|kill myself)\b/i;
const VIOLENCE_PATTERN = /\b(abuse|assault|violence)\b/i;

const SELF_DISCLOSURE_PATTERNS: RegExp[] = [
  /i('m| am) (struggling|wrestling|having trouble)/i,
  /i (feel|felt)/i,
  /i (always|never|keep)/i,
  /my (problem|issue|struggle)/i,
  /i('ve| have|'ve got| got) (a |an )?[a-z]+ (issue|issues|problem|problems|struggle|struggles|difficulty|difficulties)\b/i,
];

const SITUATIONAL_PATTERNS: RegExp[] = [
  /\b(this weekend|tomorrow|today|tonight|next week|next month|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
  /\b(i('?m| am) (traveling|travelling|flying|going to)|trip to)\b/i,
];

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function isReadingHistoryQuery(message: string): boolean {
  return [
    /\bsummariz(e|ing)\b[^?.!]*\b(read|reading|readings)\b/i,
    /\bwhere\b[^?.!]*\b(i|we)\b[^?.!]*\b(read|reading)\b/i,
    /\bwhat\b[^?.!]*\b(i|we)\b[^?.!]*\b(read|reading)\b/i,
    /\b(where|what)\b[^?.!]*\bbeen\b[^?.!]*\b(read|reading)\b/i,
    /\bwhat have i been reading\b/i,
    /\bwhere have i been reading\b/i,
    /\brecently\b[^?.!]*\b(read|reading)\b/i,
    /\b(read|reading)\b[^?.!]*\brecently\b/i,
    /\blast (day|week|month|year)\b[^?.!]*\b(read|reading)\b/i,
  ].some((pattern) => pattern.test(message));
}

function isBibleReadingResumeQuery(message: string, scope: ScriptureScope | undefined): boolean {
  const isResumePhrase =
    /\b(pick up|pick-up|resume|continue)\b/i.test(message) || /\bwhere we left off\b/i.test(message);
  return (
    isResumePhrase &&
    (scope != null || /\b(bible|read|reading|chapter|verse|scripture|passage)\b/i.test(message))
  );
}

function detectSafetyFlags(message: string): { selfHarm: boolean; violence: boolean } {
  return {
    selfHarm: SELF_HARM_PATTERN.test(message),
    violence: VIOLENCE_PATTERN.test(message),
  };
}

function detectTemporalFilter(message: string): TemporalFilter | undefined {
  const m = message.toLowerCase();
  if (m.includes("today")) return { range: "last_day" };
  if (m.includes("this week")) return { range: "last_week" };
  if (m.includes("last week")) return { range: "last_week" };
  if (m.includes("this month")) return { range: "last_month" };
  if (m.includes("last month")) return { range: "last_month" };
  if (m.includes("last year")) return { range: "last_year" };
  if (m.includes("this year")) return { range: "this_year" };
  if (m.includes("last 3 months") || m.includes("last three months")) return { range: "last_3_months" };
  if (m.includes("yesterday") || m.includes("last day")) return { range: "last_day" };
  return undefined;
}

function isResumeOrContinuePhrase(message: string): boolean {
  return (
    /\b(pick up|pick-up|continue|resume|pick it back up|pick back up)\b/i.test(message) ||
    /\bwhere we left (off|it)\b/i.test(message)
  );
}

function detectResponseMode(message: string): ResponseMode {
  if (isResumeOrContinuePhrase(message)) return RESPONSE_MODES.continuity;
  if (/\bpray|prayer\b/i.test(message)) return RESPONSE_MODES.pastoral;
  if (/\b(struggling|anxious|worried|afraid|scared|guilty|hopeless)\b/i.test(message)) return RESPONSE_MODES.pastoral;
  if (/\b(word study|cross.?reference|greek|hebrew)\b/i.test(message)) return RESPONSE_MODES.study;
  if (/\b(apply|application|practice|how do i)\b/i.test(message)) return RESPONSE_MODES.coach;
  return RESPONSE_MODES.explain;
}

function detectSelfDisclosure(message: string): boolean {
  return SELF_DISCLOSURE_PATTERNS.some((p) => p.test(message));
}

function detectSituational(message: string): boolean {
  return SITUATIONAL_PATTERNS.some((p) => p.test(message));
}

function normalizeForScopeDetection(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bookNameToBookId(bookName: string): string | undefined {
  return BOOK_NAME_TO_CODE[bookName.toLowerCase()];
}

function detectScriptureScope(message: string): ScriptureScope | undefined {
  const trimmed = message.trim();
  const normalized = normalizeForScopeDetection(trimmed);

  // 1) Prefer explicit references with chapter (e.g., "Romans 8" or "Romans 8:1")
  const chapterLike = trimmed.match(
    /(\b(?:[1-3]\s*)?[A-Za-z]+(?:\s+[A-Za-z]+){0,2}\s+\d+(?::\d+(?:-\d+)?)?\b)/g
  );
  if (chapterLike) {
    for (const candidate of chapterLike) {
      const attempts: string[] = [candidate];
      const tokens = candidate.split(/\s+/g).filter(Boolean);
      if (tokens.length > 2) {
        // Heuristic: strip leading non-book tokens like "in/into/from" that can get captured by the regex.
        attempts.push(tokens.slice(1).join(" "));
        attempts.push(tokens.slice(2).join(" "));
      }

      let parsed = null as ReturnType<typeof parseReference>;
      for (const attempt of attempts) {
        parsed = parseReference(attempt);
        if (parsed) break;
      }
      if (!parsed) continue;

      const bookId = bookNameToBookId(parsed.book);
      if (!bookId) continue;

      // If the matched reference included a chapter (always), treat as chapter scope
      return { kind: "chapter", bookId, bookName: parsed.book, chapter: parsed.chapter };
    }
  }

  // 2) Book-only mentions (e.g., "John last month")
  const keys = Object.keys(BOOK_NAME_TO_CODE)
    .filter((k) => k.includes(" ")) // prefer full names like "1 john", but also keep simple ones like "john" below
    .concat(Object.keys(BOOK_NAME_TO_CODE).filter((k) => !k.includes(" ")))
    .sort((a, b) => b.length - a.length);

  for (const key of keys) {
    if (!key || key.length < 3) continue;
    const pattern = new RegExp(`\\b${escapeRegex(key)}\\b`, "i");
    if (!pattern.test(normalized)) continue;
    const bookId = BOOK_NAME_TO_CODE[key];
    if (!bookId) continue;
    return { kind: "book", bookId, bookName: key.replace(/\b\w/g, (c) => c.toUpperCase()) };
  }

  return undefined;
}

function buildPlanRules(input: BuildPlanInput): Plan | null {
  const message = input.message.trim();
  if (!message) return null;

  const temporal = detectTemporalFilter(message);
  const scope = detectScriptureScope(message);

  const needs: RetrievalNeed[] = [];
  const lower = message.toLowerCase();

  const hasConversationHistory = (input.conversationHistory?.length ?? 0) >= 1 && !input.isFirstMessage;
  const isResumePhrase = isResumeOrContinuePhrase(message);
  const isBibleReadingResume = isBibleReadingResumeQuery(message, scope);
  // If the user is asking to "pick up where we left off" and this isn't about Bible reading,
  // request session summaries so we can rehydrate prior context, even if the in-memory
  // conversation history is short.
  const isConversationResume =
    isResumePhrase && !input.isFirstMessage && !isBibleReadingResume && (hasConversationHistory || /\bconversation\b/i.test(message));

  const isReadingHistory = isReadingHistoryQuery(message);

  if (isConversationResume) {
    needs.push(RETRIEVAL_NEEDS.conversation_session_summaries);
  }
  if (isBibleReadingResume || isReadingHistory) {
    // Reading sessions are first-class (structured, recency-driven), not semantic artifacts.
    needs.push(RETRIEVAL_NEEDS.bible_reading_sessions);
  }

  const isHighlightsQuery = /\bhighlight(s)?\b/i.test(message);
  const isNotesQuery = /\b(note|notes)\b/i.test(message);
  const isLearningsSummary = [
    /\b(summarize|summarise)\b/i,
    /\bmy learnings?\b/i,
    /\bwhat (?:did|have) i (?:learn|learned|learnt)\b/i,
    /\bwhat i (?:have )?(?:learn|learned|learnt)\b/i,
    /\bwhat\b[^?.!]*\b(i|my)\b[^?.!]*\b(learn|learned|learnt|learnings?)\b/i,
  ].some((pattern) => pattern.test(message));

  if (isHighlightsQuery) needs.push(RETRIEVAL_NEEDS.verse_highlights);
  if (isNotesQuery) needs.push(RETRIEVAL_NEEDS.verse_notes);
  if (isLearningsSummary) {
    needs.push(RETRIEVAL_NEEDS.verse_highlights, RETRIEVAL_NEEDS.verse_notes);
    needs.push(RETRIEVAL_NEEDS.artifact_semantic);
  }

  const isTopicReflections =
    /\b(reflection|reflections)\b/i.test(message) ||
    /\bwhat are some of my\b/i.test(message);

  if (isTopicReflections) {
    needs.push(RETRIEVAL_NEEDS.artifact_semantic);
  }

  const selfDisclosure = detectSelfDisclosure(message);
  const situational = detectSituational(message);

  if (selfDisclosure || /\b(struggling|anxious|worried|afraid)\b/i.test(message)) {
    needs.push(RETRIEVAL_NEEDS.user_memory);
  }

  // If nothing matched, we can't confidently plan without an LLM
  if (needs.length === 0) return null;

  const responseMode = detectResponseMode(message);
  const safetyFlags = detectSafetyFlags(message);

  return {
    response: {
      responseMode,
      lengthTarget: isLearningsSummary ? "medium" : "short",
      safetyFlags,
      flags: { selfDisclosure, situational },
      signals: [
        ...(isConversationResume ? ["conversation_resume_detected"] : []),
        ...(isBibleReadingResume ? ["bible_reading_resume_detected"] : []),
        ...(isReadingHistory ? ["reading_history_query"] : []),
        ...(isHighlightsQuery ? ["highlights_query"] : []),
        ...(isNotesQuery ? ["notes_query"] : []),
        ...(isLearningsSummary ? ["learning_summary_query"] : []),
        ...(isTopicReflections ? ["topic_reflections_query"] : []),
      ],
      source: "rules",
      confidence: 0.75,
    },
    retrieval: {
      needs: uniq(needs),
      filters: {
        ...(temporal ? { temporal } : {}),
        ...(scope ? { scope } : {}),
      },
      query: lower,
      artifactTypes: PERSONAL_ARTIFACT_TYPES,
      limits: {
        [RETRIEVAL_NEEDS.user_memory]: 10,
        [RETRIEVAL_NEEDS.verse_highlights]: 20,
        [RETRIEVAL_NEEDS.verse_notes]: 20,
        [RETRIEVAL_NEEDS.artifact_semantic]: 10,
        [RETRIEVAL_NEEDS.conversation_session_summaries]: 5,
        [RETRIEVAL_NEEDS.bible_reading_sessions]: 10,
      },
    },
  };
}

type PlanLLMResponse = Plan;

function sanitizeScriptureScope(scope: unknown): ScriptureScope | undefined {
  if (!scope || typeof scope !== "object") return undefined;

  const kind = (scope as { kind?: unknown }).kind;
  const bookId = (scope as { bookId?: unknown }).bookId;
  const bookName = (scope as { bookName?: unknown }).bookName;
  const chapter = (scope as { chapter?: unknown }).chapter;

  if (kind !== "book" && kind !== "chapter") return undefined;
  if (typeof bookId !== "string" || !bookId.trim()) return undefined;

  const cleanedBookName =
    typeof bookName === "string" && bookName.trim() ? bookName.trim() : undefined;

  if (kind === "book") {
    return { kind: "book", bookId: bookId.trim(), ...(cleanedBookName ? { bookName: cleanedBookName } : {}) };
  }

  if (typeof chapter !== "number" || !Number.isFinite(chapter) || chapter <= 0) return undefined;
  return {
    kind: "chapter",
    bookId: bookId.trim(),
    chapter: Math.floor(chapter),
    ...(cleanedBookName ? { bookName: cleanedBookName } : {}),
  };
}

async function buildPlanLLM(input: BuildPlanInput): Promise<Plan | null> {
  const system = `You are a planning module for a Bible study app.\n\nReturn JSON only. Produce a Plan with:\n- response: { responseMode, lengthTarget, safetyFlags, flags, signals, source, confidence }\n- retrieval: { needs, filters, query, artifactTypes, limits }\n\nAllowed responseMode: ${Object.values(RESPONSE_MODES).join(", ")}\nAllowed retrieval.needs: ${Object.values(RETRIEVAL_NEEDS).join(", ")}\nTemporal ranges: last_day,last_week,last_month,last_3_months,last_year,this_year,all_time\nScope: { kind: \"book\"|\"chapter\", bookId: string, chapter?: number }\n\nUse these rules:\n- For questions about what/where the user has been reading recently (e.g. \"Where have I been reading in the Bible recently?\"), include retrieval.needs: [bible_reading_sessions]. Prefer this over artifact_semantic.\n- For \"resume/continue reading\" in the Bible, include bible_reading_sessions (and set filters.temporal/scope when implied).\n- For topical queries like \"reflections about marriage\", include artifact_semantic and artifactTypes should include: ${PERSONAL_ARTIFACT_TYPES.join(", ")}.\n- For conversation resume queries, include conversation_session_summaries.\n- For learnings summaries scoped to a book/chapter, include verse_highlights and verse_notes and set filters.scope.\n\nDo not include any keys beyond the schema.\n`;

  const user = `Message:\n${input.message}\n\nConversationHistoryLength: ${input.conversationHistory?.length ?? 0}\nIsFirstMessage: ${input.isFirstMessage}\n`;

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
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_completion_tokens: 450,
        reasoning_effort: "minimal",
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as PlanLLMResponse;
    if (!parsed?.response?.responseMode || !parsed?.retrieval?.needs) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeLlmPlan(plan: Plan, message: string): Plan {
  const detectedScope = detectScriptureScope(message);
  const detectedTemporal = detectTemporalFilter(message);
  const readingHistory = isReadingHistoryQuery(message);
  const readingResume = isBibleReadingResumeQuery(message, detectedScope);

  const isHighlightsQuery = /\bhighlight(s)?\b/i.test(message);
  const isNotesQuery = /\b(note|notes)\b/i.test(message);
  const isLearningsSummary = [
    /\b(summarize|summarise)\b/i,
    /\bmy learnings?\b/i,
    /\bwhat (?:did|have) i (?:learn|learned|learnt)\b/i,
    /\bwhat i (?:have )?(?:learn|learned|learnt)\b/i,
    /\bwhat\b[^?.!]*\b(i|my)\b[^?.!]*\b(learn|learned|learnt|learnings?)\b/i,
  ].some((pattern) => pattern.test(message));
  const isTopicReflections =
    /\b(reflection|reflections)\b/i.test(message) ||
    /\bwhat are some of my\b/i.test(message);

  const llmScopeRaw = plan.retrieval.filters?.scope as unknown;
  const llmScope = sanitizeScriptureScope(llmScopeRaw);

  const hasCanonicalBookId =
    !!llmScope?.bookId && /^[A-Z0-9]{3}$/.test(String(llmScope.bookId));

  const scope =
    detectedScope && !hasCanonicalBookId
      ? detectedScope
      : llmScope;

  const needsSet = new Set(plan.retrieval.needs);

  // If the LLM forgot to request reading sessions for reading-history/resume queries, fix it.
  if (readingHistory || readingResume) {
    needsSet.add(RETRIEVAL_NEEDS.bible_reading_sessions);

    // For pure reading-history questions, avoid unnecessary semantic retrieval.
    const shouldDropSemantic =
      readingHistory &&
      !isLearningsSummary &&
      !isTopicReflections &&
      !isHighlightsQuery &&
      !isNotesQuery;
    if (shouldDropSemantic) {
      needsSet.delete(RETRIEVAL_NEEDS.artifact_semantic);
    }
  }

  // Sanitize artifactTypes: LLM may include out-of-scope types (e.g., old bible_reading_session artifact type).
  const allowedArtifactTypeSet = new Set<ArtifactType>(PERSONAL_ARTIFACT_TYPES);
  const sanitizedArtifactTypes = Array.isArray(plan.retrieval.artifactTypes)
    ? (plan.retrieval.artifactTypes.filter((t) =>
        allowedArtifactTypeSet.has(t as ArtifactType)
      ) as ArtifactType[])
    : undefined;

  const limits = {
    ...(plan.retrieval.limits || {}),
    // Ensure defaults exist when LLM includes the need
    ...(needsSet.has(RETRIEVAL_NEEDS.bible_reading_sessions) &&
    plan.retrieval.limits?.[RETRIEVAL_NEEDS.bible_reading_sessions] === undefined
      ? { [RETRIEVAL_NEEDS.bible_reading_sessions]: 10 }
      : {}),
  } as typeof plan.retrieval.limits;

  return {
    ...plan,
    response: {
      ...plan.response,
      source: "llm",
    },
    retrieval: {
      ...plan.retrieval,
      needs: Array.from(needsSet),
      filters: {
        ...(plan.retrieval.filters || {}),
        ...(detectedTemporal ? { temporal: detectedTemporal } : {}),
        ...(scope ? { scope } : {}),
      },
      query: message.toLowerCase(),
      ...(sanitizedArtifactTypes ? { artifactTypes: sanitizedArtifactTypes } : {}),
      ...(limits ? { limits } : {}),
    },
  };
}

export async function buildPlan(input: BuildPlanInput): Promise<Plan> {
  const rulePlan = buildPlanRules(input);
  if (rulePlan) return rulePlan;

  const llmPlan = await buildPlanLLM(input);
  if (llmPlan) return normalizeLlmPlan(llmPlan, input.message);

  // Hard fallback: minimal safe plan
  return {
    response: {
      responseMode: RESPONSE_MODES.explain,
      lengthTarget: "short",
      safetyFlags: detectSafetyFlags(input.message),
      flags: {
        selfDisclosure: detectSelfDisclosure(input.message),
        situational: detectSituational(input.message),
      },
      signals: ["hard_fallback"],
      source: "rules",
      confidence: 0.3,
    },
    retrieval: {
      needs: [],
      filters: { temporal: detectTemporalFilter(input.message), scope: detectScriptureScope(input.message) },
      query: input.message,
      artifactTypes: PERSONAL_ARTIFACT_TYPES,
      limits: {},
    },
  };
}


