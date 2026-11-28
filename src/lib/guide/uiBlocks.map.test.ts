// Runs without a database: routes come from a fixture through routeSource, so nothing reads KV.
// Importing uiBlocks still opens a Redis client that keeps the process alive after the tests, as
// the other uiBlocks tests do; run it with a timeout (node --import tsx <file>).
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildShowBlockTool, buildUiBlocksSystemPrompt, resolveShowBlockCall } from "./uiBlocks";
import { routeSource, type RouteRow } from "./routes";
import type { PassagePlaces } from "./places";

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

const row: RouteRow = {
  slug: "paul-first-journey",
  title: "Paul's first journey",
  certainty: "traditional",
  passage: "Acts 13–14",
  bookId: "ACT",
  chapterStart: 13,
  chapterEnd: 14,
  stops: [
    stop(0, antioch, "ACT:13:1"),
    stop(1, seleucia, "ACT:13:4"),
    stop(2, salamis, "ACT:13:5", { by: "sea" }),
    stop(3, paphos, "ACT:13:6"),
    stop(4, antioch, "ACT:14:26", { by: "sea" }),
  ],
};

const lookups: string[] = [];
routeSource.getRouteRow = async (slug) => {
  lookups.push(slug);
  if (slug === "one-stop") return { ...row, slug, stops: row.stops.slice(0, 1) };
  return slug === row.slug ? row : null;
};

const resolve = (args: object) =>
  resolveShowBlockCall({ argumentsJson: JSON.stringify({ kind: "map_card", ...args }), allowedKinds: ["map_card"], userId: "user-1", blockId: "block-1" });

const wire = (block: unknown) => JSON.parse(JSON.stringify(block));

test("a route slug becomes a route card: the route, its distinct stops as places, and the stops in order as fallback", async () => {
  const result = await resolve({ route: "paul-first-journey", caption: "From Antioch to Cyprus and back." });
  assert.ok(result.ok);
  const block = wire(result.block);
  const { route: _route, ...card } = block;
  assert.deepEqual(
    { ...card, places: block.places.map((p: { id: string; verses: number[] }) => [p.id, p.verses]) },
    {
      id: "block-1",
      kind: "map_card",
      v: 1,
      fallback_text: "Paul's first journey (Acts 13–14): Antioch on the Orontes, Seleucia, Salamis, Paphos, Antioch on the Orontes",
      title: "Paul's first journey",
      caption: "From Antioch to Cyprus and back.",
      book_id: "ACT",
      chapter: 13,
      places: [
        ["ae41ab4", [1]],
        ["a6d306d", [4]],
        ["afa863b", [5]],
        ["a314765", [6]],
      ],
    }
  );
  assert.deepEqual(block.places[0], {
    id: "ae41ab4",
    name: "Antioch on the Orontes",
    label: "Antioch on the Orontes",
    kind: "point",
    lat: 36.227,
    lon: 36.172,
    confidence: 1000,
    uncertain: false,
    verses: [1],
  });
  assert.equal(block.route.slug, "paul-first-journey");
  assert.equal(block.route.stops.length, 5);
  assert.deepEqual(block.route.stops[3], {
    order: 3,
    place_id: "a314765",
    label: "Paphos",
    lat: 34.756,
    lon: 32.404,
    ref_key: "ACT:13:6",
    reference: "Acts 13:6",
    by: "road",
    is_return: false,
    km: 145,
    waypoints: [],
  });
});

test("a route card keeps the model's title, and the route wins over places given with it", async () => {
  const result = await resolve({ route: " paul-first-journey ", title: "Out to Cyprus", places: ["Jerusalem"] });
  assert.ok(result.ok && result.block.kind === "map_card");
  assert.equal(result.block.title, "Out to Cyprus");
  assert.equal(result.block.route?.slug, "paul-first-journey");
  assert.deepEqual(result.block.places.map((p) => p.id), ["ae41ab4", "a6d306d", "afa863b", "a314765"]);
  assert.match(result.block.fallback_text, /^Out to Cyprus \(Acts 13–14\): /);
});

test("an unknown route slug, or neither route nor places, is rejected with a reason", async () => {
  assert.deepEqual(await resolve({ route: "paul-fourth-journey" }), {
    ok: false,
    reason: "route paul-fourth-journey is not one of the listed journeys; use a slug from the list or pass places",
  });
  assert.deepEqual(await resolve({ title: "Somewhere" }), { ok: false, reason: "places: give place ids, or a route slug" });
});

test("a route with one stop is not a journey, and a malformed slug is rejected without a lookup", async () => {
  assert.deepEqual(await resolve({ route: "one-stop" }), { ok: false, reason: "route one-stop has fewer than 2 stops; pass places instead" });
  lookups.length = 0;
  for (const bad of ["Paul First", "../x", "a--b", "x".repeat(81)]) assert.equal((await resolve({ route: bad })).ok, false, bad);
  assert.deepEqual(lookups, []);
});

test("the tool takes a route, and the prompt lists the journeys with this chapter's first", () => {
  const tool = buildShowBlockTool(["map_card"]) as unknown as { parameters: { properties: Record<string, unknown> } };
  assert.ok(tool.parameters.properties.route);
  const passage: PassagePlaces = {
    bookId: "ACT",
    chapter: 14,
    chapterReference: "Acts 14",
    places: [],
    routes: [
      { slug: "exodus", title: "The Exodus", bookId: "EXO", chapterStart: 12, chapterEnd: 19 },
      { slug: "paul-first-journey", title: "Paul's first journey", bookId: "ACT", chapterStart: 13, chapterEnd: 14 },
    ],
  };
  const prompt = buildUiBlocksSystemPrompt(["map_card"], passage);
  assert.match(prompt, /journey, travels or a voyage that matches one in the journeys list, pass its slug as route/);
  assert.match(prompt, /Journeys you can map as a route \(slug: title\).*\npaul-first-journey: Paul's first journey \(in this chapter\)\nexodus: The Exodus/);
  assert.doesNotMatch(buildUiBlocksSystemPrompt(["map_card"]), /Journeys you can map/);
});

test("more than 8 places keeps the first 8; an empty list with a route is a route card; empty alone is rejected", async () => {
  const { placeIndexSource } = await import("./places");
  const names = Array.from({ length: 11 }, (_, i) => `Town${i}`);
  placeIndexSource.load = async () =>
    names.map((n, i) => ({ id: `t${i}`, name: n, label: n, kind: "point", lat: 31, lon: 35, boundary: null, confidence: 1000, modernName: null, refCount: 1 }));
  const warn = console.warn;
  const warned: string[] = [];
  console.warn = (line: string) => void warned.push(line);
  try {
    const many = await resolve({ places: names });
    assert.ok(many.ok && many.block.kind === "map_card");
    assert.deepEqual(many.block.places.map((p) => p.id), ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
    assert.deepEqual(JSON.parse(warned[0]), { tag: "guide.map_card", event: "places_trimmed", given: 11, kept: 8 });
  } finally {
    console.warn = warn;
  }
  const withRoute = await resolve({ route: "paul-first-journey", places: [] });
  assert.ok(withRoute.ok && withRoute.block.kind === "map_card" && withRoute.block.route?.slug === "paul-first-journey");
  assert.deepEqual(await resolve({ places: [] }), { ok: false, reason: "places: give place ids, or a route slug" });
});
