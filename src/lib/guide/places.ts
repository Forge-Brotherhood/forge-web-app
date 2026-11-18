import { prisma } from "@/lib/prisma";
import { parseReference } from "@/lib/bibleReference";
import { BOOK_NAME_TO_CODE, getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";

/**
 * Bible places for guide maps (BiblePlace / BiblePlaceRef, imported from OpenBible.info).
 * Coordinates always come from this table, never from the model.
 */

/** OpenBible identification scores below this are shown as "location uncertain". */
export const LOW_CONFIDENCE = 400;
const MAX_MAP_PLACES = 8;
/** Greeting maps show at most this many regions, so large areas don't crowd out the towns. */
const MAX_GREETING_REGIONS = 3;
/** The chapter greeting shows a map only for chapters with enough reasonably certain places. */
const GREETING_MIN_PLACES = 3;
const GREETING_MIN_CONFIDENT = 2;

export type MapPlace = {
  id: string;
  name: string;
  label: string;
  /** "point" is drawn as a pin; "region" as a shaded area with its outline. */
  kind: "point" | "region";
  /** For regions: a point inside the area, used for the label. */
  lat: number;
  lon: number;
  /** Regions only: the outline as [[lat, lon], …]. */
  boundary?: Array<[number, number]>;
  confidence: number;
  uncertain: boolean;
  /** Verses in the focus chapter that mention this place. */
  verses: number[];
};

export type PassagePlaces = {
  bookId: string;
  chapter: number;
  /** e.g. "Matthew 2" */
  chapterReference: string;
  /** Places mentioned in the passage, most-mentioned first. */
  places: MapPlace[];
};

export type MapCardBlock = {
  id: string;
  kind: "map_card";
  v: 1;
  fallback_text: string;
  title: string;
  caption?: string;
  book_id?: string;
  chapter?: number;
  places: MapPlace[];
};

const placeSelect = {
  id: true,
  name: true,
  label: true,
  kind: true,
  lat: true,
  lon: true,
  boundary: true,
  confidence: true,
} as const;

type PlaceRow = {
  id: string;
  name: string;
  label: string;
  kind: string;
  lat: number;
  lon: number;
  boundary: unknown;
  confidence: number;
};

const toMapPlace = (p: PlaceRow, verses: number[]): MapPlace => ({
  id: p.id,
  name: p.name,
  label: p.label,
  kind: p.kind === "region" ? "region" : "point",
  lat: p.lat,
  lon: p.lon,
  ...(p.kind === "region" && Array.isArray(p.boundary) ? { boundary: p.boundary as Array<[number, number]> } : {}),
  confidence: p.confidence,
  uncertain: p.confidence < LOW_CONFIDENCE,
  verses,
});

/**
 * Places in the passage the guide is looking at. For a chapter (selectionState "visible") this is
 * the whole chapter; for selected verses it is only those verses.
 */
export async function getPassagePlaces(
  verseReference: string | undefined,
  selectionState: "selected" | "visible" | undefined
): Promise<PassagePlaces | null> {
  const parsed = verseReference ? parseReference(verseReference) : null;
  if (!parsed) return null;
  const bookId = BOOK_NAME_TO_CODE[parsed.book.toLowerCase()];
  if (!bookId) return null;

  const verseFilter =
    selectionState === "selected"
      ? { verse: { gte: parsed.verseStart, lte: parsed.verseEnd ?? parsed.verseStart } }
      : {};
  const refs = await prisma.biblePlaceRef.findMany({
    where: { bookId, chapter: parsed.chapter, ...verseFilter },
    select: {
      verse: true,
      place: { select: placeSelect },
    },
  });

  const byPlace = new Map<string, { place: PlaceRow; verses: number[] }>();
  for (const r of refs) {
    const entry = byPlace.get(r.place.id) ?? { place: r.place, verses: [] };
    entry.verses.push(r.verse);
    byPlace.set(r.place.id, entry);
  }
  const places = [...byPlace.values()]
    .sort((a, b) => b.verses.length - a.verses.length || b.place.confidence - a.place.confidence)
    .map((e) => toMapPlace(e.place, e.verses.sort((x, y) => x - y)));

  const bookName = getBookDisplayNameFromCode(bookId) ?? parsed.book;
  return { bookId, chapter: parsed.chapter, chapterReference: `${bookName} ${parsed.chapter}`, places };
}

/** Prompt lines listing the passage's places, so the model can pick by id. */
export const describePassagePlaces = (passage: PassagePlaces | null): string => {
  if (!passage?.places.length) return "";
  const lines = passage.places
    .slice(0, 30)
    .map(
      (p) =>
        `${p.id}: ${p.label}${p.kind === "region" ? " (region, shown as an area)" : ""}` +
        `${p.uncertain ? " (location uncertain)" : ""} (v. ${p.verses.join(", ")})`
    );
  return [
    `Places in ${passage.chapterReference} you can map (id: name). Prefer a region when the text speaks of an area (a land, province or wilderness) rather than a specific town:`,
    ...lines,
  ].join("\n");
};

const fallbackText = (title: string, places: MapPlace[]) =>
  `${title}: ${places.map((p) => p.label).join(", ")}`;

/**
 * Resolve model-chosen places. Each entry may be a place id from the passage list or a place name.
 * Names are matched within the passage first, then across the Bible only when the name is unique.
 */
export async function buildMapBlockFromModel(args: {
  blockId: string;
  places: string[];
  title?: string;
  caption?: string;
  passage: PassagePlaces | null;
}): Promise<
  { ok: true; block: MapCardBlock; unresolved: string[] } | { ok: false; reason: string; unresolved: string[] }
> {
  const passagePlaces = args.passage?.places ?? [];
  const chosen: MapPlace[] = [];
  const unresolved: string[] = [];

  for (const raw of args.places) {
    const key = raw.trim().toLowerCase();
    let match = passagePlaces.find((p) => p.id.toLowerCase() === key);
    if (!match) {
      const byName = passagePlaces.filter((p) => p.name.toLowerCase() === key || p.label.toLowerCase() === key);
      if (byName.length === 1) match = byName[0];
    }
    if (!match) {
      const global = await prisma.biblePlace.findMany({
        where: {
          OR: [
            { id: raw.trim() },
            { name: { equals: raw.trim(), mode: "insensitive" } },
            { label: { equals: raw.trim(), mode: "insensitive" } },
          ],
        },
        select: placeSelect,
        take: 2,
      });
      if (global.length === 1) match = toMapPlace(global[0], []);
    }
    if (!match) unresolved.push(raw);
    else if (!chosen.some((p) => p.id === match!.id)) chosen.push(match);
  }

  if (!chosen.length) {
    return { ok: false, reason: "none of the places were found; use ids from the places list", unresolved };
  }
  const title = args.title ?? (args.passage ? `Places in ${args.passage.chapterReference}` : "Map");
  const places = chosen.slice(0, MAX_MAP_PLACES);
  return {
    ok: true,
    unresolved,
    block: {
      id: args.blockId,
      kind: "map_card",
      v: 1,
      fallback_text: fallbackText(title, places),
      title,
      caption: args.caption,
      book_id: args.passage?.bookId,
      chapter: args.passage?.chapter,
      places,
    },
  };
}

/** Rule-based map for the Chapter Guide greeting; null when the chapter does not qualify. */
export const buildChapterGreetingMap = (passage: PassagePlaces | null, blockId: string): MapCardBlock | null => {
  if (!passage) return null;
  const confident = passage.places.filter((p) => !p.uncertain).length;
  if (passage.places.length < GREETING_MIN_PLACES || confident < GREETING_MIN_CONFIDENT) return null;
  const title = `Places in ${passage.chapterReference}`;
  const regions = passage.places.filter((p) => p.kind === "region").slice(0, MAX_GREETING_REGIONS);
  const points = passage.places.filter((p) => p.kind === "point").slice(0, MAX_MAP_PLACES);
  const places = [...points, ...regions];
  return {
    id: blockId,
    kind: "map_card",
    v: 1,
    fallback_text: fallbackText(title, places),
    title,
    book_id: passage.bookId,
    chapter: passage.chapter,
    places,
  };
};
