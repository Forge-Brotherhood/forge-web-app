import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bibleService, getBookDisplayNameFromCode } from "@/lib/bible";
import type { BibleContentElement, BibleInline } from "@/core/models/bibleModels";
import type { ResponsesTool } from "@/lib/openai/responsesClient";
import { buildMapBlockFromModel, describePassagePlaces, type MapCardBlock, type PassagePlaces } from "@/lib/guide/places";
import { getAvailableTranslations, getCurrentProviderType, getDefaultTranslation } from "@/lib/bible/providers";

/**
 * Inline UI blocks for the Bible guide ("adaptive UI").
 *
 * The model asks for a block by calling the show_block tool mid-answer. The server
 * validates the arguments, fills in anything that must not come from the model
 * (Scripture text, display references), and streams a `block` SSE event at that
 * point in the answer. Clients opt in by sending the kinds they can render.
 */

export const GUIDE_BLOCK_KINDS = [
  "passage_card",
  "prayer_card",
  "cross_refs",
  "map_card",
  "quick_replies",
  "context_callout",
  "word_study",
  "compare_translations",
] as const;
export type GuideBlockKind = (typeof GUIDE_BLOCK_KINDS)[number];

export const SHOW_BLOCK_TOOL_NAME = "show_block";

const MAX_PASSAGE_VERSES = 6;
const MAX_COMPARE_VERSES = 3;
const MAX_COMPARE_TRANSLATIONS = 3;

const CONTEXT_CATEGORIES = ["historical", "cultural", "literary", "geographic"] as const;
type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];
const CONTEXT_CATEGORY_LABEL: Record<ContextCategory, string> = {
  historical: "Historical",
  cultural: "Cultural",
  literary: "Literary",
  geographic: "Geographic",
};

const WORD_LANGUAGES = ["hebrew", "aramaic", "greek"] as const;
type WordLanguage = (typeof WORD_LANGUAGES)[number];
const WORD_LANGUAGE_LABEL: Record<WordLanguage, string> = { hebrew: "Hebrew", aramaic: "Aramaic", greek: "Greek" };

/**
 * How each translation renders the text, so a comparison can explain why wording differs.
 * `dynamic` marks thought-for-thought translations, used to pick contrasting ones.
 */
const TRANSLATION_INFO: Record<string, { name: string; approach: string; dynamic: boolean }> = {
  BSB: { name: "Berean Standard Bible", approach: "Word-for-word · modern", dynamic: false },
  KJV: { name: "King James Version", approach: "Word-for-word · 1611", dynamic: false },
  ASV: { name: "American Standard Version", approach: "Word-for-word · 1901", dynamic: false },
  WEB: { name: "World English Bible", approach: "Word-for-word · modern", dynamic: false },
  NLT: { name: "New Living Translation", approach: "Thought-for-thought · modern", dynamic: true },
};
// Preferred extra translations, most useful contrast first.
const COMPARE_PREFERENCE = ["NLT", "KJV", "BSB", "WEB", "ASV"];

/** A tappable reference inside a card. */
type RefLink = {
  ref_key: string;
  book_id: string;
  chapter: number;
  verse_start?: number;
  verse_end?: number;
  reference: string;
};

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
  | {
      id: string;
      kind: "context_callout";
      v: 1;
      fallback_text: string;
      category: ContextCategory;
      title: string;
      body: string;
      /** The verse this background explains, if any. */
      anchor?: RefLink;
    }
  | {
      id: string;
      kind: "word_study";
      v: 1;
      fallback_text: string;
      /** The English word or phrase as it appears in the verse. */
      term: string;
      language: WordLanguage;
      /** The original word in its own script (validated to be Hebrew or Greek script). */
      original: string;
      transliteration: string;
      gloss: string;
      explanation: string;
      anchor?: RefLink;
      /** Other places the same original word appears. */
      related: Array<RefLink & { note: string }>;
    }
  | {
      id: string;
      kind: "compare_translations";
      v: 1;
      fallback_text: string;
      ref_key: string;
      book_id: string;
      chapter: number;
      verse_start: number;
      verse_end: number;
      reference: string;
      /** The reader's own translation, always the first rendering when it loads. */
      user_translation: string;
      renderings: Array<{
        translation: string;
        name: string;
        approach: string;
        verses: Array<{ n: number; text: string }>;
      }>;
      /** What to notice across the wordings. */
      note?: string;
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
  z.object({
    kind: z.literal("context_callout"),
    category: z.enum(CONTEXT_CATEGORIES),
    title: z.string().trim().min(1).max(60),
    // Room for the 2 to 3 sentences the prompt asks for; 420 rejected real answers.
    body: z.string().trim().min(40).max(700),
    ref_key: optionalText(20),
  }),
  z.object({
    kind: z.literal("word_study"),
    term: z.string().trim().min(1).max(40),
    language: z.enum(WORD_LANGUAGES),
    original: z.string().trim().min(1).max(40),
    transliteration: z.string().trim().min(1).max(40),
    gloss: z.string().trim().min(1).max(80),
    explanation: z.string().trim().min(40).max(420),
    ref_key: optionalText(20),
    related: z
      .array(z.object({ ref_key: z.string().trim().min(1), note: z.string().trim().min(1).max(80) }))
      .max(3)
      .nullish(),
  }),
  z.object({
    kind: z.literal("compare_translations"),
    ref_key: z.string().trim().min(1),
    translations: z.array(z.string().trim().min(2).max(8)).max(3).nullish(),
    note: optionalText(200),
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
          "passage_card and compare_translations: BOOK:CHAPTER:VERSE or BOOK:CHAPTER:VERSE-VERSE with a three-letter book code (e.g. ROM:8:28, PSA:23:1-4, 1CO:13:4-7); at most 6 verses for passage_card, 3 for compare_translations. context_callout and word_study, optional: the verse the card is about.",
      },
      note: {
        type: "string",
        description:
          "passage_card, optional: one short sentence on why this passage matters here. compare_translations, optional: one sentence on what to notice across the wordings.",
      },
      title: {
        type: "string",
        description: "context_callout (required, under 60 characters) or prayer_card, cross_refs, map_card (optional): a short title.",
      },
      category: {
        type: "string",
        enum: [...CONTEXT_CATEGORIES],
        description: "context_callout only: the kind of background.",
      },
      term: { type: "string", description: "word_study only: the English word or phrase exactly as it appears in the verse." },
      language: { type: "string", enum: [...WORD_LANGUAGES], description: "word_study only: the original language." },
      original: { type: "string", description: "word_study only: the original word in its own script (Hebrew or Greek letters)." },
      transliteration: { type: "string", description: "word_study only: the original word in Latin letters, e.g. hesed, agapē." },
      gloss: { type: "string", description: "word_study only: a short dictionary-style meaning, under 80 characters." },
      explanation: { type: "string", description: "word_study only: 2 to 3 sentences on what the word means in this verse and why it matters." },
      related: {
        type: "array",
        description: "word_study only, optional: up to 3 other verses where the same original word appears.",
        items: {
          type: "object",
          properties: {
            ref_key: { type: "string", description: "BOOK:CHAPTER:VERSE, e.g. PSA:136:1" },
            note: { type: "string", description: "A short phrase on how the word is used there." },
          },
          required: ["ref_key", "note"],
        },
      },
      translations: {
        type: "array",
        description: "compare_translations only, optional: up to 2 translation codes to include besides the user's own.",
        items: { type: "string" },
      },
      caption: { type: "string", description: "map_card only, optional: one short sentence on what the map shows." },
      places: {
        type: "array",
        description: "map_card only: 1 to 8 place ids from the places list (or exact place names), most important first.",
        items: { type: "string" },
      },
      body: {
        type: "string",
        description:
          "prayer_card: the prayer, in the first person, that the user can pray. context_callout: 2 to 3 sentences of background.",
      },
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
    context_callout:
      "- context_callout: when historical, cultural, literary or geographic background genuinely changes how the passage reads (customs, rulers and empires, genre, setting). Give a category, a short title and 2 to 3 sentences of well-established background; where scholars differ, say so plainly instead of picking a side. Use it instead of a long background digression in your prose, not for theology or application.",
    word_study:
      "- word_study: when the user asks what a word means, or when one key word's original Hebrew, Aramaic or Greek meaning genuinely opens up the verse. Give the English term exactly as it appears in the verse, the language, the original word in its own script, a transliteration, a short gloss, and 2 to 3 sentences on what it means here. Add up to 3 related verses where the same original word appears only if you are sure of them. Only include words and meanings you are confident of; never give Strong's numbers. The app labels the card as an AI study note.",
    compare_translations: `- compare_translations: when the way different Bible translations word a verse sheds light on its meaning (for example the user asks why their Bible says something, or a key phrase is rendered very differently). Give ref_key (1 to 3 verses) and a note on what to notice. The app shows the user's own translation first, adds contrasting ones, and fetches the exact text, so do not quote the translations yourself. Available translations: ${availableCompareTranslations().join(", ")}.`,
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

/**
 * What a show_block call will show, read from its arguments while the model is still writing
 * them: the kind as soon as it is written, then the reference once ref_key is complete.
 * Null until the kind is known, and for kinds that are not shown as a card (quick_replies).
 */
export const pendingBlockLabel = (
  partialArgs: string,
  allowedKinds: GuideBlockKind[]
): { kind: GuideBlockKind; reference: string | null } | null => {
  const kind = partialArgs.match(/"kind"\s*:\s*"([a-z_]+)"/)?.[1] as GuideBlockKind | undefined;
  if (!kind || kind === "quick_replies" || !allowedKinds.includes(kind)) return null;
  const refKey = partialArgs.match(/"ref_key"\s*:\s*"([^"]+)"/)?.[1];
  const ref = refKey ? parseRefKey(refKey) : null;
  return { kind, reference: ref ? displayReference(ref) : null };
};

const canonicalRefKey = (ref: ParsedRefKey): string => {
  if (ref.verseStart === undefined) return `${ref.bookId}:${ref.chapter}`;
  const range = ref.verseEnd === ref.verseStart ? `${ref.verseStart}` : `${ref.verseStart}-${ref.verseEnd}`;
  return `${ref.bookId}:${ref.chapter}:${range}`;
};

const inlineToText = (inline: BibleInline[]): string =>
  inline
    .map((i) => {
      if (i.type === "inline_line_break") return " ";
      if (i.type === "text") return i.text;
      // Each poetry line is its own piece with no separator, so start it with a space.
      if (i.type === "formatted_text") return i.poem ? ` ${i.text}` : i.text;
      return "";
    })
    .join("")
    // Some providers mark paragraphs with a pilcrow (e.g. KJV "¶ For God so loved…").
    .replace(/¶/g, "")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (text: string, maxLen: number): string =>
  text.length > maxLen ? `${text.slice(0, Math.max(0, maxLen - 1))}…` : text;

const toRefLink = (refKey: string | undefined): RefLink | undefined => {
  const ref = refKey ? parseRefKey(refKey) : null;
  if (!ref) return undefined;
  return {
    ref_key: canonicalRefKey(ref),
    book_id: ref.bookId,
    chapter: ref.chapter,
    verse_start: ref.verseStart,
    verse_end: ref.verseEnd,
    reference: displayReference(ref),
  };
};

/** Translations the current provider really serves. Others fall back silently to a different text. */
const availableCompareTranslations = (): string[] =>
  getAvailableTranslations(getCurrentProviderType()).filter((t) => TRANSLATION_INFO[t]);

/** The reader's translation, or the provider's default when the provider can't serve it. */
const readerTranslation = async (userId: string): Promise<string> => {
  const settings = await prisma.readerSettings.findUnique({
    where: { userId },
    select: { selectedTranslation: true },
  });
  const chosen = settings?.selectedTranslation?.trim().toUpperCase() ?? "";
  const provider = getCurrentProviderType();
  return getAvailableTranslations(provider).includes(chosen) ? chosen : getDefaultTranslation(provider);
};

const loadVerses = async (
  range: { bookId: string; chapter: number; verseStart: number; verseEnd: number },
  translation: string
): Promise<Array<{ n: number; text: string }>> => {
  const chapter = await bibleService.getChapterContent(`${range.bookId}.${range.chapter}`, translation);
  return chapter.elements
    .filter(
      (el): el is Extract<BibleContentElement, { type: "verse" }> =>
        el.type === "verse" && el.number >= range.verseStart && el.number <= range.verseEnd
    )
    .map((el) => ({ n: el.number, text: inlineToText(el.inline) }))
    .filter((v) => v.text.length > 0);
};

/** The reader's translation first, then any the model asked for, then the strongest contrasts. */
const pickCompareTranslations = (own: string, requested: string[]): string[] => {
  const available = availableCompareTranslations();
  const picked = available.includes(own) ? [own] : [];
  for (const raw of requested) {
    const code = raw.trim().toUpperCase();
    if (available.includes(code) && !picked.includes(code)) picked.push(code);
  }
  // Prefer a different approach (word-for-word vs thought-for-thought) to the reader's own.
  const ownDynamic = TRANSLATION_INFO[own]?.dynamic ?? false;
  const rest = COMPARE_PREFERENCE.filter((t) => available.includes(t) && !picked.includes(t)).sort(
    (a, b) => Number(TRANSLATION_INFO[a].dynamic === ownDynamic) - Number(TRANSLATION_INFO[b].dynamic === ownDynamic)
  );
  return [...picked, ...rest].slice(0, MAX_COMPARE_TRANSLATIONS);
};

// Sanity checks so a garbled or invented original word is rejected rather than shown.
const HEBREW_SCRIPT = /[֐-׿]/;
const GREEK_SCRIPT = /[Ͱ-Ͽἀ-῿]/;
const LATIN_LETTER = /[A-Za-z]/;
const TRANSLITERATION = /^[A-Za-zÀ-ɏḀ-ỿ̀-ͯ\s'’ʼʾʿ.-]+$/;

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

  if (input.kind === "context_callout") {
    return {
      ok: true,
      block: {
        id: args.blockId,
        kind: "context_callout",
        v: 1,
        category: input.category,
        title: input.title,
        body: input.body,
        // An unreadable anchor is dropped; the background itself is still useful.
        anchor: toRefLink(input.ref_key),
        fallback_text: `${CONTEXT_CATEGORY_LABEL[input.category]} background: ${input.title}. ${input.body}`,
      },
    };
  }

  if (input.kind === "word_study") {
    const isGreek = input.language === "greek";
    if (!(isGreek ? GREEK_SCRIPT : HEBREW_SCRIPT).test(input.original) || LATIN_LETTER.test(input.original)) {
      return { ok: false, reason: `original must be written in ${isGreek ? "Greek" : "Hebrew"} script` };
    }
    if (!TRANSLITERATION.test(input.transliteration)) {
      return { ok: false, reason: "transliteration must use Latin letters" };
    }
    const related: Extract<GuideBlock, { kind: "word_study" }>["related"] = [];
    for (const item of input.related ?? []) {
      const link = toRefLink(item.ref_key);
      // Skip a bad or repeated reference rather than losing the whole card.
      if (!link || related.some((r) => r.ref_key === link.ref_key)) continue;
      related.push({ ...link, note: item.note });
    }
    const language = WORD_LANGUAGE_LABEL[input.language];
    return {
      ok: true,
      block: {
        id: args.blockId,
        kind: "word_study",
        v: 1,
        term: input.term,
        language: input.language,
        original: input.original,
        transliteration: input.transliteration,
        gloss: input.gloss,
        explanation: input.explanation,
        anchor: toRefLink(input.ref_key),
        related,
        fallback_text: truncate(
          `Word study: "${input.term}" translates the ${language} ${input.original} (${input.transliteration}), "${input.gloss}". ${input.explanation} (AI study note)`,
          2000
        ),
      },
    };
  }

  if (input.kind === "compare_translations") {
    // Scripture text always comes from the Bible service, never from the model.
    const ref = parseRefKey(input.ref_key);
    if (!ref || ref.verseStart === undefined || ref.verseEnd === undefined) {
      return { ok: false, reason: "ref_key must be BOOK:CHAPTER:VERSE or BOOK:CHAPTER:VERSE-VERSE" };
    }
    if (ref.verseEnd - ref.verseStart + 1 > MAX_COMPARE_VERSES) {
      return { ok: false, reason: `compare at most ${MAX_COMPARE_VERSES} verses` };
    }
    const range = { bookId: ref.bookId, chapter: ref.chapter, verseStart: ref.verseStart, verseEnd: ref.verseEnd };
    const own = await readerTranslation(args.userId);
    const codes = pickCompareTranslations(own, input.translations ?? []);
    const loaded = await Promise.all(
      codes.map(async (code) => ({ code, verses: await loadVerses(range, code).catch(() => []) }))
    );
    const renderings = loaded
      .filter((r) => r.verses.length > 0)
      .map((r) => ({
        translation: r.code,
        name: TRANSLATION_INFO[r.code].name,
        approach: TRANSLATION_INFO[r.code].approach,
        verses: r.verses,
      }));
    if (renderings.length < 2) return { ok: false, reason: "fewer than two translations could be loaded" };

    const first = renderings[0].verses;
    const resolvedRef = { ...ref, verseStart: first[0].n, verseEnd: first[first.length - 1].n };
    const reference = displayReference(resolvedRef);
    const lines = renderings.map((r) => `${r.translation}: "${r.verses.map((v) => v.text).join(" ")}"`).join(" ");
    return {
      ok: true,
      block: {
        id: args.blockId,
        kind: "compare_translations",
        v: 1,
        ref_key: canonicalRefKey(resolvedRef),
        book_id: ref.bookId,
        chapter: ref.chapter,
        verse_start: resolvedRef.verseStart,
        verse_end: resolvedRef.verseEnd,
        reference,
        user_translation: own,
        renderings,
        note: input.note,
        fallback_text: truncate(`${reference} in ${renderings.length} translations: ${lines}${input.note ? ` ${input.note}` : ""}`, 2000),
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

  let verses: Array<{ n: number; text: string }>;
  let translation: string;
  try {
    translation = await readerTranslation(args.userId);
    verses = await loadVerses(
      { bookId: ref.bookId, chapter: ref.chapter, verseStart: ref.verseStart, verseEnd: ref.verseEnd },
      translation
    );
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
    if (b.kind === "compare_translations") refs.add(b.reference);
    if (b.kind === "word_study") b.related.forEach((r) => refs.add(r.reference));
    if ((b.kind === "word_study" || b.kind === "context_callout") && b.anchor) refs.add(b.anchor.reference);
  }
  return refs;
};
