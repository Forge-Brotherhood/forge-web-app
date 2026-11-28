import { prisma } from "@/lib/prisma";
import { getKVClient, CACHE_TTL_SECONDS, isCacheFresh } from "@/lib/kv";
import { BOOK_NAME_TO_CODE, getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";
import { LOW_CONFIDENCE } from "@/lib/guide/places";
import { CHAT_MODEL } from "@/lib/chat/chatModel";

/**
 * The short study note on a place sheet. One small model call per place, cached for everyone: the
 * model sees only public facts about the place (never the reader, never verse text), and its
 * answer is checked before it is cached or shown.
 */

export type PlaceFacts = {
  id: string;
  label: string;
  kind: string;
  types: string[];
  modernName: string | null;
  uncertain: boolean;
  /** Books that mention the place, most mentions first, e.g. { book: "Matthew", count: 5 }. */
  books: Array<{ book: string; count: number }>;
  /** A handful of references, e.g. "Matthew 2:1". */
  references: string[];
};

const MAX_BOOKS = 12;
const MAX_REFERENCES = 6;
const MIN_SENTENCES = 2;
const MAX_SENTENCES = 5;
const MAX_WORDS = 140;
const MAX_CHARS = 900;

/** Bump the version whenever the prompt or the model changes materially, so older notes are never served. */
export const placeSummaryKey = (placeId: string) => `bible:place-summary:v2:${placeId}`;

/**
 * The app's main model: a note is written once per place and then shown to everyone, so quality
 * matters more than speed or cost. PLACE_SUMMARY_MODEL overrides it.
 */
export const PLACE_SUMMARY_MODEL = process.env.PLACE_SUMMARY_MODEL || CHAT_MODEL;

/** Ids look like OpenBible's ("a112427"); anything else is never looked up. */
export const isPlaceId = (id: string): boolean => /^[a-z0-9]{1,16}$/.test(id);

export const PLACE_SUMMARY_SYSTEM_PROMPT = [
  "You write the short study note shown on a Bible app's map when someone taps a place, in the manner of a good study Bible's note on a place.",
  "You are given public facts about one place: its name, whether it is a site or a region, its kinds, its modern identification if any, whether its location is uncertain, and the books of the Bible that mention it. The app already shows these facts beside your note.",
  "",
  "Write three to five plain sentences, about 60 to 110 words. The reader wants cultural context: what the place was like and how people lived there in biblical times. Prefer these specifics, using each only when it is well established:",
  "- What the name means.",
  "- How far and in what direction it lies from one well-known anchor (Jerusalem, the Sea of Galilee, the Jordan, a major city), in kilometres when the distance is well known.",
  "- What the place lived on: crops, flocks, fishing, a trade route, a port, a pilgrimage road, a garrison, a royal or provincial seat.",
  "- Who lived there or ruled it, and when.",
  "- What a visitor in that period would have found there.",
  "Always include, in one sentence, its part in the Bible's story, stated precisely (David's home town, not the birthplace of David; where Jesus based his ministry, not where it began).",
  "",
  "Hard rules. Breaking any of them makes the note unusable:",
  "- Never quote Scripture or any other text, and never put words in quotation marks except a name's meaning. Refer to events in your own words.",
  "- Only state what is well established in mainstream scholarship or archaeology. Do not invent names, dates, numbers, crops or events. Where scholars disagree, say so briefly. Leave out a point rather than guess it.",
  "- Every sentence must carry a concrete fact. No general sentences, no filler.",
  "- Do not restate the facts you were given: no sentence saying the location is certain or matches a modern town, and no closing sentence that only says the place appears in the Old and New Testaments.",
  "- If little is known about the place, say plainly that little is known and stop at two or three sentences in total.",
  "- If the facts say the location is uncertain, say that the location is uncertain, name the main proposals only if they are well known, and do not describe the site as if it were known.",
  "- No modern politics, modern countries or modern borders. A modern town or site name may be given only to say where the ancient place was.",
  "- No superlatives and no praise words (most, greatest, famous, beautiful, remarkable).",
  "- Calm, factual reference prose in the present-day voice of a study note. Not a sermon, no application, no questions, not chatty, no lists, no headings.",
  "",
  'Output JSON only: {"summary":"…"}',
].join("\n");

/** The model's input: the place's public facts and nothing else. */
export const placeSummaryInput = (facts: PlaceFacts): string =>
  [
    `Place: ${facts.label}`,
    `Kind: ${facts.kind === "region" ? "region (an area, not a single town)" : `a single site${facts.types.length ? ` (${facts.types.join(", ")})` : ""}`}`,
    ...(facts.modernName ? [`Modern identification: ${facts.modernName}`] : []),
    `Location: ${facts.uncertain ? "uncertain (scholars are not confident where it was)" : "reasonably certain"}`,
    `Mentioned in: ${facts.books.map((b) => `${b.book} ${b.count}`).join(", ")}`,
    `Some references: ${facts.references.join("; ")}`,
  ].join("\n");

const countSentences = (text: string): number =>
  text.split(/[.!?]+(?:["'”’)]*)(?:\s+|$)/).filter((s) => s.trim()).length;

/** The summary as it will be shown, or null when it breaks a rule. */
export const checkSummary = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_CHARS) return null;
  if (text.split(" ").length > MAX_WORDS) return null;
  // A quoted passage of any length looks like Scripture from the model; refuse it.
  if (/["“”«»][^"“”«»]{25,}["“”«»]/.test(text)) return null;
  const sentences = countSentences(text);
  if (sentences < MIN_SENTENCES || sentences > MAX_SENTENCES) return null;
  return text;
};

const loadFacts = async (placeId: string): Promise<PlaceFacts | null> => {
  const place = await prisma.biblePlace.findUnique({
    where: { id: placeId },
    select: {
      id: true,
      label: true,
      kind: true,
      types: true,
      modernName: true,
      confidence: true,
      refs: { select: { bookId: true, chapter: true, verse: true }, orderBy: [{ bookId: "asc" }, { chapter: "asc" }, { verse: "asc" }] },
    },
  });
  if (!place) return null;
  return toFacts(place);
};

/** Facts from a place row and its verse references. */
export const toFacts = (place: {
  id: string;
  label: string;
  kind: string;
  types: string[];
  modernName: string | null;
  confidence: number;
  refs: Array<{ bookId: string; chapter: number; verse: number }>;
}): PlaceFacts => {
  const byBook = new Map<string, Array<{ chapter: number; verse: number }>>();
  for (const r of place.refs) byBook.set(r.bookId, [...(byBook.get(r.bookId) ?? []), r]);
  const books = [...byBook.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_BOOKS);
  const name = (bookId: string) => getBookDisplayNameFromCode(bookId) ?? bookId;
  return {
    id: place.id,
    label: place.label,
    kind: place.kind,
    types: place.types,
    modernName: place.modernName,
    uncertain: place.confidence < LOW_CONFIDENCE,
    books: books.map(([bookId, refs]) => ({ book: name(bookId), count: refs.length })),
    // The first mention in each of the books that mention it most.
    references: books.slice(0, MAX_REFERENCES).map(([bookId, refs]) => `${name(bookId)} ${refs[0].chapter}:${refs[0].verse}`),
  };
};

/**
 * One model call, made the way the heartbeat calls the same model (Responses API, low reasoning,
 * JSON out, room for reasoning so the answer is never cut off). The raw summary, or null on failure.
 */
const generate = async (facts: PlaceFacts): Promise<string | null> => {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) return null;
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: PLACE_SUMMARY_MODEL,
      store: false,
      reasoning: { effort: "low" },
      instructions: PLACE_SUMMARY_SYSTEM_PROMPT,
      // The API requires the word JSON in the input itself for a JSON answer.
      input: `${placeSummaryInput(facts)}\n\nAnswer with the JSON object only.`,
      max_output_tokens: 4000,
      text: { format: { type: "json_object" } },
    }),
  }).catch(() => null);
  if (!resp?.ok) return null;
  const output = ((await resp.json().catch(() => null)) as any)?.output ?? [];
  const content = output.flatMap((item: any) => item?.content ?? []).find((c: any) => c?.type === "output_text")?.text;
  try {
    return (JSON.parse(content ?? "") as { summary?: unknown }).summary as string;
  } catch {
    return null;
  }
};

/** Where facts, the model and the cache come from. A seam so tests can run without them. */
export const placeSummarySource = { loadFacts, generate, kv: () => getKVClient() };

/**
 * The place's summary: from the cache, or generated, checked and cached. "not_found" for an id that
 * is not a place, so arbitrary ids never reach the model or create cache keys.
 */
export async function getPlaceSummary(placeId: string): Promise<{ summary: string | null } | "not_found"> {
  if (!isPlaceId(placeId)) return "not_found";
  const kv = placeSummarySource.kv();
  const key = placeSummaryKey(placeId);
  try {
    const cached = await kv.get<string>(key);
    if (cached?.data && isCacheFresh(cached.lastRefreshedAt)) return { summary: cached.data };
  } catch (error) {
    console.error("[place-summary] cache read failed:", error);
  }

  const facts = await placeSummarySource.loadFacts(placeId);
  if (!facts) return "not_found";

  const summary = checkSummary(await placeSummarySource.generate(facts).catch(() => null));
  if (!summary) return { summary: null };
  try {
    await kv.set(key, summary, CACHE_TTL_SECONDS);
  } catch (error) {
    console.error("[place-summary] cache write failed:", error);
  }
  return { summary };
}

/**
 * The verses of one chapter that name the place, with their text. Null when the text fails to load,
 * so the caller can leave the field out.
 */
export async function placeChapterVerses(
  refs: Array<{ bookId: string; chapter: number; verse: number }>,
  bookId: string,
  chapter: number,
  loadVerses: (range: { bookId: string; chapter: number; verseStart: number; verseEnd: number }) => Promise<Array<{ n: number; text: string }>>
): Promise<Array<{ verse: number; reference: string; text: string }> | null> {
  const verses = [...new Set(refs.filter((r) => r.bookId === bookId && r.chapter === chapter).map((r) => r.verse))].sort((a, b) => a - b);
  if (!verses.length) return [];
  let loaded: Array<{ n: number; text: string }>;
  try {
    loaded = await loadVerses({ bookId, chapter, verseStart: verses[0], verseEnd: verses[verses.length - 1] });
  } catch {
    return null;
  }
  const bookName = getBookDisplayNameFromCode(bookId) ?? bookId;
  return verses.flatMap((verse) => {
    const text = loaded.find((v) => v.n === verse)?.text;
    return text ? [{ verse, reference: `${bookName} ${chapter}:${verse}`, text }] : [];
  });
}

const MAX_KEY_VERSES = 4;
/** Book codes in canonical order (the name map lists the books Genesis to Revelation). */
const CANON = [...new Set(Object.values(BOOK_NAME_TO_CODE))];
const canonIndex = (bookId: string) => {
  const i = CANON.indexOf(bookId);
  return i < 0 ? CANON.length : i;
};

export type KeyVerse = { bookId: string; chapter: number; verse: number; reference: string; text: string };

/** The Gospels and Acts: a place they name always gets one key verse from them. */
const GOSPELS_AND_ACTS = new Set(["MAT", "MRK", "LUK", "JHN", "ACT"]);

/**
 * Up to four verses that name the place, for a sheet with no chapter: the first mention in each of
 * the books that mention it most (ties in canonical order), shown in canonical order. If the Gospels
 * or Acts name the place but none of those books made the cut, the most-mentioning of them takes the
 * last slot, so Bethlehem shows Matthew 2:1 rather than a fourth genealogy. Each chapter is loaded
 * once, in parallel; a chapter that fails drops its verse. Null when no text loads.
 */
export async function placeKeyVerses(
  refs: Array<{ bookId: string; chapter: number; verse: number }>,
  loadVerses: (range: { bookId: string; chapter: number; verseStart: number; verseEnd: number }) => Promise<Array<{ n: number; text: string }>>
): Promise<KeyVerse[] | null> {
  const byBook = new Map<string, Array<{ bookId: string; chapter: number; verse: number }>>();
  for (const r of refs) byBook.set(r.bookId, [...(byBook.get(r.bookId) ?? []), r]);
  const ranked = [...byBook.entries()].sort((a, b) => b[1].length - a[1].length || canonIndex(a[0]) - canonIndex(b[0]));
  let picked = ranked.slice(0, MAX_KEY_VERSES);
  const gospel = ranked.find(([bookId]) => GOSPELS_AND_ACTS.has(bookId));
  if (gospel && !picked.includes(gospel)) picked = [...picked.slice(0, MAX_KEY_VERSES - 1), gospel];
  const chosen = picked
    .map(([, list]) => [...list].sort((a, b) => a.chapter - b.chapter || a.verse - b.verse)[0])
    .sort((a, b) => canonIndex(a.bookId) - canonIndex(b.bookId) || a.chapter - b.chapter || a.verse - b.verse);
  if (!chosen.length) return null;

  const chapters = [...new Set(chosen.map((r) => `${r.bookId}:${r.chapter}`))];
  const loaded = new Map(
    await Promise.all(
      chapters.map(async (key) => {
        const [bookId, chapter] = key.split(":");
        const inChapter = chosen.filter((r) => r.bookId === bookId && r.chapter === Number(chapter)).map((r) => r.verse);
        const verses = await loadVerses({ bookId, chapter: Number(chapter), verseStart: Math.min(...inChapter), verseEnd: Math.max(...inChapter) }).catch(() => []);
        return [key, verses] as const;
      })
    )
  );
  const out = chosen.flatMap((r) => {
    const text = loaded.get(`${r.bookId}:${r.chapter}`)?.find((v) => v.n === r.verse)?.text;
    const reference = `${getBookDisplayNameFromCode(r.bookId) ?? r.bookId} ${r.chapter}:${r.verse}`;
    return text ? [{ bookId: r.bookId, chapter: r.chapter, verse: r.verse, reference, text }] : [];
  });
  return out.length ? out : null;
}
