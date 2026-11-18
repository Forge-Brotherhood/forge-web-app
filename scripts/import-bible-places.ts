#!/usr/bin/env npx tsx
/**
 * Import Bible places for guide maps from OpenBible.info Bible Geocoding Data (CC BY 4.0).
 * https://github.com/openbibleinfo/Bible-Geocoding-Data
 *
 * Replaces the contents of BiblePlace / BiblePlaceRef. Safe to re-run.
 *
 * Usage:
 *   # Download data/ancient.jsonl and data/modern.jsonl from the repo into a folder, plus each
 *   # region's geometry/<geojson_file> into <folder>/geometry/, then:
 *   npx tsx scripts/import-bible-places.ts /path/to/folder
 *
 * What is kept (see guide-maps-phase0-report.md):
 * - Point-like places (settlements, mountains, springs, islands…), as map pins.
 * - Regions with an outline from OpenBible itself, as map areas. Where boundaries are uncertain the
 *   data has "isobands" (several confidence polygons); the middle band is used.
 * - "special" places are skipped.
 * - Only verse mentions that are mostly proper-name mentions (not "east", "Egyptians").
 * - Nothing whose coordinates or outline come from OpenStreetMap (ODbL).
 */

import { config } from "dotenv";
import * as fs from "fs";
import * as path from "path";

config({ path: path.resolve(__dirname, "..", ".env") });

const PIN_TYPES = new Set([
  "settlement", "mountain", "hill", "spring", "structure", "gate", "campsite", "island",
  "valley", "wadi", "body of water", "river", "natural area",
]);

type Resolution = { lonlat?: string; modern_basis_id?: string; ancient_geometry?: string };
type Identification = { score?: { time_total?: number; vote_total?: number }; resolutions?: Resolution[] };
type Verse = { usx: string; instance_types?: Record<string, number> };
type AncientPlace = {
  id: string;
  friendly_id: string;
  url_slug: string;
  types?: string[];
  comment?: string;
  geojson_file?: string;
  geometry_credit?: string;
  identifications?: Identification[];
  verses?: Verse[];
};
type ModernPlace = { id: string; friendly_id: string; coordinates_source?: { type?: string } };

const readJsonl = <T>(file: string): T[] =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

const baseName = (friendlyId: string) => friendlyId.replace(/\s+\d+$/, "");

const MAX_BOUNDARY_POINTS = 80;

type GeoFeature = { geometry?: { type: string; coordinates: unknown }; properties?: Record<string, unknown> };

/**
 * A region's outer ring as [[lat, lon], …], or null. Uses the middle confidence band for isobands,
 * the largest polygon otherwise, and skips any OpenStreetMap-derived geometry.
 */
const readRegionBoundary = (dir: string, file: string | undefined): Array<[number, number]> | null => {
  if (!file) return null;
  const filePath = path.join(dir, "geometry", file);
  if (!fs.existsSync(filePath)) return null;
  const collection = JSON.parse(fs.readFileSync(filePath, "utf8")) as { features?: GeoFeature[] };
  const feature = (collection.features ?? []).find(
    (f) =>
      (f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon") &&
      f.properties?.geometry_credit !== "osm"
  );
  if (!feature?.geometry) return null;

  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates as number[][][]]
      : (feature.geometry.coordinates as number[][][][]);
  if (!polygons.length) return null;

  const ringArea = (ring: number[][]) =>
    Math.abs(ring.reduce((sum, [x1, y1], i) => {
      const [x2, y2] = ring[(i + 1) % ring.length];
      return sum + x1 * y2 - x2 * y1;
    }, 0)) / 2;
  const isIsobands = feature.properties?.format === "isobands";
  const polygon = isIsobands
    ? polygons[Math.floor(polygons.length / 2)]
    : polygons.reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
  const ring = polygon[0];
  if (!ring || ring.length < 4) return null;

  // Source outlines can be very coarse (~20 points per band), which draws as an angular kite.
  // Round the corners with Chaikin's algorithm, then cap the point count.
  let smoothed = ring.slice(0, -1); // drop the closing point; the ring is treated as closed
  for (let pass = 0; pass < 2 && smoothed.length * 2 <= MAX_BOUNDARY_POINTS * 2; pass++) {
    smoothed = smoothed.flatMap(([x1, y1], i) => {
      const [x2, y2] = smoothed[(i + 1) % smoothed.length];
      return [
        [0.75 * x1 + 0.25 * x2, 0.75 * y1 + 0.25 * y2],
        [0.25 * x1 + 0.75 * x2, 0.25 * y1 + 0.75 * y2],
      ];
    });
  }
  const step = Math.max(1, Math.ceil(smoothed.length / MAX_BOUNDARY_POINTS));
  const reduced = smoothed.filter((_, i) => i % step === 0);
  return reduced.map(([lon, lat]) => [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4]);
};

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: npx tsx scripts/import-bible-places.ts <folder with ancient.jsonl and modern.jsonl>");
    process.exit(1);
  }

  // Import after dotenv so DATABASE_URL is set.
  const { prisma } = await import("../src/lib/prisma");
  const { getBookDisplayNameFromCode } = await import("../src/lib/bible/bookCodes");

  const ancient = readJsonl<AncientPlace>(path.join(dir, "ancient.jsonl"));
  const modern = new Map(readJsonl<ModernPlace>(path.join(dir, "modern.jsonl")).map((m) => [m.id, m]));

  const skipped = { type: 0, vague: 0, noPoint: 0, noRegionShape: 0, noRefs: 0, osmFallback: 0 };
  const places: Array<{
    id: string; slug: string; name: string; types: string[]; kind: "point" | "region";
    lat: number; lon: number; boundary?: Array<[number, number]>;
    confidence: number; modernName: string | null; coordSource: string | null;
    refs: Array<{ bookId: string; chapter: number; verse: number }>;
  }> = [];

  for (const p of ancient) {
    const types = p.types ?? [];
    const isRegion = types.includes("region");
    if (!isRegion && !types.some((t) => PIN_TYPES.has(t))) { skipped.type++; continue; }
    if (p.comment?.includes("necessarily")) { skipped.vague++; continue; }

    const candidates = (p.identifications ?? [])
      .map((ident) => ({ ident, score: ident.score?.time_total ?? ident.score?.vote_total ?? 0 }))
      .sort((a, b) => b.score - a.score);

    let point: { lat: number; lon: number; score: number; modern?: ModernPlace } | null = null;
    let boundary: Array<[number, number]> | undefined;
    if (isRegion) {
      // Regions are drawn from their outline; the label sits at the outline's average point.
      const outline = p.geometry_credit === "osm" ? null : readRegionBoundary(dir, p.geojson_file);
      if (!outline) { skipped.noRegionShape++; continue; }
      boundary = outline;
      const best = candidates[0];
      const basis = best?.ident.resolutions?.[0]?.modern_basis_id;
      point = {
        lat: outline.reduce((s, [lat]) => s + lat, 0) / outline.length,
        lon: outline.reduce((s, [, lon]) => s + lon, 0) / outline.length,
        score: best?.score ?? 0,
        modern: basis ? modern.get(basis) : undefined,
      };
    } else {
      // Highest-scoring point not sourced from OpenStreetMap.
      let sawOsm = false;
      for (const { ident, score } of candidates) {
        for (const res of ident.resolutions ?? []) {
          if (!res.lonlat) continue;
          const m = res.modern_basis_id ? modern.get(res.modern_basis_id) : undefined;
          if (m?.coordinates_source?.type === "osm") { sawOsm = true; continue; }
          const [lon, lat] = res.lonlat.split(",").map(Number);
          if (Number.isFinite(lat) && Number.isFinite(lon)) { point = { lat, lon, score, modern: m }; break; }
        }
        if (point) break;
      }
      if (!point) { skipped.noPoint++; continue; }
      if (sawOsm) skipped.osmFallback++;
    }

    const refs: Array<{ bookId: string; chapter: number; verse: number }> = [];
    for (const v of p.verses ?? []) {
      const it = v.instance_types ?? {};
      const nameVotes = (it.name ?? 0) + (it.partial ?? 0) + (it.combined ?? 0);
      const total = Object.values(it).reduce((a, b) => a + b, 0);
      if (nameVotes <= total - nameVotes) continue;
      const m = v.usx.match(/^([1-3]?[A-Z]{2,3}) (\d+):(\d+)$/);
      if (!m || !getBookDisplayNameFromCode(m[1])) continue;
      refs.push({ bookId: m[1], chapter: Number(m[2]), verse: Number(m[3]) });
    }
    if (!refs.length) { skipped.noRefs++; continue; }

    places.push({
      id: p.id,
      slug: p.url_slug,
      name: baseName(p.friendly_id),
      types,
      kind: isRegion ? "region" : "point",
      lat: point.lat,
      lon: point.lon,
      boundary,
      confidence: Math.round(point.score),
      modernName: point.modern?.friendly_id ?? null,
      coordSource: isRegion ? "openbible_outline" : (point.modern?.coordinates_source?.type ?? null),
      refs,
    });
  }

  // Unambiguous labels where several kept places share a name ("Antioch on the Orontes", "Antioch in Pisidia").
  const nameCounts = new Map<string, number>();
  for (const p of places) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  const label = (p: { name: string; kind: string; modernName: string | null }) => {
    // A region's modern basis is often a city ("Judea" -> Jerusalem), which would mislabel the area.
    if (p.kind === "region" || (nameCounts.get(p.name) ?? 0) < 2 || !p.modernName) return p.name;
    return p.modernName.toLowerCase().includes(p.name.toLowerCase()) ? p.modernName : `${p.name} (${p.modernName})`;
  };

  const refRows = places.flatMap((p) => p.refs.map((r) => ({ placeId: p.id, ...r })));
  await prisma.$transaction([
    prisma.biblePlaceRef.deleteMany(),
    prisma.biblePlace.deleteMany(),
    prisma.biblePlace.createMany({
      data: places.map(({ refs: _refs, ...p }) => ({ ...p, label: label(p) })),
    }),
    prisma.biblePlaceRef.createMany({ data: refRows, skipDuplicates: true }),
  ]);

  const regionCount = places.filter((p) => p.kind === "region").length;
  console.log(
    `Imported ${places.length} places (${places.length - regionCount} points, ${regionCount} regions) and ${refRows.length} verse references.`
  );
  console.log(`Skipped: ${JSON.stringify(skipped)} (osmFallback = places that used a non-OSM point instead of an OSM one)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
