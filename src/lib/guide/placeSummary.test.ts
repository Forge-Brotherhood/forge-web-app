// Runs without a database, KV or the model: all three come in through placeSummarySource.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkSummary,
  getPlaceSummary,
  placeChapterVerses,
  placeKeyVerses,
  placeSummaryInput,
  placeSummaryKey,
  placeSummarySource,
  PLACE_SUMMARY_MODEL,
  toFacts,
  type PlaceFacts,
} from "./placeSummary";
import { CHAT_MODEL } from "@/lib/chat/chatModel";

const bethlehemRow = {
  id: "a112427",
  label: "Bethlehem",
  kind: "point",
  types: ["settlement"],
  modernName: "Bethlehem",
  confidence: 1000,
  refs: [
    { bookId: "RUT", chapter: 1, verse: 1 },
    { bookId: "RUT", chapter: 1, verse: 2 },
    { bookId: "MAT", chapter: 2, verse: 1 },
    { bookId: "MAT", chapter: 2, verse: 5 },
    { bookId: "MAT", chapter: 2, verse: 6 },
    { bookId: "LUK", chapter: 2, verse: 4 },
  ],
};

const GOOD =
  "Bethlehem was a small town in the hill country of Judah, about eight kilometres south of Jerusalem. Its people lived from farming and herding on the surrounding terraces. It was the home of Ruth and Boaz and the town of David's family. The Gospels place the birth of Jesus here.";

/** A fake cache and model, recording what happened. */
const setup = (opts: { facts?: PlaceFacts | null; output?: string | null; cached?: string } = {}) => {
  const store = new Map<string, { data: unknown; lastRefreshedAt: number }>();
  if (opts.cached) store.set(placeSummaryKey("a112427"), { data: opts.cached, lastRefreshedAt: Date.now() });
  const calls: PlaceFacts[] = [];
  placeSummarySource.kv = () =>
    ({
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, data: unknown) => void store.set(key, { data, lastRefreshedAt: Date.now() }),
      delete: async () => undefined,
    }) as never;
  placeSummarySource.loadFacts = async (id) => (id === "a112427" ? (opts.facts === undefined ? toFacts(bethlehemRow) : opts.facts) : null);
  placeSummarySource.generate = async (facts) => {
    calls.push(facts);
    return opts.output === undefined ? GOOD : opts.output;
  };
  return { store, calls };
};

test("summaries use the main model by default and a v2 cache key", () => {
  assert.equal(PLACE_SUMMARY_MODEL, process.env.PLACE_SUMMARY_MODEL || CHAT_MODEL);
  assert.equal(placeSummaryKey("a112427"), "bible:place-summary:v2:a112427");
});

test("the model's input holds only the place's public facts", () => {
  const facts = toFacts(bethlehemRow);
  assert.deepEqual(facts, {
    id: "a112427",
    label: "Bethlehem",
    kind: "point",
    types: ["settlement"],
    modernName: "Bethlehem",
    uncertain: false,
    books: [
      { book: "Matthew", count: 3 },
      { book: "Ruth", count: 2 },
      { book: "Luke", count: 1 },
    ],
    references: ["Matthew 2:1", "Ruth 1:1", "Luke 2:4"],
  });
  assert.equal(
    placeSummaryInput(facts),
    [
      "Place: Bethlehem",
      "Kind: a single site (settlement)",
      "Modern identification: Bethlehem",
      "Location: reasonably certain",
      "Mentioned in: Matthew 3, Ruth 2, Luke 1",
      "Some references: Matthew 2:1; Ruth 1:1; Luke 2:4",
    ].join("\n")
  );
  const uncertain = placeSummaryInput(toFacts({ ...bethlehemRow, label: "Pi-hahiroth", kind: "point", modernName: null, confidence: 220 }));
  assert.match(uncertain, /Location: uncertain/);
  assert.doesNotMatch(uncertain, /Modern identification/);
  assert.match(placeSummaryInput(toFacts({ ...bethlehemRow, kind: "region", types: ["region"] })), /Kind: region \(an area/);
});

test("a valid summary is returned and cached; a cached one makes no model call", async () => {
  const first = setup();
  assert.deepEqual(await getPlaceSummary("a112427"), { summary: GOOD });
  assert.equal(first.calls.length, 1);
  assert.equal(first.store.get(placeSummaryKey("a112427"))?.data, GOOD);

  const second = setup({ cached: "Cached note. Second sentence." });
  assert.deepEqual(await getPlaceSummary("a112427"), { summary: "Cached note. Second sentence." });
  assert.equal(second.calls.length, 0);
});

test("an invalid or failed generation returns null and caches nothing", async () => {
  const quoted = 'Bethlehem lay south of Jerusalem. The prophet wrote, "But you, O Bethlehem Ephrathah, who are too little to be among the clans." It mattered.';
  for (const output of ["", "   ", "Bethlehem was a town.", `${GOOD} ${GOOD}`, "word ".repeat(150) + ".", quoted, null]) {
    const { store, calls } = setup({ output });
    assert.deepEqual(await getPlaceSummary("a112427"), { summary: null }, String(output).slice(0, 40));
    assert.equal(calls.length, 1);
    assert.equal(store.size, 0);
  }
});

test("an unknown or malformed id makes no model call and creates no cache key", async () => {
  for (const id of ["a999999", "../etc", "A112427", "x".repeat(40)]) {
    const { store, calls } = setup();
    assert.equal(await getPlaceSummary(id), "not_found");
    assert.equal(calls.length, 0);
    assert.equal(store.size, 0);
  }
});

test("the summary check allows two to five sentences and short quoted words", () => {
  assert.equal(checkSummary("Little is known about Etham. Its location is uncertain."), "Little is known about Etham. Its location is uncertain.");
  assert.ok(checkSummary('Its name means "house of bread". It lay south of Jerusalem.'));
  assert.equal(checkSummary("One. Two. Three. Four. Five. Six."), null);
  assert.equal(checkSummary(42), null);
});

test("chapterVerses lists the chapter's verses naming the place, with text, and is null when the text fails", async () => {
  const ranges: unknown[] = [];
  const verses = await placeChapterVerses(bethlehemRow.refs, "MAT", 2, async (range) => {
    ranges.push(range);
    return [
      { n: 1, text: "Verse one." },
      { n: 5, text: "Verse five." },
      { n: 6, text: "Verse six." },
    ];
  });
  assert.deepEqual(ranges, [{ bookId: "MAT", chapter: 2, verseStart: 1, verseEnd: 6 }]);
  assert.deepEqual(verses, [
    { verse: 1, reference: "Matthew 2:1", text: "Verse one." },
    { verse: 5, reference: "Matthew 2:5", text: "Verse five." },
    { verse: 6, reference: "Matthew 2:6", text: "Verse six." },
  ]);
  assert.deepEqual(await placeChapterVerses(bethlehemRow.refs, "JHN", 1, async () => assert.fail("no load")), []);
  assert.equal(
    await placeChapterVerses(bethlehemRow.refs, "MAT", 2, async () => {
      throw new Error("provider down");
    }),
    null
  );
});

test("key verses: the first mention in each of the most-mentioning books, in canonical order, one load per chapter", async () => {
  const refs = [
    { bookId: "MAT", chapter: 2, verse: 6 },
    { bookId: "MAT", chapter: 2, verse: 1 },
    { bookId: "MAT", chapter: 2, verse: 5 },
    { bookId: "RUT", chapter: 1, verse: 2 },
    { bookId: "RUT", chapter: 1, verse: 1 },
    { bookId: "1SA", chapter: 16, verse: 4 },
    { bookId: "1SA", chapter: 17, verse: 12 },
    { bookId: "JHN", chapter: 7, verse: 42 },
    { bookId: "MIC", chapter: 5, verse: 2 },
    { bookId: "GEN", chapter: 35, verse: 19 },
  ];
  const loads: string[] = [];
  const verses = await placeKeyVerses(refs, async (r) => {
    loads.push(`${r.bookId} ${r.chapter}:${r.verseStart}-${r.verseEnd}`);
    return [{ n: r.verseStart, text: `Text of ${r.bookId} ${r.chapter}:${r.verseStart}.` }];
  });
  // Matthew 3, Ruth 2, 1 Samuel 2, then one each: Genesis is first of those in canonical order.
  assert.deepEqual(
    verses?.map((v) => v.reference),
    ["Genesis 35:19", "Ruth 1:1", "1 Samuel 16:4", "Matthew 2:1"]
  );
  assert.deepEqual(verses?.[1], { bookId: "RUT", chapter: 1, verse: 1, reference: "Ruth 1:1", text: "Text of RUT 1:1." });
  assert.deepEqual(loads.sort(), ["1SA 16:4-4", "GEN 35:19-19", "MAT 2:1-1", "RUT 1:1-1"]);
});

test("key verses keep one Gospel or Acts verse when the counts would leave them out (Bethlehem)", async () => {
  // Bethlehem's real counts: 1 Chronicles 7, Judges 6, Ruth 6, 1 Samuel 5, 2 Samuel 5, Matthew 5.
  const counts: Array<[string, number]> = [["1CH", 7], ["JDG", 6], ["RUT", 6], ["1SA", 5], ["2SA", 5], ["MAT", 5]];
  const refs = counts.flatMap(([bookId, n]) => Array.from({ length: n }, (_, i) => ({ bookId, chapter: 2, verse: i + 1 })));
  const verses = await placeKeyVerses(refs, async (r) => [{ n: r.verseStart, text: `Text of ${r.bookId}.` }]);
  assert.deepEqual(
    verses?.map((v) => v.bookId),
    ["JDG", "RUT", "1CH", "MAT"]
  );
});

test("key verses drop a chapter that fails, and are null when nothing loads or there are no refs", async () => {
  const refs = [
    { bookId: "ACT", chapter: 13, verse: 6 },
    { bookId: "ACT", chapter: 13, verse: 13 },
    { bookId: "ACT", chapter: 15, verse: 39 },
  ];
  const partial = await placeKeyVerses([...refs, { bookId: "GAL", chapter: 2, verse: 11 }], async (r) => {
    if (r.bookId === "GAL") throw new Error("down");
    return [{ n: 6, text: "Six." }];
  });
  assert.deepEqual(partial?.map((v) => v.reference), ["Acts 13:6"]);
  assert.equal(await placeKeyVerses(refs, async () => Promise.reject(new Error("down"))), null);
  assert.equal(await placeKeyVerses([], async () => assert.fail("no load")), null);
});
