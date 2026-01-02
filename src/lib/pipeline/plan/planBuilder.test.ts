import test from "node:test";
import assert from "node:assert/strict";

import { buildPlan } from "./planBuilder";
import { RETRIEVAL_NEEDS, RESPONSE_MODES } from "./types";

test("planner: Romans 8 last week => chapter scope + highlights+notes+semantic", async () => {
  const plan = await buildPlan({
    message: "Last week I dove deep into Romans 8. What did I learn?",
    conversationHistory: [],
    isFirstMessage: false,
  });

  assert.equal(plan.response.source, "rules");
  assert.equal(plan.retrieval.filters?.temporal?.range, "last_week");
  assert.equal(plan.retrieval.filters?.scope?.kind, "chapter");
  assert.equal(plan.retrieval.filters?.scope?.bookId, "ROM");
  assert.equal(plan.retrieval.filters?.scope?.chapter, 8);

  assert.ok(plan.retrieval.needs.includes(RETRIEVAL_NEEDS.verse_highlights));
  assert.ok(plan.retrieval.needs.includes(RETRIEVAL_NEEDS.verse_notes));
  assert.ok(plan.retrieval.needs.includes(RETRIEVAL_NEEDS.artifact_semantic));
});

test("planner: John last month => book scope + highlights+notes+semantic", async () => {
  const plan = await buildPlan({
    message: "What did I learn from reading John last month?",
    conversationHistory: [],
    isFirstMessage: true,
  });

  assert.equal(plan.response.source, "rules");
  assert.equal(plan.retrieval.filters?.temporal?.range, "last_month");
  assert.equal(plan.retrieval.filters?.scope?.kind, "book");
  assert.equal(plan.retrieval.filters?.scope?.bookId, "JHN");
  assert.ok(plan.retrieval.needs.includes(RETRIEVAL_NEEDS.verse_highlights));
  assert.ok(plan.retrieval.needs.includes(RETRIEVAL_NEEDS.verse_notes));
  assert.ok(plan.retrieval.needs.includes(RETRIEVAL_NEEDS.artifact_semantic));
});

test("planner: reflections about marriage => semantic across personal artifacts", async () => {
  const plan = await buildPlan({
    message: "What are some of my reflections about marriage?",
    conversationHistory: [],
    isFirstMessage: true,
  });

  assert.equal(plan.response.source, "rules");
  assert.ok(plan.retrieval.needs.includes(RETRIEVAL_NEEDS.artifact_semantic));
  assert.ok(Array.isArray(plan.retrieval.artifactTypes) && plan.retrieval.artifactTypes.length > 0);
});

test("planner: resume where we left off last week => session summaries + continuity + temporal", async () => {
  const plan = await buildPlan({
    message: "Lets pick up the conversation where we left it last week",
    conversationHistory: [{ role: "assistant", content: "Earlier..." }],
    isFirstMessage: false,
  });

  assert.equal(plan.response.source, "rules");
  assert.equal(plan.response.responseMode, RESPONSE_MODES.continuity);
  assert.ok(plan.retrieval.needs.includes(RETRIEVAL_NEEDS.conversation_session_summaries));
  assert.equal(plan.retrieval.filters?.temporal?.range, "last_week");
});


