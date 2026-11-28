// Runs without a database: a stand-in Prisma client is put where src/lib/prisma.ts looks for one,
// before places.ts is loaded.
import assert from "node:assert/strict";
import { test } from "node:test";

const queries: unknown[] = [];
(globalThis as { prisma?: unknown }).prisma = {
  biblePlaceRef: {
    findMany: async (args: unknown) => {
      queries.push(args);
      return [
        { verse: 1, place: { id: "a1", name: "Lebanon", label: "Lebanon", kind: "point", lat: 33.9, lon: 35.9, boundary: null, confidence: 900 } },
        { verse: 4, place: { id: "a2", name: "Jerusalem", label: "Jerusalem", kind: "point", lat: 31.777, lon: 35.234, boundary: null, confidence: 1000 } },
        { verse: 5, place: { id: "a2", name: "Jerusalem", label: "Jerusalem", kind: "point", lat: 31.777, lon: 35.234, boundary: null, confidence: 1000 } },
      ];
    },
  },
};

test("chapter places are looked up by book code, so Song of Solomon works", async () => {
  const { routeSource } = await import("./routes");
  routeSource.listRoutes = async () => [{ slug: "r", title: "R", bookId: "SNG", chapterStart: 1, chapterEnd: 1 }];
  const { getChapterPlaces } = await import("./places");
  const passage = await getChapterPlaces("SNG", 1);
  assert.deepEqual((queries[0] as { where: unknown }).where, { bookId: "SNG", chapter: 1 });
  assert.equal(passage.chapterReference, "Song of Solomon 1");
  assert.deepEqual(passage.places.map((p) => [p.id, p.verses]), [["a2", [4, 5]], ["a1", [1]]]);
  assert.deepEqual(passage.routes?.map((r) => r.slug), ["r"]);

  await getChapterPlaces("SNG", 2, { start: 3, end: 4 });
  assert.deepEqual((queries[1] as { where: unknown }).where, { bookId: "SNG", chapter: 2, verse: { gte: 3, lte: 4 } });
});

test("a missing routes table leaves the places working", async () => {
  const { routeSource } = await import("./routes");
  routeSource.listRoutes = async () => {
    throw new Error('relation "BibleRoute" does not exist');
  };
  const { getChapterPlaces } = await import("./places");
  const passage = await getChapterPlaces("SNG", 1);
  assert.equal(passage.places.length, 2);
  assert.deepEqual(passage.routes, []);
});

const indexed = (id: string, name: string, label: string, modernName: string | null, confidence: number, refCount: number, kind = "point") => ({
  id,
  name,
  label,
  kind,
  lat: 31,
  lon: 35,
  boundary: null,
  confidence,
  modernName,
  refCount,
});

const INDEX = [
  indexed("ae41ab4", "Antioch", "Antioch on the Orontes", "Antioch on the Orontes", 1000, 14),
  indexed("a6c704a", "Antioch", "Antioch in Pisidia", "Antioch in Pisidia", 1000, 4),
  indexed("a890adf", "Syria", "Syria", null, 1000, 60, "region"),
  indexed("a112427", "Bethlehem", "Bethlehem", "Bethlehem", 1000, 44),
  indexed("a308715", "Bethlehem", "Bethlehem (Beit Lahm)", "Beit Lahm", 1000, 1),
  indexed("ab1a343", "Bethlehem", "Bethlehem (Beit Lahm)", "Beit Lahm", 733, 2),
  indexed("g1", "Gibeah", "Gibeah (Tel el Ful)", "Tel el Ful", 669, 41),
  indexed("g2", "Gibeah", "Gibeah (south of Hebron)", "south of Hebron", 448, 2),
  indexed("g3", "Gibeah", "Gibeah (Burj el Bardawil)", "Burj el Bardawil", 215, 1),
  indexed("e1", "Engedi", "Engedi", "Ein Gedi", 1000, 6),
  indexed("z1", "Ziph", "Ziph (Tell Zif)", "Tell Zif", 760, 3),
  indexed("z2", "Ziph", "Ziph (Khirbet ez Zeifeh)", "Khirbet ez Zeifeh", 467, 1),
];

test("names without a passage resolve to the best candidate instead of being dropped", async () => {
  const { placeIndexSource, resolvePlaceName } = await import("./places");
  placeIndexSource.load = async () => INDEX;
  const logged: string[] = [];
  const info = console.info;
  console.info = (line: string) => void logged.push(line);
  try {
    const pick = async (name: string) => (await resolvePlaceName(name))?.id ?? null;
    assert.equal(await pick("Bethlehem"), "a112427"); // exact label
    assert.equal(await pick("Gibeah"), "g1"); // most mentioned
    assert.equal(await pick("En Gedi"), "e1"); // spacing and hyphens ignored
    assert.equal(await pick("Ziph"), "z1");
    assert.equal(await pick("Antioch in Syria"), "ae41ab4"); // no qualifier match: most mentioned
    assert.equal(await pick("Pisidian Antioch"), "a6c704a"); // qualifier matches "Pisidia"
    assert.equal(await pick("Antioch of Pisidia"), "a6c704a");
    assert.equal(await pick("Antioch"), "ae41ab4");
    assert.equal(await pick("a308715"), "a308715"); // an id
    assert.equal(await pick("Atlantis"), null);
    assert.equal(await pick("Syria"), "a890adf");
  } finally {
    console.info = info;
  }
  const choices = logged.map((l) => JSON.parse(l));
  assert.ok(choices.every((c) => c.event === "map_place_chosen"));
  assert.deepEqual(
    choices.find((c) => c.name === "Pisidian Antioch"),
    { tag: "guide.places", event: "map_place_chosen", name: "Pisidian Antioch", how: "qualifier", chosen: "Antioch in Pisidia", candidates: ["Antioch on the Orontes", "Antioch in Pisidia"] }
  );
  assert.ok(!choices.some((c) => c.name === "Bethlehem"), "an exact label is not a choice");
  assert.ok(choices.some((c) => c.name === "Gibeah" && c.candidates.length === 3));
});

test("a map card with names and no passage keeps its best-known places", async () => {
  const { placeIndexSource, buildMapBlockFromModel } = await import("./places");
  placeIndexSource.load = async () => INDEX;
  const info = console.info;
  console.info = () => undefined;
  try {
    const result = await buildMapBlockFromModel({ blockId: "b", places: ["Bethlehem", "Gibeah", "En Gedi", "Ziph", "Nowhere"], passage: null });
    assert.ok(result.ok);
    assert.deepEqual(result.block.places.map((p) => p.id), ["a112427", "g1", "e1", "z1"]);
    assert.deepEqual(result.unresolved, ["Nowhere"]);
  } finally {
    console.info = info;
  }
});

test("the reader's reference is read even with the provider's book name or a broken verse run", async () => {
  const { readerReference, getPassagePlaces } = await import("./places");
  assert.equal(readerReference("Acts of the Apostles 13:1-12"), "Acts 13:1-12");
  assert.equal(readerReference("1 Chronicles 6:31...48"), "1 Chronicles 6:31-48");
  assert.equal(readerReference("Matthew 2"), "Matthew 2");
  const acts = await getPassagePlaces("Acts of the Apostles 13:1-12", "visible");
  assert.equal(acts?.bookId, "ACT");
  const chron = await getPassagePlaces("1 Chronicles 6:31...48", "selected");
  assert.equal(chron?.chapterReference, "1 Chronicles 6");
  assert.deepEqual((queries.at(-1) as { where: unknown }).where, { bookId: "1CH", chapter: 6, verse: { gte: 31, lte: 48 } });
});
