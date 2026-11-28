#!/usr/bin/env npx tsx
/**
 * Import curated journeys for guide maps from prisma/bible-routes.seed.json.
 *
 * Upserts each route by slug and replaces its stops. Routes not in the file (for example ones made
 * in admin) are left alone. Safe to re-run. Needs BiblePlace imported first (import-bible-places.ts).
 *
 * Usage:
 *   npx tsx scripts/import-bible-routes.ts [path/to/bible-routes.seed.json]
 */

import { config } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

config({ path: path.resolve(__dirname, "..", ".env") });

const latLon = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

const stopSchema = z.object({
  /** A BiblePlace id or slug. */
  place: z.string().min(1),
  /** The verse where the travellers arrive, BOOK:CHAPTER:VERSE. */
  ref: z.string().regex(/^[1-3]?[A-Z]{2,3}:\d{1,3}:\d{1,3}$/),
  by: z.enum(["road", "sea"]).default("road"),
  isReturn: z.boolean().default(false),
  waypoints: z.array(latLon).optional(),
  note: z.string().min(1).max(200).optional(),
});

export const routesSeedSchema = z.object({
  routes: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
        title: z.string().min(1).max(80),
        certainty: z.enum(["traditional", "probable", "disputed"]),
        passage: z.string().min(1).max(40),
        bookId: z.string().regex(/^[1-3]?[A-Z]{2,3}$/),
        chapterStart: z.number().int().min(1),
        chapterEnd: z.number().int().min(1),
        sortOrder: z.number().int().default(0),
        stops: z.array(stopSchema).min(2),
      })
    )
    .refine((routes) => new Set(routes.map((r) => r.slug)).size === routes.length, "slugs must be unique"),
});

export type RoutesSeed = z.infer<typeof routesSeedSchema>;

async function main() {
  const file = process.argv[2] ?? path.resolve(__dirname, "..", "prisma", "bible-routes.seed.json");
  const seed = routesSeedSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));

  // Import after dotenv so DATABASE_URL is set.
  const { prisma } = await import("../src/lib/prisma");

  const keys = [...new Set(seed.routes.flatMap((r) => r.stops.map((s) => s.place)))];
  const places = await prisma.biblePlace.findMany({
    where: { OR: [{ id: { in: keys } }, { slug: { in: keys } }] },
    select: { id: true, slug: true },
  });
  const placeId = new Map(places.flatMap((p) => [[p.id, p.id], [p.slug, p.id]] as const));
  const missing = keys.filter((k) => !placeId.has(k));
  if (missing.length) throw new Error(`Places not found in BiblePlace: ${missing.join(", ")}`);

  for (const { stops, ...route } of seed.routes) {
    await prisma.$transaction(async (tx) => {
      const { id } = await tx.bibleRoute.upsert({ where: { slug: route.slug }, create: route, update: route, select: { id: true } });
      await tx.bibleRouteStop.deleteMany({ where: { routeId: id } });
      await tx.bibleRouteStop.createMany({
        data: stops.map((s, order) => {
          const [bookId, chapter, verse] = s.ref.split(":");
          return {
            routeId: id,
            order,
            placeId: placeId.get(s.place)!,
            bookId,
            chapter: Number(chapter),
            verse: Number(verse),
            by: s.by,
            isReturn: s.isReturn,
            waypoints: s.waypoints,
            note: s.note,
          };
        }),
      });
    });
  }

  console.log(`Imported ${seed.routes.length} routes with ${seed.routes.reduce((n, r) => n + r.stops.length, 0)} stops.`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
