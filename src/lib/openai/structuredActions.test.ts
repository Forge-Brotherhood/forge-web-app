import assert from "node:assert/strict";
import { test } from "node:test";

import { extractUiActionsDeterministic } from "./structuredActions";

const references = (answerText: string, verseReference: string) =>
  extractUiActionsDeterministic({ answerText, verseReference }).map((a) => a.params.reference);

test("a verse cited from another book is not repeated in the book being read", () => {
  assert.deepEqual(
    references(
      "In Matthew 3:3, Isaiah is referring to John the Baptist. Matthew is saying that John fulfills Isaiah 40:3.",
      "Matthew 3:3"
    ),
    ["Isaiah 40:3"]
  );
  assert.deepEqual(references("Paul echoes John 3:16 here.", "Romans 8:1"), ["John 3:16"]);
});

test("a reference without a book still resolves to the book being read", () => {
  assert.deepEqual(references("See Romans 8:1 and 8:5-11.", "Romans 7:1"), ["Romans 8:1", "Romans 8:5-11"]);
});

test("a reference without a book follows the last book named in its sentence", () => {
  assert.deepEqual(references("He quotes Isaiah 40:3 and 40:5.", "Matthew 3:3"), ["Isaiah 40:3", "Isaiah 40:5"]);
  assert.deepEqual(
    references("Paul says the same in Romans 12:14. Earlier in this book, 4:10 says to worship God alone.", "Matthew 5:44"),
    ["Romans 12:14", "Matthew 4:10"]
  );
});

test("references into the chapter being read are not linked", () => {
  const answer =
    "Matthew 13:31-32 and 13:33 picture the kingdom growing, as Matthew 12:28 says it has come. See Matthew 13 and Matthew 14.";
  const expected = ["Matthew 12:28", "Matthew 14"];
  assert.deepEqual(references(answer, "Matthew 13:29-30"), expected);
  assert.deepEqual(references(answer, "Matthew 13"), expected);
});

test("each link carries the reference as the answer wrote it", () => {
  const mentions = extractUiActionsDeterministic({
    answerText: "Psalm 104:12 and Isaiah 40:3–5 agree. Compare 4:10. See also Ps 23.",
    verseReference: "Daniel 3:1",
  }).map((a) => [a.params.reference, a.params.mention]);
  assert.deepEqual(mentions, [
    ["Psalms 104:12", "Psalm 104:12"],
    ["Isaiah 40:3-5", "Isaiah 40:3–5"],
    ["Daniel 4:10", "4:10"],
    ["Psalms 23", "Ps 23"],
  ]);
});
