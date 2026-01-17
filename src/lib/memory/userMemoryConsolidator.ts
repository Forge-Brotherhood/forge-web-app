import { prisma } from "@/lib/prisma";
import { getUserMemoryState, upsertUserMemoryState, type MemoryNote } from "@/lib/memory/userMemoryStateStore";

type ConsolidationStats = {
  sessionNotesIn: number;
  sessionNotesInUnexpired: number;
  globalNotesIn: number;
  globalNotesOut: number;
  usedFallback: boolean;
};

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

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

const isValidIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
};

const isUnexpired = (note: Pick<MemoryNote, "expiresAtISO">, nowMs: number): boolean => {
  if (!note.expiresAtISO) return true;
  const exp = Date.parse(note.expiresAtISO);
  if (!Number.isFinite(exp)) return true;
  return exp > nowMs;
};

type ConsolidateOutput = {
  globalNotes: Array<{
    text: string;
    keywords?: string[];
    // required: provenance against inputs to reduce invention risk
    sources: { globalIdx?: number[]; sessionIdx?: number[] };
  }>;
};

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const clampList = <T>(arr: T[], max: number) => (arr.length > max ? arr.slice(0, max) : arr);

function buildConsolidationPrompt(args: {
  globalNotes: MemoryNote[];
  sessionNotes: MemoryNote[];
  nowISO: string;
}): string {
  // We keep the prompt explicit and “non-inventive”: output must reference sources.
  return [
    "You are consolidating user memory notes for a Bible study assistant.",
    "",
    "Rules (hard):",
    "- Output MUST be valid JSON only.",
    "- Do NOT invent new facts. Every output note must be grounded in at least one input note.",
    "- For each output note, include `sources.globalIdx` and/or `sources.sessionIdx` referencing the input indices you used.",
    "- Prefer durable, stable preferences/facts useful for future Bible study conversations.",
    "- Discard temporary or one-off notes (e.g., 'this week only', 'today only', time-bounded constraints).",
    "- Deduplicate near-duplicates; keep the most recent / clearest version.",
    "- Resolve conflicts with precedence: session notes override global notes.",
    "- Keep each note to 1–2 factual sentences. No instructions/policies.",
    "",
    `Now: ${args.nowISO}`,
    "",
    "Input global notes (durable):",
    JSON.stringify(
      args.globalNotes.map((n) => ({
        text: n.text,
        keywords: n.keywords,
        createdAtISO: n.createdAtISO,
      })),
      null,
      2
    ),
    "",
    "Input session notes (from this chat session; these are candidates, not guaranteed durable):",
    JSON.stringify(
      args.sessionNotes.map((n) => ({
        text: n.text,
        keywords: n.keywords,
        createdAtISO: n.createdAtISO,
      })),
      null,
      2
    ),
    "",
    "Output format:",
    JSON.stringify(
      {
        globalNotes: [
          {
            text: "string",
            keywords: ["string"],
            sources: { globalIdx: [0], sessionIdx: [0] },
          },
        ],
      },
      null,
      2
    ),
  ].join("\n");
}

async function llmConsolidate(args: {
  globalNotes: MemoryNote[];
  sessionNotes: MemoryNote[];
  openaiApiKey: string;
}): Promise<ConsolidateOutput | null> {
  // Use a small/cheap model; this is end-of-session only.
  const model = process.env.MEMORY_CONSOLIDATION_MODEL || "gpt-4o-mini";
  const nowISO = new Date().toISOString();

  const prompt = buildConsolidationPrompt({ globalNotes: args.globalNotes, sessionNotes: args.sessionNotes, nowISO });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.openaiApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "Return JSON only. Follow the output format exactly.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 800,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Memory consolidation model error: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return null;

  const parsed = safeJsonParse(content);
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const globalNotes = obj.globalNotes;
  if (!Array.isArray(globalNotes)) return null;

  return { globalNotes: globalNotes as ConsolidateOutput["globalNotes"] };
}

function validateConsolidationOutput(args: {
  output: ConsolidateOutput;
  globalNotesIn: MemoryNote[];
  sessionNotesIn: MemoryNote[];
}): Array<{ text: string; keywords: string[]; sources: { globalIdx?: number[]; sessionIdx?: number[] } }> | null {
  const maxOut = 60;
  const out: Array<{ text: string; keywords: string[]; sources: { globalIdx?: number[]; sessionIdx?: number[] } }> = [];
  const seen = new Set<string>();

  for (const item of clampList(args.output.globalNotes, maxOut)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as any;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!text) continue;
    if (text.length > 400) continue;
    if (looksSensitive(text) || looksInstructional(text)) continue;

    const sources = rec.sources;
    const src = (sources && typeof sources === "object" ? (sources as any) : {}) as {
      globalIdx?: unknown;
      sessionIdx?: unknown;
    };

    const globalIdx = Array.isArray(src.globalIdx)
      ? src.globalIdx.filter(
          (n: unknown): n is number =>
            typeof n === "number" && Number.isInteger(n) && n >= 0 && n < args.globalNotesIn.length
        )
      : [];
    const sessionIdx = Array.isArray(src.sessionIdx)
      ? src.sessionIdx.filter(
          (n: unknown): n is number =>
            typeof n === "number" && Number.isInteger(n) && n >= 0 && n < args.sessionNotesIn.length
        )
      : [];

    // Provenance required to reduce invention risk.
    if (globalIdx.length === 0 && sessionIdx.length === 0) continue;

    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);

    const keywords = Array.isArray(rec.keywords)
      ? rec.keywords.filter((k: unknown) => typeof k === "string" && k.trim()).slice(0, 8)
      : [];

    out.push({
      text,
      keywords,
      sources: {
        ...(globalIdx.length ? { globalIdx } : {}),
        ...(sessionIdx.length ? { sessionIdx } : {}),
      },
    });
  }

  return out;
}

function fallbackConsolidation(args: {
  globalNotes: MemoryNote[];
  sessionNotes: MemoryNote[];
}): MemoryNote[] {
  // Conservative fallback: append session notes to global and dedupe by normalized text.
  // (We are “starting fresh” and the tool capture already tries to keep notes durable-only.)
  const nowISO = new Date().toISOString();
  const all = [...args.globalNotes, ...args.sessionNotes].slice(-200);

  const byKey = new Map<string, MemoryNote>();
  for (const n of all) {
    const text = n.text.trim();
    if (!text) continue;
    if (text.length > 400) continue;
    if (looksSensitive(text) || looksInstructional(text)) continue;

    const key = normalize(text);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      text,
      keywords: Array.isArray(n.keywords) ? n.keywords.slice(0, 8) : [],
      createdAtISO: isValidIsoDate(n.createdAtISO) ? n.createdAtISO : nowISO,
    });
  }

  return Array.from(byKey.values()).slice(0, 200);
}

export async function consolidateUserMemoryOnChatEnd(args: {
  userId: string;
  conversationId: string;
}): Promise<{ stats: ConsolidationStats; globalNotesAfter: MemoryNote[] }> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const nowMs = Date.now();

  const notesRaw = await prisma.chatSessionMemoryNote.findMany({
    where: { conversationId: args.conversationId, userId: args.userId },
    orderBy: [{ createdAt: "asc" }],
    take: 200,
    select: { text: true, keywords: true, createdAt: true, expiresAt: true },
  });

  const sessionNotesIn: MemoryNote[] = notesRaw
    .map((n) => ({
      text: typeof n.text === "string" ? n.text.trim() : "",
      keywords: Array.isArray(n.keywords) ? n.keywords.slice(0, 8) : [],
      createdAtISO: n.createdAt.toISOString(),
      ...(n.expiresAt ? { expiresAtISO: n.expiresAt.toISOString() } : {}),
    }))
    .filter((n) => n.text.length > 0);

  const sessionNotesInUnexpired = sessionNotesIn.filter((n) => isUnexpired(n, nowMs));
  const durableSessionNotes = sessionNotesInUnexpired.filter((n) => !n.expiresAtISO);
  const ttlSessionNotes = sessionNotesInUnexpired.filter((n) => Boolean(n.expiresAtISO));

  const { globalNotes: globalNotesIn } = await getUserMemoryState(args.userId);

  let usedFallback = false;
  let nextGlobalNotes: MemoryNote[] = [];

  try {
    const output = await llmConsolidate({
      globalNotes: globalNotesIn,
      sessionNotes: durableSessionNotes,
      openaiApiKey,
    });

    if (!output) {
      usedFallback = true;
      nextGlobalNotes = fallbackConsolidation({ globalNotes: globalNotesIn, sessionNotes: durableSessionNotes });
    } else {
      const validated = validateConsolidationOutput({
        output,
        globalNotesIn,
        sessionNotesIn: durableSessionNotes,
      });

      if (!validated) {
        usedFallback = true;
        nextGlobalNotes = fallbackConsolidation({ globalNotes: globalNotesIn, sessionNotes: durableSessionNotes });
      } else {
        const nowISO = new Date().toISOString();
        nextGlobalNotes = validated.map((n) => ({
          text: n.text,
          keywords: n.keywords,
          createdAtISO: nowISO,
        }));
      }
    }
  } catch {
    usedFallback = true;
    nextGlobalNotes = fallbackConsolidation({ globalNotes: globalNotesIn, sessionNotes: durableSessionNotes });
  }

  // IMPORTANT: Keep unexpired TTL session notes by promoting them into global notes *with expiresAtISO*.
  // This matches user expectations for time-bounded memories (e.g., “next week”).
  if (ttlSessionNotes.length) {
    const combined = [...nextGlobalNotes, ...ttlSessionNotes].slice(-240);
    const nowISO = new Date().toISOString();
    const byKey = new Map<string, MemoryNote>();
    for (const n of combined) {
      const text = n.text.trim();
      if (!text) continue;
      if (text.length > 400) continue;
      if (looksSensitive(text) || looksInstructional(text)) continue;
      const key = normalize(text);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        text,
        keywords: Array.isArray(n.keywords) ? n.keywords.slice(0, 8) : [],
        createdAtISO: typeof n.createdAtISO === "string" && n.createdAtISO ? n.createdAtISO : nowISO,
        ...(typeof n.expiresAtISO === "string" && n.expiresAtISO ? { expiresAtISO: n.expiresAtISO } : {}),
      });
    }
    nextGlobalNotes = Array.from(byKey.values()).slice(0, 200);
  }

  await upsertUserMemoryState({ userId: args.userId, globalNotes: nextGlobalNotes });

  // Clear session notes (best-effort).
  await prisma.chatSessionMemoryNote
    .deleteMany({
      where: { conversationId: args.conversationId, userId: args.userId },
    })
    .catch(() => {});

  return {
    stats: {
      sessionNotesIn: sessionNotesIn.length,
      sessionNotesInUnexpired: sessionNotesInUnexpired.length,
      globalNotesIn: globalNotesIn.length,
      globalNotesOut: nextGlobalNotes.length,
      usedFallback,
    },
    globalNotesAfter: nextGlobalNotes,
  };
}


