// Checks the seed file without a database. That every place exists is checked against the
// database separately (see the Atlas Maps server report).
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { getBookDisplayNameFromCode } from "../src/lib/bible/bookCodes";
import { routesSeedSchema } from "./import-bible-routes";

const seed = routesSeedSchema.parse(
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "prisma", "bible-routes.seed.json"), "utf8"))
);

test("the route seed validates and lists its journeys in biblical order", () => {
  assert.deepEqual(
    seed.routes.map((r) => r.slug),
    [
      "abraham-journey",
      "jacob-journey",
      "joseph-sold-into-egypt",
      "exodus",
      "ruth-and-naomi",
      "david-on-the-run",
      "elijah-flight-to-horeb",
      "return-from-exile",
      "nehemiah-return",
      "jonah-to-nineveh",
      "flight-to-egypt",
      "mary-and-joseph-to-bethlehem",
      "jesus-last-journey",
      "road-to-emmaus",
      "jesus-through-samaria",
      "philip-and-the-ethiopian",
      "paul-road-to-damascus",
      "peter-joppa-to-caesarea",
      "paul-first-journey",
      "paul-second-journey",
      "paul-third-journey",
      "paul-to-caesarea-under-guard",
      "paul-voyage-to-rome",
    ]
  );
  const orders = seed.routes.map((r) => r.sortOrder);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.equal(new Set(orders).size, orders.length);
  assert.equal(seed.routes.find((r) => r.slug === "exodus")?.certainty, "disputed");
});

test("every route's book and every stop's verse use a real book code, and chapter ranges run forwards", () => {
  for (const r of seed.routes) {
    assert.ok(getBookDisplayNameFromCode(r.bookId), r.slug);
    assert.ok(r.chapterStart <= r.chapterEnd, r.slug);
    for (const s of r.stops) assert.ok(getBookDisplayNameFromCode(s.ref.split(":")[0]), `${r.slug} ${s.ref}`);
  }
});

test("the first journey tells the two Antiochs apart and steps from Salamis to Paphos at Acts 13:6", () => {
  const first = seed.routes.find((r) => r.slug === "paul-first-journey")!;
  assert.equal(first.stops[0].place, "antioch-1"); // on the Orontes
  assert.equal(first.stops[5].place, "antioch-2"); // in Pisidia
  assert.deepEqual([first.stops[2].place, first.stops[3].place, first.stops[3].ref], ["salamis", "paphos", "ACT:13:6"]);
  assert.equal(first.stops[2].by, "sea");
  assert.ok(first.stops.filter((s) => s.isReturn).length >= 3);
});

test("the schema rejects a bad seed", () => {
  const route = { slug: "x-y", title: "X", certainty: "traditional", passage: "Acts 1", bookId: "ACT", chapterStart: 1, chapterEnd: 1 };
  const ok = { place: "rome", ref: "ACT:28:16" };
  assert.ok(routesSeedSchema.safeParse({ routes: [{ ...route, stops: [ok, ok] }] }).success);
  assert.ok(!routesSeedSchema.safeParse({ routes: [{ ...route, stops: [ok] }] }).success);
  assert.ok(!routesSeedSchema.safeParse({ routes: [{ ...route, certainty: "likely", stops: [ok, ok] }] }).success);
  assert.ok(!routesSeedSchema.safeParse({ routes: [{ ...route, stops: [ok, { ...ok, by: "air" }] }] }).success);
  assert.ok(!routesSeedSchema.safeParse({ routes: [{ ...route, stops: [ok, { ...ok, ref: "Acts 28:16" }] }] }).success);
  assert.ok(!routesSeedSchema.safeParse({ routes: [{ ...route, stops: [ok, { ...ok, waypoints: [[95, 0]] }] }] }).success);
  assert.ok(!routesSeedSchema.safeParse({ routes: [{ ...route, stops: [ok, ok] }, { ...route, stops: [ok, ok] }] }).success);
});
