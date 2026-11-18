import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bibleService, getBookDisplayNameFromCode } from "@/lib/bible";
import type { BibleContentElement, BibleInline } from "@/core/models/bibleModels";
import type { ResponsesTool } from "@/lib/openai/responsesClient";
import { buildMapBlockFromModel, describePassagePlaces, type MapCardBlock, type PassagePlaces } from "@/lib/guide/places";

/**
 * Inline UI blocks for the Bible guide ("adaptive UI").
 *
 * The model asks for a block by calling the show_block tool mid-answer. The server
 * validates the arguments, fills in anything that must not come from the model
 * (Scripture text, display references), and streams a `block` SSE event at that
 * point in the answer. Clients opt in by sending the kinds they can render.
 */

export const GUIDE_BLOCK_KINDS = ["passage_card", "prayer_card", "cross_refs", "map_card", "quick_replies"] as const;
export type GuideBlockKind = (typeof GUIDE_BLOCK_KINDS)[number];

export const SHOW_BLOCK_TOOL_NAME = "show_block";

const MAX_PASSAGE_VERSES = 6;

export type GuideBlock =
  | {
      id: string;
      kind: "passage_card";
      v: 1;
      fallback_text: string;
      ref_key: string;
      book_id: string;
      chapter: number;
      verse_start: number;
      verse_end: number;
      reference: string;
      translation: string;
      verses: Array<{ n: number; text: string }>;
      note?: string;
    }
  | {
      id: string;
      kind: "prayer_card";
      v: 1;
      fallback_text: string;
      title?: string;
      body: string;
    }
  | {
      id: string;
      kind: "quick_replies";
      v: 1;
      fallback_text: string;
      /** Short answers to the guide's closing question, in the user's voice. Always sent last. */
      options: string[];
    }
  | {
      id: string;
      kind: "cross_refs";
      v: 1;
      fallback_text: string;
      title?: string;
      items: Array<{
        ref_key: string;
        book_id: string;
        chapter: number;
        verse_start?: number;
        verse_end?: number;
        reference: string;
        reason: string;
      }>;
    }
  | MapCardBlock;

/** Keep only kinds this server knows; unknown kinds from newer clients are ignored. */
export const parseClientBlockKinds = (kinds: string[] | undefined): GuideBlockKind[] =>
  GUIDE_BLOCK_KINDS.filter((k) => kinds?.includes(k));

// MARK: - Tool arguments (model-authored)

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : undefined));

const showBlockArgsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("passage_card"),
    ref_key: z.string().trim().min(1),
    note: optionalText(240),
  }),
  z.object({
    kind: z.literal("prayer_card"),
    title: optionalText(80),
    body: z.string().trim().min(20).max(1200),
  }),
  z.object({
    kind: z.literal("cross_refs"),
    title: optionalText(80),
    items: z
      .array(z.object({ ref_key: z.string().trim().min(1), reason: z.string().trim().min(1).max(160) }))
      .min(2)
      .max(6),
  }),
  z.object({
    kind: z.literal("map_card"),
    title: optionalText(80),
    caption: optionalText(200),
    places: z.array(z.string().trim().min(1)).min(1).max(8),
  }),
  z.object({
    kind: z.literal("quick_replies"),
    options: z
      .array(z.string().trim().min(1).max(60))
      .min(2)
      .max(4)
      .refine((o) => new Set(o.map((s) => s.toLowerCase())).size === o.length, "options must be distinct"),
  }),
]);

/** quick_replies always ends the reply, so the model need not be asked to continue after it. */
export const isQuickRepliesCall = (call: { name: string; argumentsJson: string }): boolean => {
  if (call.name !== SHOW_BLOCK_TOOL_NAME) return false;
  try {
    return (JSON.parse(call.argumentsJson) as { kind?: unknown })?.kind === "quick_replies";
  } catch {
    return false;
  }
};

export const buildShowBlockTool = (kinds: GuideBlockKind[]): ResponsesTool => ({
  type: "function",
  name: SHOW_BLOCK_TOOL_NAME,
  description:
    "Show the user an inline card inside your reply, at the point where you call this. Fields depend on kind.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...kinds] },
      ref_key: {
        type: "string",
        description:
          "passage_card only: BOOK:CHAPTER:VERSE or BOOK:CHAPTER:VERSE-VERSE with a three-letter book code, at most 6 verses (e.g. ROM:8:28, PSA:23:1-4, 1CO:13:4-7).",
      },
      note: { type: "string", description: "passage_card only, optional: one short sentence on why this passage matters here." },
      title: { type: "string", description: "prayer_card, cross_refs or map_card, optional: a short title." },
      caption: { type: "string", description: "map_card only, optional: one short sentence on what the map shows." },
      places: {
        type: "array",
        description: "map_card only: 1 to 8 place ids from the places list (or exact place names), most important first.",
        items: { type: "string" },
      },
      body: { type: "string", description: "prayer_card only: the prayer, in the first person, that the user can pray." },
      options: {
        type: "array",
        description:
          "quick_replies only: 2 to 4 distinct short answers to your closing question, written as the user would say them (first person, under 8 words each).",
        items: { type: "string" },
      },
      items: {
        type: "array",
        description: "cross_refs only: 2 to 6 related passages.",
        items: {
          type: "object",
          properties: {
            ref_key: { type: "string", description: "BOOK:CHAPTER, BOOK:CHAPTER:VERSE or BOOK:CHAPTER:VERSE-VERSE, e.g. JHN:10:11" },
            reason: { type: "string", description: "One short phrase on how it connects." },
          },
          required: ["ref_key", "reason"],
        },
      },
    },
    required: ["kind"],
  },
});

export const buildUiBlocksSystemPrompt = (kinds: GuideBlockKind[], passage: PassagePlaces | null = null): string => {
  const uses: Record<GuideBlockKind, string> = {
    passage_card:
      "- passage_card: when your answer centers on one specific verse or short passage (up to 6 verses) the user would want to read. Give only ref_key; the app shows the exact text, so do not quote that passage yourself.",
    prayer_card:
      "- prayer_card: whenever you offer a prayer. This replaces writing the prayer in your reply and the \"If you'd like, you can pray something like:\" pattern. Introduce it briefly, then put the whole prayer in body, in the first person, as a prayer the user can pray.",
    cross_refs:
      "- cross_refs: when pointing the user to 2 to 6 other passages on the same theme, each with a short reason. Use this instead of listing those references in your prose.",
    map_card:
      "- map_card: when the user asks where something happened, how far apart places are, or about travel, or when seeing the places genuinely helps. Pass the places that matter to the answer (not every place mentioned), by id from the places list when one is given. The app draws the map from its own place data; do not give coordinates.",
    quick_replies:
      "- quick_replies: the app can show answer buttons under your closing question. Call quick_replies whenever your reply ends with a question that offers the user choices (\"integrity, courage, or patience?\", \"go deeper or move on?\", \"which of these...?\") or that has 2 to 4 obvious short answers (for example which part of life this touches, or whether to go deeper or move on). This is required, not optional: if your question names its choices, the user must get them as buttons. When you offer choices, offer at most 4, and make each option one of the choices you named, written as the user's own answer (first person, under 8 words). Ask the question in your prose, then call quick_replies as the very last thing and write nothing after it; the user can still type their own answer. It does not count toward the card limit. Skip it only for open reflection questions that ask the user to put something personal in their own words (for example \"What is one thing you sense God asking of you?\"); a canned answer would cheapen that. A personal topic is not a reason to skip it when your question itself offers choices.",
  };
  const placesList = kinds.includes("map_card") ? describePassagePlaces(passage) : "";
  return [
    "INLINE CARDS (show_block tool):",
    "You can show the user an inline card by calling show_block. The card appears inside your reply exactly where you call it. Always write a short lead-in sentence BEFORE calling show_block; never call it before writing any text. After the card, add at most one closing sentence. Never repeat the card's content in your prose.",
    "Use at most 2 cards per reply, and only when a card genuinely helps more than prose:",
    ...kinds.map((k) => uses[k]),
    "ref_key uses three-letter book codes: GEN, EXO, PSA, PRO, ISA, MAT, MRK, LUK, JHN, ACT, ROM, 1CO, 2CO, GAL, EPH, PHP, COL, HEB, JAS, 1PE, 1JN, REV, and so on.",
    'If show_block returns "Rejected", continue your reply without that card.',
    ...(placesList ? [placesList] : []),
  ].join("\n");
};

// MARK: - Resolution

type ParsedRefKey = { bookId: string; chapter: number; verseStart?: number; verseEnd?: number };

const parseRefKey = (refKey: string): ParsedRefKey | null => {
  const m = refKey.trim().toUpperCase().match(/^([1-3]?[A-Z]{2,3}):(\d{1,3})(?::(\d{1,3})(?:-(\d{1,3}))?)?$/);
  if (!m) return null;
  const bookId = m[1];
  if (!getBookDisplayNameFromCode(bookId)) return null;
  const chapter = Number(m[2]);
  const verseStart = m[3] ? Number(m[3]) : undefined;
  const verseEnd = m[4] ? Number(m[4]) : verseStart;
  if (chapter < 1) return null;
  if (verseStart !== undefined && (verseStart < 1 || verseEnd === undefined || verseEnd < verseStart)) return null;
  return { bookId, chapter, verseStart, verseEnd };
};

// Matches the reference strings extractUiActionsDeterministic builds, so chips can be de-duplicated.
const displayReference = (ref: ParsedRefKey): string => {
  const book = getBookDisplayNameFromCode(ref.bookId) ?? ref.bookId;
  if (ref.verseStart === undefined) return `${book} ${ref.chapter}`;
  const range = ref.verseEnd === ref.verseStart ? `${ref.verseStart}` : `${ref.verseStart}-${ref.verseEnd}`;
  return `${book} ${ref.chapter}:${range}`;
};

const canonicalRefKey = (ref: ParsedRefKey): string => {
  if (ref.verseStart === undefined) return `${ref.bookId}:${ref.chapter}`;
  const range = ref.verseEnd === ref.verseStart ? `${ref.verseStart}` : `${ref.verseStart}-${ref.verseEnd}`;
  return `${ref.bookId}:${ref.chapter}:${range}`;
};

const inlineToText = (inline: BibleInline[]): string =>
  inline
    .map((i) => (i.type === "text" || i.type === "formatted_text" ? i.text : i.type === "inline_line_break" ? " " : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (text: string, maxLen: number): string =>
  text.length > maxLen ? `${text.slice(0, Math.max(0, maxLen - 1))}…` : text;

export type ShowBlockResult =
  | { ok: true; block: GuideBlock; unresolvedPlaces?: string[] }
  | { ok: false; reason: string; unresolved?: string[] };

export async function resolveShowBlockCall(args: {
  argumentsJson: string;
  allowedKinds: GuideBlockKind[];
  userId: string;
  blockId: string;
  /** Places in the passage the guide is about; used to resolve map_card places. */
  passage?: PassagePlaces | null;
}): Promise<ShowBlockResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(args.argumentsJson);
  } catch {
    return { ok: false, reason: "arguments were not valid JSON" };
  }

  const parsed = showBlockArgsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".") || "kind"}: ${i.message}`).join("; ") };
  }
  const input = parsed.data;
  if (!args.allowedKinds.includes(input.kind)) {
    return { ok: false, reason: `kind ${input.kind} is not available` };
  }

  if (input.kind === "map_card") {
    const result = await buildMapBlockFromModel({
      blockId: args.blockId,
      places: input.places,
      title: input.title,
      caption: input.caption,
      passage: args.passage ?? null,
    });
    return result.ok ? { ok: true, block: result.block, unresolvedPlaces: result.unresolved } : result;
  }

  if (input.kind === "quick_replies") {
    return {
      ok: true,
      block: {
        id: args.blockId,
        kind: "quick_replies",
        v: 1,
        options: input.options,
        fallback_text: `(Reply options: ${input.options.join(" / ")})`,
      },
    };
  }

  if (input.kind === "prayer_card") {
    return {
      ok: true,
      block: {
        id: args.blockId,
        kind: "prayer_card",
        v: 1,
        title: input.title,
        body: input.body,
        fallback_text: input.title ? `${input.title}: ${input.body}` : input.body,
      },
    };
  }

  if (input.kind === "cross_refs") {
    const items: Extract<GuideBlock, { kind: "cross_refs" }>["items"] = [];
    for (const item of input.items) {
      const ref = parseRefKey(item.ref_key);
      if (!ref) return { ok: false, reason: `invalid ref_key ${item.ref_key}` };
      items.push({
        ref_key: canonicalRefKey(ref),
        book_id: ref.bookId,
        chapter: ref.chapter,
        verse_start: ref.verseStart,
        verse_end: ref.verseEnd,
        reference: displayReference(ref),
        reason: item.reason,
      });
    }
    const list = items.map((i) => `${i.reference} (${i.reason})`).join("; ");
    return {
      ok: true,
      block: {
        id: args.blockId,
        kind: "cross_refs",
        v: 1,
        title: input.title,
        items,
        fallback_text: truncate(`See also: ${list}`, 2000),
      },
    };
  }

  // passage_card: Scripture text always comes from the Bible service, never from the model.
  const ref = parseRefKey(input.ref_key);
  if (!ref || ref.verseStart === undefined || ref.verseEnd === undefined) {
    return { ok: false, reason: "ref_key must be BOOK:CHAPTER:VERSE or BOOK:CHAPTER:VERSE-VERSE" };
  }
  if (ref.verseEnd - ref.verseStart + 1 > MAX_PASSAGE_VERSES) {
    return { ok: false, reason: `passage is longer than ${MAX_PASSAGE_VERSES} verses` };
  }

  const settings = await prisma.readerSettings.findUnique({
    where: { userId: args.userId },
    select: { selectedTranslation: true },
  });

  let verses: Array<{ n: number; text: string }>;
  let translation: string;
  try {
    const chapter = await bibleService.getChapterContent(`${ref.bookId}.${ref.chapter}`, settings?.selectedTranslation);
    translation = chapter.translation;
    verses = chapter.elements
      .filter(
        (el): el is Extract<BibleContentElement, { type: "verse" }> =>
          el.type === "verse" && el.number >= ref.verseStart! && el.number <= ref.verseEnd!
      )
      .map((el) => ({ n: el.number, text: inlineToText(el.inline) }))
      .filter((v) => v.text.length > 0);
  } catch {
    return { ok: false, reason: "passage could not be loaded" };
  }
  if (verses.length === 0) return { ok: false, reason: "no verses found for that ref_key" };

  const resolvedRef = { ...ref, verseStart: verses[0].n, verseEnd: verses[verses.length - 1].n };
  const reference = displayReference(resolvedRef);
  const text = verses.map((v) => v.text).join(" ");

  return {
    ok: true,
    block: {
      id: args.blockId,
      kind: "passage_card",
      v: 1,
      ref_key: canonicalRefKey(resolvedRef),
      book_id: ref.bookId,
      chapter: ref.chapter,
      verse_start: resolvedRef.verseStart,
      verse_end: resolvedRef.verseEnd,
      reference,
      translation,
      verses,
      note: input.note,
      fallback_text: truncate(`${reference}: "${text}"`, 2000),
    },
  };
}

const OPEN_QUESTION_START = /^(who|what|when|where|why|how|which|is|are|do|does|did|will|would|can|could|should)\b/i;

/**
 * Fallback for when the model ends on a question that lists its own choices after a colon
 * ("Where do you feel it most: pressure, compromise, or fear?") but did not call quick_replies.
 * Returns those choices as reply options, or null when the ending isn't such a list.
 */
export const closingChoiceOptions = (answerText: string): string[] | null => {
  const text = answerText.trim();
  if (!text.endsWith("?")) return null;
  const colon = text.lastIndexOf(": ");
  // The colon must be in the closing sentence.
  if (colon === -1 || /[.!?]\s/.test(text.slice(colon))) return null;
  const list = text.slice(colon + 2, -1).trim();
  if (OPEN_QUESTION_START.test(list)) return null;
  const items = list
    .split(/,\s*|\s+or\s+/)
    .map((i) => i.replace(/^(?:or|and)\s+/i, "").trim())
    .filter((i) => i && !/^(?:something|anything) else$/i.test(i));
  if (items.length < 2 || items.length > 5) return null;
  if (items.some((i) => i.length > 40 || i.split(/\s+/).length > 6)) return null;
  const options = items.map((i) => i.charAt(0).toUpperCase() + i.slice(1));
  return new Set(options.map((o) => o.toLowerCase())).size === options.length ? options : null;
};

/** References shown in blocks, so matching NAVIGATE_TO_VERSE chips can be dropped. */
export const blockReferences = (blocks: GuideBlock[]): Set<string> => {
  const refs = new Set<string>();
  for (const b of blocks) {
    if (b.kind === "passage_card") refs.add(b.reference);
    if (b.kind === "cross_refs") b.items.forEach((i) => refs.add(i.reference));
  }
  return refs;
};
