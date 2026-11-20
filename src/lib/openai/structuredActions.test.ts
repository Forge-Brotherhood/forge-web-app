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
    ["Matthew 3:3", "Isaiah 40:3"]
  );
  assert.deepEqual(references("Paul echoes John 3:16 here.", "Romans 8:1"), ["John 3:16", "Romans 8:1"]);
});

test("a reference without a book still resolves to the book being read", () => {
  assert.deepEqual(references("See Romans 8:1 and 8:5-11.", "Romans 8:1"), ["Romans 8:1", "Romans 8:5-11"]);
});

test("a reference without a book follows the last book named in its sentence", () => {
  assert.deepEqual(references("He quotes Isaiah 40:3 and 40:5.", "Matthew 3:3"), [
    "Isaiah 40:3",
    "Isaiah 40:5",
    "Matthew 3:3",
  ]);
  assert.deepEqual(
    references("Paul says the same in Romans 12:14. Back in this chapter, 5:44 says to love your enemies.", "Matthew 5:44"),
    ["Romans 12:14", "Matthew 5:44"]
  );
});
