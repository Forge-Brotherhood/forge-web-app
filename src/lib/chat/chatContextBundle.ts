import { z } from "zod";
import { TOOL_ENABLED_GUIDE_SYSTEM_PROMPT } from "@/lib/chat/toolEnabledSystemPrompt";
import type { ResponsesInputMessage } from "@/lib/openai/responsesClient";

export type ChatEntrypoint = "bible_reader" | "home" | "community" | "other";
export type ChatMode = "general" | "bible";

const noteSchema = z.object({
  text: z.string().min(1).max(400),
  keywords: z.array(z.string().max(40)).max(8).optional(),
});

/**
 * What the Guide knows about the user for this request. The app sends it each time, read from
 * the user's own encrypted records; the server keeps none of it.
 */
export const chatContextSchema = z.object({
  profile: z
    .object({
      name: z.string().max(100).optional(),
      preferredTranslation: z.string().max(20).optional(),
      explanationStyle: z.string().max(40).optional(),
      experienceLevel: z.string().max(40).optional(),
      studyIntent: z.array(z.string().max(40)).max(8).optional(),
      season: z.string().max(40).optional(),
      seasonNote: z.string().max(200).optional(),
      weeklyCarrying: z.string().max(500).optional(),
      weeklyHoping: z.string().max(500).optional(),
      prayerTopics: z.array(z.string().max(200)).max(5).optional(),
    })
    .optional(),
  /** False when the user has turned memory off. */
  memoryEnabled: z.boolean().optional(),
  sessionNotes: z.array(noteSchema).max(20).optional(),
  globalNotes: z.array(noteSchema).max(20).optional(),
});

export type ChatContext = z.infer<typeof chatContextSchema>;

type MemoryNote = z.infer<typeof noteSchema>;

export type ChatContextBundle = {
  /** The profile and memory blocks, as given to the model. */
  injectedInstructions: string;
  /** System messages for this request. They are rebuilt each time and never part of the history. */
  instructions: ResponsesInputMessage[];
  /** What the user's message adds to the conversation. */
  input: ResponsesInputMessage[];
};

/** A neutral line of guidance from what the user said they hope to find in study. */
const userGuidanceFrom = (studyIntent: string[] | undefined): string => {
  const descriptors = (studyIntent ?? [])
    .map((intent) => ({ peace: "peaceful", understanding: "clear", encouragement: "encouraging", guidance: "practical" })[intent])
    .filter(Boolean)
    .slice(0, 2);
  return descriptors.length ? `appreciates ${descriptors.join(", ")} explanations` : "";
};

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

const formatKeywords = (keywords: string[] | undefined): string => {
  const kws = (keywords ?? []).filter(Boolean).slice(0, 6);
  return kws.length ? ` Keywords: ${kws.join(", ")}.` : "";
};

const buildUserProfileBlock = (args: {
  name?: string;
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
  const name = args.name?.trim() || "";
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
  const session = args.sessionNotes.filter((n) => normalizeWhitespace(n.text).length > 0).slice(0, 20);
  const global = args.globalNotes.filter((n) => normalizeWhitespace(n.text).length > 0).slice(0, 20);

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
    "The user has selected one or more verses. Treat the selected passage as the sole focus.",
    "",
    "Write an explanation immediately. Do not include a greeting.",
    "Keep it concise and grounded in the text.",
    "Avoid em dashes. Prefer periods or short sentences.",
    "Do not quote large blocks of the passage.",
    "Do not add personal application unless the user asks.",
  ].join("\n");
};

export function buildChatContextBundle(args: {
  context: ChatContext | undefined;
  entrypoint: ChatEntrypoint;
  mode: ChatMode;
  isNewConversation: boolean;
  message: string;
  verseReference?: string;
  verseText?: string;
  selectionState?: "selected" | "visible";
}): ChatContextBundle {
  const profile = args.context?.profile;
  const profileBlock = buildUserProfileBlock({
    name: profile?.name,
    preferredTranslation: profile?.preferredTranslation,
    explanationStyle: profile?.explanationStyle,
    experienceLevel: profile?.experienceLevel,
    userGuidance: userGuidanceFrom(profile?.studyIntent),
    life: {
      currentSeason: profile?.season,
      seasonNote: profile?.seasonNote,
      weeklyCarrying: profile?.weeklyCarrying,
      weeklyHoping: profile?.weeklyHoping,
      prayerTopics: profile?.prayerTopics,
    },
  });

  const notesBlock =
    args.context?.memoryEnabled === false
      ? "<memory_notes>\nDisabled.\n</memory_notes>"
      : buildMemoryNotesBlock({
          sessionNotes: args.context?.sessionNotes ?? [],
          globalNotes: args.context?.globalNotes ?? [],
        }).blockText;

  const injectedInstructions = [profileBlock, notesBlock].join("\n\n");

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

  const userMessage = isBibleReaderStart ? "Begin." : args.message;

  return {
    injectedInstructions,
    // The fixed prompt goes first and on its own, so its cached prefix is shared by every request.
    instructions: [
      { role: "system", content: TOOL_ENABLED_GUIDE_SYSTEM_PROMPT },
      { role: "system", content: [injectedInstructions, startAddendum].filter(Boolean).join("\n\n") },
    ],
    input: [...(passageMessage ? [passageMessage] : []), { role: "user", content: userMessage }],
  };
}
