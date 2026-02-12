import { prisma } from "@/lib/prisma";
import { TOOL_ENABLED_GUIDE_SYSTEM_PROMPT } from "@/lib/chat/toolEnabledSystemPrompt";
import { getAiContextForUser } from "@/lib/ai/userContext";
import { getUserMemoryState, type MemoryNote } from "@/lib/memory/userMemoryStateStore";
import type { ResponsesInputMessage } from "@/lib/openai/responsesClient";

export type ChatEntrypoint = "bible_reader" | "home" | "community" | "other";
export type ChatMode = "general" | "bible";

export type ChatContextBundle = {
  conversationId: string;
  entrypoint: ChatEntrypoint;
  mode: ChatMode;
  previousResponseId: string | null;
  injectedInstructions: string;
  injection: { blockText: string; globalCount: number; sessionCount: number };
  messages: ResponsesInputMessage[];
  verseReference?: string;
};

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

const formatKeywords = (keywords: string[] | undefined): string => {
  const kws = (keywords ?? []).filter(Boolean).slice(0, 6);
  return kws.length ? ` Keywords: ${kws.join(", ")}.` : "";
};

const buildUserProfileBlock = (args: {
  displayName?: string;
  firstName?: string;
  preferredTranslation?: string;
  explanationStyle?: string;
  experienceLevel?: string;
  userGuidance?: string;
  life?: {
    currentSeason?: string;
    seasonNote?: string;
    weeklyCarrying?: string;
    weeklyHoping?: string;
    prayerTopics?: string[];
  };
}): string => {
  const name = args.firstName?.trim() || args.displayName?.trim() || "";
  const lines: string[] = [];
  lines.push("<user_profile>");
  if (name) lines.push(`Name: ${name}.`);
  if (args.preferredTranslation) lines.push(`Preferred translation: ${args.preferredTranslation}.`);
  if (args.explanationStyle) lines.push(`Explanation style: ${args.explanationStyle}.`);
  if (args.experienceLevel) lines.push(`Experience level: ${args.experienceLevel}.`);
  if (args.userGuidance?.trim()) lines.push(`Guidance: ${args.userGuidance.trim()}.`);

  const season = args.life?.currentSeason?.trim();
  const seasonNote = args.life?.seasonNote?.trim();
  if (season) lines.push(`Current season: ${season}${seasonNote ? ` (${seasonNote})` : ""}.`);
  if (args.life?.weeklyCarrying?.trim()) lines.push(`Weekly carrying: ${args.life.weeklyCarrying.trim()}.`);
  if (args.life?.weeklyHoping?.trim()) lines.push(`Weekly hoping: ${args.life.weeklyHoping.trim()}.`);
  if (args.life?.prayerTopics?.length) {
    lines.push(`Prayer topics: ${args.life.prayerTopics.slice(0, 5).join(", ")}.`);
  }
  lines.push("</user_profile>");
  return lines.join("\n");
};

const buildMemoryNotesBlock = (args: {
  sessionNotes: MemoryNote[];
  globalNotes: MemoryNote[];
}): { blockText: string; sessionCount: number; globalCount: number } => {
  const now = Date.now();
  const isUnexpired = (n: any) => {
    const exp = typeof n?.expiresAtISO === "string" ? Date.parse(n.expiresAtISO) : NaN;
    return !Number.isFinite(exp) || exp > now;
  };

  const session = args.sessionNotes
    .filter((n) => normalizeWhitespace(n.text).length > 0)
    .filter((n) => isUnexpired(n))
    .slice(0, 20);
  const global = args.globalNotes
    .filter((n) => normalizeWhitespace(n.text).length > 0)
    .filter((n) => isUnexpired(n))
    .slice(0, 20);

  const lines: string[] = [];
  lines.push("<memory_notes>");
  lines.push("Precedence: current user message > session notes > global notes.");
  lines.push("");
  lines.push("Session notes:");
  if (session.length) {
    for (const n of session) lines.push(`Session note: ${n.text.trim()}.${formatKeywords(n.keywords)}`);
  } else {
    lines.push("Session note: (none).");
  }
  lines.push("");
  lines.push("Global notes:");
  if (global.length) {
    for (const n of global) lines.push(`Global note: ${n.text.trim()}.${formatKeywords(n.keywords)}`);
  } else {
    lines.push("Global note: (none).");
  }
  lines.push("</memory_notes>");

  return { blockText: lines.join("\n"), sessionCount: session.length, globalCount: global.length };
};

const buildPassageUnderDiscussionMessage = (args: {
  verseReference?: string;
  verseText?: string;
}): ResponsesInputMessage | null => {
  const verseReference = args.verseReference?.trim();
  if (!verseReference) return null;

  const verseText = args.verseText?.trim();
  if (verseText) {
    return {
      role: "user",
      content: `Passage under discussion:\nReference: ${verseReference}\n\n"${verseText}"`,
    };
  }

  return {
    role: "user",
    content: `Passage under discussion:\nReference: ${verseReference}`,
  };
};

const buildBibleReaderVisibleStartSystemAddendum = (): string => {
  return [
    "BIBLE READER START: OPENING ORIENTATION (Prompt A)",
    "You are Guide, a warm, attentive Bible companion inside a Scripture reading app.",
    "The user has opened this chat while reading Scripture.",
    "Passage focus: Visible verses. Treat the provided passage as the sole focus of the response.",
    "",
    "Write:",
    "1) A short greeting (exactly 1 brief sentence).",
    "2) A brief orientation to the passage (2-4 short sentences).",
    "",
    "STYLE:",
    "- Simple, concrete, and unforced.",
    "- Avoid em dashes. Prefer periods or short sentences.",
    "",
    "AVOID:",
    "- Performative warmth, flattery, or overly literary phrasing.",
    "- Stock phrases (e.g., 'It is good to settle into this', 'I am glad to be here with you').",
    "- Pet names, emotional mirroring, or rhetorical flourishes.",
    "- Over-explaining or summarizing the passage.",
    "",
    "Name usage:",
    "- Only use the user's name if it reads naturally (e.g., 'Hi Matthew.'); otherwise omit it.",
    "",
    "The orientation should:",
    "- Acknowledge what the user is reading (book and chapter).",
    "- Situate the passage within its immediate biblical or literary context.",
    "- Hint at why this might stand out or feel challenging.",
    "",
    "Do not explain the passage.",
    "Do not ask questions.",
    "Do not apply the text personally.",
    "Do not quote the passage.",
  ].join("\n");
};

const buildBibleReaderSelectedStartSystemAddendum = (): string => {
  return [
    "BIBLE READER START: SELECTED VERSES (Explain start)",
    "You are Guide, a careful Bible teacher inside a Scripture reading app.",
    "The user has selected one or more verses. Treat the selected passage as the sole focus.",
    "",
    "Write an explanation immediately. Do not include a greeting.",
    "Keep it concise and grounded in the text.",
    "Avoid em dashes. Prefer periods or short sentences.",
    "Do not quote large blocks of the passage.",
    "Do not add personal application unless the user asks.",
  ].join("\n");
};

export async function buildChatContextBundle(args: {
  userId: string;
  conversationId: string;
  entrypoint: ChatEntrypoint;
  mode: ChatMode;
  previousResponseId: string | null;
  isNewConversation: boolean;
  message: string;
  verseReference?: string;
  verseText?: string;
  selectionState?: "selected" | "visible";
}): Promise<ChatContextBundle> {
  const aiContext = await getAiContextForUser(args.userId).catch(() => null);
  const userMemoryState = await getUserMemoryState(args.userId).catch(() => ({
    schemaVersion: "forge.user_memory_state.v1" as const,
    globalNotes: [] as MemoryNote[],
  }));
  const globalNotes: MemoryNote[] = userMemoryState.globalNotes;

  const now = new Date();
  const sessionNotesRaw = await prisma.chatSessionMemoryNote.findMany({
    where: {
      conversationId: args.conversationId,
      userId: args.userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    select: { text: true, keywords: true, createdAt: true, expiresAt: true },
  });
  const sessionNotes: MemoryNote[] = sessionNotesRaw
    .map((n) => ({
      text: String(n.text ?? "").trim(),
      keywords: Array.isArray(n.keywords) ? n.keywords.slice(0, 8) : [],
      createdAtISO: n.createdAt.toISOString(),
      ...(n.expiresAt ? { expiresAtISO: n.expiresAt.toISOString() } : {}),
    }))
    .filter((n) => n.text.length > 0);

  const profileBlock = buildUserProfileBlock({
    displayName: aiContext?.userProfile?.displayName,
    firstName: aiContext?.userProfile?.firstName,
    preferredTranslation: aiContext?.aiProfileContext?.preferredTranslation,
    explanationStyle: aiContext?.aiProfileContext?.explanationStyle,
    experienceLevel: aiContext?.aiProfileContext?.experienceLevel,
    userGuidance: aiContext?.aiProfileContext?.userGuidance,
    life: {
      currentSeason: aiContext?.lifeContext?.currentSeason,
      seasonNote: aiContext?.lifeContext?.seasonNote,
      weeklyCarrying: aiContext?.lifeContext?.weeklyIntention?.carrying,
      weeklyHoping: aiContext?.lifeContext?.weeklyIntention?.hoping,
      prayerTopics: aiContext?.lifeContext?.prayerTopics,
    },
  });

  const memoriesEnabled = aiContext?.retrievalPolicy?.enabled ?? true;
  const notesBlock = memoriesEnabled
    ? buildMemoryNotesBlock({ sessionNotes, globalNotes })
    : { blockText: "<memory_notes>\nDisabled.\n</memory_notes>", sessionCount: 0, globalCount: 0 };

  const injectedInstructions = [profileBlock, notesBlock.blockText].join("\n\n");

  const passageMessage = buildPassageUnderDiscussionMessage({
    verseReference: args.verseReference,
    verseText: args.verseText,
  });

  const isBibleReaderStart = args.entrypoint === "bible_reader" && args.mode === "bible" && args.isNewConversation;
  const startAddendum = isBibleReaderStart
    ? args.selectionState === "selected"
      ? buildBibleReaderSelectedStartSystemAddendum()
      : args.selectionState === "visible"
        ? buildBibleReaderVisibleStartSystemAddendum()
        : ""
    : "";

  const systemContent = [TOOL_ENABLED_GUIDE_SYSTEM_PROMPT, injectedInstructions, startAddendum]
    .filter(Boolean)
    .join("\n\n");

  const userMessage = isBibleReaderStart ? "Begin." : args.message;

  const messages: ResponsesInputMessage[] = [
    { role: "system", content: systemContent },
    ...(passageMessage ? [passageMessage] : []),
    { role: "user", content: userMessage },
  ];

  return {
    conversationId: args.conversationId,
    entrypoint: args.entrypoint,
    mode: args.mode,
    previousResponseId: args.previousResponseId,
    injectedInstructions,
    injection: {
      blockText: injectedInstructions,
      globalCount: notesBlock.globalCount,
      sessionCount: notesBlock.sessionCount,
    },
    messages,
    ...(args.verseReference ? { verseReference: args.verseReference } : {}),
  };
}

