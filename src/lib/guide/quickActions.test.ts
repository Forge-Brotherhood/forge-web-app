import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuickActions, quickActionsSystemPrompt } from "./quickActions";

const answer = (actions: unknown[]) => JSON.stringify({ actions });
const opts = { hasPlaces: false, reference: "Romans 8:14-15" };

test("keeps tools and questions in the model's order, three at most", () => {
  const out = parseQuickActions(
    answer([
      { kind: "tool", tool: "word_study", label: "Word study: Abba" },
      { kind: "question", label: "How am I led by the Spirit?" },
      { kind: "tool", tool: "context_callout", label: "Context: adoption in Rome" },
      { kind: "tool", tool: "cross_refs", label: "Cross references" },
    ]),
    opts
  );
  assert.deepEqual(
    out.map((a) => a.label),
    ["Word study: Abba", "How am I led by the Spirit?", "Context: adoption in Rome"]
  );
});

test("moves a question ranked behind two tools into second place", () => {
  const out = parseQuickActions(
    answer([
      { kind: "tool", tool: "cross_refs", label: "Cross references" },
      { kind: "tool", tool: "context_callout", label: "Context: Rome" },
      { kind: "question", label: "Why fear?" },
    ]),
    opts
  );
  assert.deepEqual(out.map((a) => a.label), ["Cross references", "Why fear?", "Context: Rome"]);
  const toolsOnly = parseQuickActions(
    answer([
      { kind: "tool", tool: "cross_refs", label: "Cross references" },
      { kind: "tool", tool: "word_study", label: "Word study: Abba" },
    ]),
    opts
  );
  assert.deepEqual(toolsOnly.map((a) => a.label), ["Cross references", "Word study: Abba"]);
});

test("builds what each tool sends from its label and the passage", () => {
  const out = parseQuickActions(
    answer([
      { kind: "tool", tool: "word_study", label: "Word study: Abba" },
      { kind: "tool", tool: "context_callout", label: "Context: adoption in Rome" },
      { kind: "question", label: "Why fear?" },
    ]),
    opts
  );
  // The question moves up into second place (see above).
  assert.deepEqual(out.map((a) => a.prompt), [
    'Do a word study on "Abba" in Romans 8:14-15',
    "Why fear?",
    "What is the background to adoption in Rome in Romans 8:14-15?",
  ]);
  const plain = parseQuickActions(answer([{ kind: "tool", tool: "prayer_card", label: "Pray this psalm" }]), opts);
  assert.equal(plain[0].prompt, "Write a prayer from Romans 8:14-15");
});

test("drops a map where the verses have no places, unknown tools and repeats", () => {
  const out = parseQuickActions(
    answer([
      { kind: "tool", tool: "map_card", label: "Map: Rome" },
      { kind: "tool", tool: "timeline", label: "Timeline" },
      { kind: "tool", tool: "cross_refs", label: "Cross references" },
      { kind: "tool", tool: "cross_refs", label: "Cross references" },
      { kind: "question", label: "Why fear?" },
      { kind: "question", label: "why fear?" },
    ]),
    opts
  );
  assert.deepEqual(out.map((a) => a.label), ["Cross references", "Why fear?"]);
  const map = parseQuickActions(answer([{ kind: "tool", tool: "map_card", label: "Map: Troas" }]), { ...opts, hasPlaces: true });
  assert.equal(map.length, 1);
});

test("takes a tool named as its kind, and gives fixed tools their own label", () => {
  const out = parseQuickActions(
    answer([
      { kind: "question", label: "Why did Paul interpret the vision as a call to Macedonia?" },
      { kind: "cross_refs", label: "Cross references to Jesus' compassion" },
      { kind: "context_callout", label: "Context: Macedonia in Acts" },
    ]),
    opts
  );
  assert.deepEqual(out.map((a) => a.label), [
    "Why did Paul interpret the vision as a call to Macedonia?",
    "Cross references",
    "Context: Macedonia in Acts",
  ]);
  assert.equal(out[1].kind, "tool");
});

test("drops labels too long for their button and anything malformed", () => {
  const out = parseQuickActions(
    answer([
      { kind: "tool", tool: "word_study", label: "Word study: a very long word that will not fit" },
      { kind: "question", label: "What is the meaning of all of the words in these two verses here, one by one?" },
      { kind: "question" },
      "nonsense",
    ]),
    opts
  );
  assert.deepEqual(out, []);
  assert.deepEqual(parseQuickActions("not json", opts), []);
  assert.deepEqual(parseQuickActions("{}", opts), []);
});

test("offers the map only with places, naming them", () => {
  assert.match(quickActionsSystemPrompt(["Troas", "Macedonia"]), /map_card: the places in these verses \(Troas, Macedonia\)/);
  assert.match(quickActionsSystemPrompt([]), /map_card: not available/);
});
