// Runs without a database or KV: routes are built from fixture rows.
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRoute, haversineKm, routesForChapter, withVerseText, type RouteRow } from "./routes";

const place = (id: string, label: string, lat: number, lon: number) => ({
  id,
  name: label,
  label,
  kind: "point",
  lat,
  lon,
  boundary: null,
  confidence: 1000,
});

const stop = (order: number, p: ReturnType<typeof place>, ref: string, extra: Partial<RouteRow["stops"][number]> = {}) => {
  const [bookId, chapter, verse] = ref.split(":");
  return { order, bookId, chapter: Number(chapter), verse: Number(verse), by: "road", isReturn: false, waypoints: null, note: null, place: p, ...extra };
};

const antioch = place("ae41ab4", "Antioch on the Orontes", 36.227, 36.172);
const seleucia = place("a6d306d", "Seleucia", 36.124, 35.922);
const salamis = place("afa863b", "Salamis", 35.185, 33.902);
const paphos = place("a314765", "Paphos", 34.756, 32.404);

const firstJourneyRow: RouteRow = {
  slug: "paul-first-journey",
  title: "Paul's first journey",
  certainty: "traditional",
  passage: "Acts 13–14",
  bookId: "ACT",
  chapterStart: 13,
  chapterEnd: 14,
  // Out of order on purpose: stops are sorted by order.
  stops: [
    stop(3, paphos, "ACT:13:6"),
    stop(0, antioch, "ACT:13:1"),
    stop(2, salamis, "ACT:13:5", { by: "sea", waypoints: [[35.9, 35.0], "bad", [35.5, 34.2]], note: "Across to Cyprus." }),
    stop(1, seleucia, "ACT:13:4"),
    stop(4, salamis, "ACT:13:5", { isReturn: true }),
  ],
};

test("haversine gives straight-line km between known places", () => {
  assert.equal(Math.round(haversineKm([31.777, 35.234], [31.704, 35.208])), 8); // Jerusalem to Bethlehem
  assert.equal(Math.round(haversineKm([34.93, 24.8], [35.2, 24.072])), 73); // Fair Havens to Phoenix
  assert.equal(haversineKm([36.227, 36.172], [36.227, 36.172]), 0);
});

test("a route row becomes the contract's route object, with legs, sea, returns and waypoints", () => {
  const route = buildRoute(firstJourneyRow);
  assert.deepEqual(
    { ...route, stops: route.stops.slice(0, 3) },
    {
      slug: "paul-first-journey",
      title: "Paul's first journey",
      certainty: "traditional",
      passage: "Acts 13–14",
      total_km: route.total_km,
      stops: [
        { order: 0, place_id: "ae41ab4", label: "Antioch on the Orontes", lat: 36.227, lon: 36.172, ref_key: "ACT:13:1", reference: "Acts 13:1", by: "road", is_return: false, km: 0, waypoints: [] },
        { order: 1, place_id: "a6d306d", label: "Seleucia", lat: 36.124, lon: 35.922, ref_key: "ACT:13:4", reference: "Acts 13:4", by: "road", is_return: false, km: 25, waypoints: [] },
        {
          order: 2,
          place_id: "afa863b",
          label: "Salamis",
          lat: 35.185,
          lon: 33.902,
          ref_key: "ACT:13:5",
          reference: "Acts 13:5",
          by: "sea",
          is_return: false,
          km: 210,
          waypoints: [
            [35.9, 35.0],
            [35.5, 34.2],
          ],
          note: "Across to Cyprus.",
        },
      ],
    }
  );
  assert.deepEqual(
    route.stops.map((s) => [s.label, s.km, s.is_return]),
    [
      ["Antioch on the Orontes", 0, false],
      ["Seleucia", 25, false],
      ["Salamis", 210, false],
      ["Paphos", 145, false],
      ["Salamis", 145, true],
    ]
  );
  // The total is the rounded sum of the unrounded legs.
  const legs = [
    haversineKm([36.227, 36.172], [36.124, 35.922]),
    haversineKm([36.124, 35.922], [35.185, 33.902]),
    haversineKm([35.185, 33.902], [34.756, 32.404]),
    haversineKm([34.756, 32.404], [35.185, 33.902]),
  ];
  assert.equal(route.total_km, Math.round(legs.reduce((a, b) => a + b, 0)));
});

test("an unknown certainty or travel mode falls back to the safe default", () => {
  const route = buildRoute({ ...firstJourneyRow, certainty: "maybe", stops: [stop(0, antioch, "ACT:13:1", { by: "camel" })] });
  assert.equal(route.certainty, "traditional");
  assert.equal(route.stops[0].by, "road");
  assert.equal(buildRoute({ ...firstJourneyRow, certainty: "disputed" }).certainty, "disputed");
});

test("a chapter lists the routes whose range covers it", () => {
  const routes = [
    { slug: "paul-first-journey", title: "Paul's first journey", bookId: "ACT", chapterStart: 13, chapterEnd: 14 },
    { slug: "paul-second-journey", title: "Paul's second journey", bookId: "ACT", chapterStart: 15, chapterEnd: 18 },
    { slug: "exodus", title: "The Exodus", bookId: "EXO", chapterStart: 12, chapterEnd: 19 },
  ];
  assert.deepEqual(routesForChapter(routes, "ACT", 14).map((r) => r.slug), ["paul-first-journey"]);
  assert.deepEqual(routesForChapter(routes, "ACT", 18).map((r) => r.slug), ["paul-second-journey"]);
  assert.deepEqual(routesForChapter(routes, "ACT", 1), []);
});

test("each stop gets its verse text, each chapter is loaded once, and a failed chapter only drops its text", async () => {
  const route = buildRoute({
    ...firstJourneyRow,
    stops: [...firstJourneyRow.stops, stop(5, antioch, "ACT:14:26")],
  });
  const loads: string[] = [];
  const withText = await withVerseText(route, async (bookId, chapter) => {
    loads.push(`${bookId}:${chapter}`);
    if (chapter === 14) throw new Error("provider down");
    return [
      { n: 1, text: "Now there were in the church at Antioch prophets and teachers." },
      { n: 4, text: "Verse four." },
      { n: 5, text: "Verse five." },
    ];
  });
  assert.deepEqual(loads.sort(), ["ACT:13", "ACT:14"]);
  assert.deepEqual(
    withText.stops.map((s) => s.text),
    ["Now there were in the church at Antioch prophets and teachers.", "Verse four.", "Verse five.", undefined, "Verse five.", undefined]
  );
  assert.ok(!("text" in withText.stops[3]));
  assert.equal(withText.total_km, route.total_km);
});
