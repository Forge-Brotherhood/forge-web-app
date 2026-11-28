import { prisma } from "@/lib/prisma";
import { parseReference } from "@/lib/bibleReference";
import { BOOK_NAME_TO_CODE, getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";
import { buildRoute, isJourney, isRouteSlug, routeSource, routesForChapter, type BibleRouteView, type RouteSummary } from "@/lib/guide/routes";

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
  /** Every curated route, so the model can pick one by slug. */
  routes?: RouteSummary[];
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
  route?: BibleRouteView;
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

export type PlaceRow = {
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
 * The reader's reference in a form parseReference reads. The app sends the provider's book name
 * ("Acts of the Apostles" in the NLT) and joins visible verses that skip a number with "..."
 * ("1 Chronicles 6:31...48"); for places, the span between them is what matters.
 */
export const readerReference = (reference: string): string =>
  reference.trim().replace(/^Acts of the Apostles\b/i, "Acts").replace(/(\d)\s*\.\.\.\s*(\d)/, "$1-$2");

/**
 * Places in the passage the guide is looking at. For a chapter (selectionState "visible") this is
 * the whole chapter; for selected verses it is only those verses.
 */
export async function getPassagePlaces(
  verseReference: string | undefined,
  selectionState: "selected" | "visible" | undefined
): Promise<PassagePlaces | null> {
  const parsed = verseReference ? parseReference(readerReference(verseReference)) : null;
  if (!parsed) return null;
  const bookId = BOOK_NAME_TO_CODE[parsed.book.toLowerCase()];
  if (!bookId) return null;

  const verses =
    selectionState === "selected" ? { start: parsed.verseStart, end: parsed.verseEnd ?? parsed.verseStart } : undefined;
  return getChapterPlaces(bookId, parsed.chapter, verses);
}

/** Places in a chapter by book code, or only in a verse range of it. */
export async function getChapterPlaces(
  bookId: string,
  chapter: number,
  verses?: { start: number; end: number }
): Promise<PassagePlaces> {
  const verseFilter = verses ? { verse: { gte: verses.start, lte: verses.end } } : {};
  const refs = await prisma.biblePlaceRef.findMany({
    where: { bookId, chapter, ...verseFilter },
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

  // Before the routes migration is applied the table is missing; places must still work.
  const routes = await routeSource.listRoutes().catch(() => []);
  const bookName = getBookDisplayNameFromCode(bookId) ?? bookId;
  return { bookId, chapter, chapterReference: `${bookName} ${chapter}`, places, routes };
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

/** Prompt lines listing the curated routes (this chapter's first), so the model can pick one by slug. */
export const describeRoutes = (passage: PassagePlaces | null): string => {
  const routes = passage?.routes ?? [];
  if (!routes.length) return "";
  const here = routesForChapter(routes, passage!.bookId, passage!.chapter);
  const ordered = [...here, ...routes.filter((r) => !here.includes(r))].slice(0, 40);
  return [
    "Journeys you can map as a route (slug: title). For a question about one of these journeys, travels or voyages, pass its slug as route (no places needed); otherwise pass places:",
    ...ordered.map((r) => `${r.slug}: ${r.title}${here.includes(r) ? " (in this chapter)" : ""}`),
  ].join("\n");
};

const fallbackText = (title: string, places: MapPlace[]) =>
  `${title}: ${places.map((p) => p.label).join(", ")}`;

export type IndexedPlace = PlaceRow & { modernName: string | null; refCount: number };

const loadPlaceIndex = async (): Promise<IndexedPlace[]> => {
  const rows = await prisma.biblePlace.findMany({ select: { ...placeSelect, modernName: true, _count: { select: { refs: true } } } });
  return rows.map(({ _count, ...p }) => ({ ...p, refCount: _count.refs }));
};

let placeIndex: Promise<IndexedPlace[]> | null = null;
/** Every place, held in memory (about 1,100 small rows that change only on re-import). A seam for tests. */
export const placeIndexSource = {
  load: (): Promise<IndexedPlace[]> => {
    placeIndex ??= loadPlaceIndex().catch((err) => {
      placeIndex = null;
      throw err;
    });
    return placeIndex;
  },
};

const norm = (s: string) => s.toLowerCase().replace(/[-‐–’'.,()]/g, " ").replace(/\s+/g, " ").trim();
const compact = (s: string) => norm(s).replace(/ /g, "");
const QUALIFIER_STOPWORDS = new Set(["in", "of", "on", "the", "at", "near", "by"]);
/** "Pisidian" matches "Pisidia", "Syrian" matches "Syria": compare word stems. */
const sameStem = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 5) === b.slice(0, 5));

const mostMentioned = (list: IndexedPlace[]) =>
  [...list].sort((a, b) => b.refCount - a.refCount || b.confidence - a.confidence)[0];

/**
 * A place for a name the passage could not settle, or null. An id or an exact label wins; then a
 * name with a qualifier the model added ("Antioch in Syria", "Pisidian Antioch") is matched against
 * the labels and modern names; otherwise the most-mentioned place of that name. Every pick made
 * among several candidates is logged, so wrong picks can be spotted.
 */
export async function resolvePlaceName(raw: string): Promise<IndexedPlace | null> {
  const index = await placeIndexSource.load();
  const id = raw.trim();
  const byId = index.find((p) => p.id === id);
  if (byId) return byId;

  const key = compact(raw);
  const byLabel = index.filter((p) => compact(p.label) === key);
  if (byLabel.length === 1) return byLabel[0];

  const chooseFrom = (candidates: IndexedPlace[], how: string, among = candidates) => {
    const chosen = mostMentioned(candidates);
    if (among.length > 1) {
      console.info(
        JSON.stringify({ tag: "guide.places", event: "map_place_chosen", name: raw, how, chosen: chosen.label, candidates: among.map((c) => c.label) })
      );
    }
    return chosen;
  };

  const byName = index.filter((p) => compact(p.name) === key);
  if (byName.length) return chooseFrom(byName, "most_mentioned");

  // A name inside a longer phrase: "Antioch in Syria" holds the name "Antioch".
  const words = norm(raw).split(" ");
  const holds = (name: string) => {
    const n = norm(name).split(" ");
    return words.some((_, i) => n.every((w, j) => words[i + j] === w));
  };
  const named = index.filter((p) => holds(p.name));
  if (!named.length) return null;
  const longest = Math.max(...named.map((p) => p.name.length));
  const candidates = named.filter((p) => p.name.length === longest);
  const nameWords = new Set(norm(candidates[0].name).split(" "));
  const qualifier = words.filter((w) => !nameWords.has(w) && !QUALIFIER_STOPWORDS.has(w));
  const score = (p: IndexedPlace) => {
    const known = norm(`${p.label} ${p.modernName ?? ""}`).split(" ");
    return qualifier.filter((q) => known.some((k) => sameStem(q, k))).length;
  };
  const best = Math.max(...candidates.map(score));
  return best > 0
    ? chooseFrom(candidates.filter((p) => score(p) === best), "qualifier", candidates)
    : chooseFrom(candidates, "most_mentioned");
}

/**
 * Resolve model-chosen places. Each entry may be a place id from the passage list or a place name.
 * Names are matched within the passage first, then across the Bible (see resolvePlaceName).
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
      const found = await resolvePlaceName(raw);
      if (found) match = toMapPlace(found, []);
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

/**
 * A route card for a model-chosen route slug. `places` are the route's distinct stops, so older apps
 * that only know places still show its pins.
 */
export async function buildRouteMapBlock(args: {
  blockId: string;
  route: string;
  title?: string;
  caption?: string;
}): Promise<{ ok: true; block: MapCardBlock } | { ok: false; reason: string }> {
  const slug = args.route.trim();
  const row = isRouteSlug(slug) ? await routeSource.getRouteRow(slug).catch(() => null) : null;
  if (!row) {
    return { ok: false, reason: `route ${args.route} is not one of the listed journeys; use a slug from the list or pass places` };
  }
  if (!isJourney(row)) return { ok: false, reason: `route ${args.route} has fewer than 2 stops; pass places instead` };
  const route = buildRoute(row);
  const places: MapPlace[] = [];
  for (const s of row.stops) {
    if (places.some((p) => p.id === s.place.id)) continue;
    const verses = row.stops
      .filter((x) => x.place.id === s.place.id && x.bookId === row.bookId && x.chapter === row.chapterStart)
      .map((x) => x.verse);
    places.push(toMapPlace(s.place, [...new Set(verses)].sort((a, b) => a - b)));
  }
  const title = args.title ?? route.title;
  return {
    ok: true,
    block: {
      id: args.blockId,
      kind: "map_card",
      v: 1,
      fallback_text: `${title} (${route.passage}): ${route.stops.map((s) => s.label).join(", ")}`,
      title,
      caption: args.caption,
      book_id: row.bookId,
      chapter: row.chapterStart,
      places,
      route,
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
