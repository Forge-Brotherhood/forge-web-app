import { prisma } from "@/lib/prisma";
import { getKVClient } from "@/lib/kv";
import { getBookDisplayNameFromCode } from "@/lib/bible/bookCodes";
import type { PlaceRow } from "@/lib/guide/places";

/**
 * Curated journeys for guide maps (BibleRoute / BibleRouteStop). Coordinates come from the stops'
 * places, never from the model. The `BibleRouteView` shape is the `route` of a map_card.
 */

export type RouteCertainty = "traditional" | "probable" | "disputed";

export type RouteStopView = {
  order: number;
  place_id: string;
  label: string;
  lat: number;
  lon: number;
  ref_key: string;
  reference: string;
  /** How the leg arriving at this stop was travelled. */
  by: "road" | "sea";
  is_return: boolean;
  /** Straight-line length of the leg arriving here, rounded; 0 for the first stop. */
  km: number;
  /** [[lat, lon], …] between the previous stop and this one. */
  waypoints: Array<[number, number]>;
  note?: string;
};

export type BibleRouteView = {
  slug: string;
  title: string;
  certainty: RouteCertainty;
  passage: string;
  total_km: number;
  stops: RouteStopView[];
};

/** A route as stored, with each stop's place. */
export type RouteRow = {
  slug: string;
  title: string;
  certainty: string;
  passage: string;
  bookId: string;
  chapterStart: number;
  chapterEnd: number;
  stops: Array<{
    order: number;
    bookId: string;
    chapter: number;
    verse: number;
    by: string;
    isReturn: boolean;
    waypoints: unknown;
    note: string | null;
    place: PlaceRow;
  }>;
};

export type RouteSummary = { slug: string; title: string; bookId: string; chapterStart: number; chapterEnd: number };

/** Routes change in admin without a release, so they are cached briefly. */
const ROUTE_CACHE_TTL_SECONDS = 15 * 60;
const routeKey = (slug: string) => `bible:route:v1:${slug}`;
const ROUTE_LIST_KEY = "bible:routes:v1";

/** Only well-formed slugs are looked up, so arbitrary strings never become cache keys. */
export const isRouteSlug = (slug: string): boolean => slug.length <= 80 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);

/** A route with fewer than two stops has no legs and is not drawn as a journey. */
export const isJourney = (row: RouteRow): boolean => row.stops.length >= 2;

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km between two [lat, lon] points (haversine). */
export const haversineKm = (a: [number, number], b: [number, number]): number => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

const isLatLon = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));

/** The contract's `route` object from a stored route. */
export const buildRoute = (row: RouteRow): BibleRouteView => {
  const stops = [...row.stops].sort((a, b) => a.order - b.order);
  let totalKm = 0;
  const views = stops.map((s, i): RouteStopView => {
    const prev = stops[i - 1];
    const legKm = prev ? haversineKm([prev.place.lat, prev.place.lon], [s.place.lat, s.place.lon]) : 0;
    totalKm += legKm;
    return {
      order: i,
      place_id: s.place.id,
      label: s.place.label,
      lat: s.place.lat,
      lon: s.place.lon,
      ref_key: `${s.bookId}:${s.chapter}:${s.verse}`,
      reference: `${getBookDisplayNameFromCode(s.bookId) ?? s.bookId} ${s.chapter}:${s.verse}`,
      by: s.by === "sea" ? "sea" : "road",
      is_return: s.isReturn,
      km: Math.round(legKm),
      waypoints: Array.isArray(s.waypoints) ? s.waypoints.filter(isLatLon) : [],
      ...(s.note ? { note: s.note } : {}),
    };
  });
  const certainty: RouteCertainty =
    row.certainty === "probable" || row.certainty === "disputed" ? row.certainty : "traditional";
  return { slug: row.slug, title: row.title, certainty, passage: row.passage, total_km: Math.round(totalKm), stops: views };
};

/** Routes whose chapter range covers the chapter. */
export const routesForChapter = (routes: RouteSummary[], bookId: string, chapter: number): RouteSummary[] =>
  routes.filter((r) => r.bookId === bookId && chapter >= r.chapterStart && chapter <= r.chapterEnd);

/** Not-found (null) is never cached, and a failed cache write never fails the load. */
const cached = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const kv = getKVClient();
  const hit = await kv.get<T>(key);
  if (hit && hit.data !== null) return hit.data;
  const value = await load();
  if (value !== null) await kv.set(key, value, ROUTE_CACHE_TTL_SECONDS).catch(() => undefined);
  return value;
};

const getRouteRow = async (slug: string): Promise<RouteRow | null> =>
  cached(routeKey(slug), () =>
    prisma.bibleRoute.findUnique({
      where: { slug },
      select: {
        slug: true,
        title: true,
        certainty: true,
        passage: true,
        bookId: true,
        chapterStart: true,
        chapterEnd: true,
        stops: {
          orderBy: { order: "asc" },
          select: {
            order: true,
            bookId: true,
            chapter: true,
            verse: true,
            by: true,
            isReturn: true,
            waypoints: true,
            note: true,
            place: { select: { id: true, name: true, label: true, kind: true, lat: true, lon: true, boundary: true, confidence: true } },
          },
        },
      },
    })
  );

const listRoutes = async (): Promise<RouteSummary[]> =>
  cached(ROUTE_LIST_KEY, () =>
    prisma.bibleRoute.findMany({
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select: { slug: true, title: true, bookId: true, chapterStart: true, chapterEnd: true },
    })
  );

/** Where routes come from. A seam so tests can run without a database or KV. */
export const routeSource = { getRouteRow, listRoutes };

export type RouteWithText = Omit<BibleRouteView, "stops"> & { stops: Array<RouteStopView & { text?: string }> };

/**
 * Adds each stop's verse text, loading each chapter once. A chapter that fails to load leaves its
 * stops without text rather than failing the route.
 */
export const withVerseText = async (
  route: BibleRouteView,
  loadChapter: (bookId: string, chapter: number) => Promise<Array<{ n: number; text: string }>>
): Promise<RouteWithText> => {
  const chapters = [...new Set(route.stops.map((s) => s.ref_key.split(":").slice(0, 2).join(":")))];
  const loaded = new Map(
    await Promise.all(
      chapters.map(async (key) => {
        const [bookId, chapter] = key.split(":");
        const verses = await loadChapter(bookId, Number(chapter)).catch(() => []);
        return [key, verses] as const;
      })
    )
  );
  return {
    ...route,
    stops: route.stops.map((s) => {
      const [bookId, chapter, verse] = s.ref_key.split(":");
      const text = loaded.get(`${bookId}:${chapter}`)?.find((v) => v.n === Number(verse))?.text;
      return text ? { ...s, text } : s;
    }),
  };
};
