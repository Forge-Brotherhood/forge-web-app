import assert from "node:assert/strict";
import { test } from "node:test";

import { streamResponsesWithTools } from "./responsesClient";

/** Replaces fetch with one that answers each request with the next response's output, and records the bodies. */
const mockResponses = (outputs: unknown[][]) => {
  const bodies: Array<Record<string, unknown>> = [];
  let call = 0;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? "{}"));
    const output = outputs[call++] ?? [];
    const completed = { type: "response.completed", response: { id: `resp_${call}`, output, usage: { n: call } } };
    return new Response(`data: ${JSON.stringify(completed)}\n\n`, { status: 200 });
  }) as typeof fetch;
  return bodies;
};

const reasoning = { type: "reasoning", id: "rs_1", encrypted_content: "abc" };
const lookup = { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" };
const ownNotes = { type: "function_call", call_id: "call_2", name: "get_verse_notes", arguments: "{}" };
const answer = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello" }] };

const instructions = [{ role: "system" as const, content: "be kind" }];
const history = [{ role: "user", content: "earlier" }];
const input = [{ role: "user", content: "now" }];
const output = (callId: string, text: string) => ({ type: "function_call_output", call_id: callId, output: text });

const base = {
  apiKey: "k",
  model: "m",
  instructions,
  history,
  input,
  tools: [],
  maxToolIterations: 3,
  onTextDelta: () => {},
  onToolCall: async () => "found",
};

test("every request replays instructions, history and this request's items, and stores nothing", async () => {
  const bodies = mockResponses([[reasoning, lookup], [answer]]);

  const result = await streamResponsesWithTools(base);

  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    assert.equal(body.store, false);
    assert.equal(body.conversation, undefined);
    assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
  }
  assert.deepEqual(bodies[0].input, [...instructions, ...history, ...input]);
  assert.deepEqual(bodies[1].input, [...instructions, ...history, ...input, reasoning, lookup, output("call_1", "found")]);
  // Instructions are not part of what the conversation's owner keeps.
  assert.deepEqual(result.items, [...input, reasoning, lookup, output("call_1", "found"), answer]);
  assert.deepEqual(result.pendingToolCalls, []);
  assert.deepEqual(result.usage, [{ n: 1 }, { n: 2 }]);
});

test("a call only the client can answer stops the request and is left pending", async () => {
  const bodies = mockResponses([[lookup, ownNotes], [answer]]);
  const ran: string[] = [];

  const result = await streamResponsesWithTools({
    ...base,
    isClientToolCall: (call) => call.name === "get_verse_notes",
    onToolCall: async (call) => {
      ran.push(call.name);
      return "found";
    },
  });

  assert.equal(bodies.length, 1);
  assert.deepEqual(ran, ["lookup"]);
  assert.deepEqual(result.items, [...input, lookup, ownNotes, output("call_1", "found")]);
  assert.deepEqual(result.pendingToolCalls, [{ callId: "call_2", name: "get_verse_notes", argumentsJson: "{}" }]);
});

test("the client's tool outputs continue the same reply", async () => {
  const bodies = mockResponses([[answer]]);
  const afterFirstRequest = [...history, ...input, lookup, ownNotes, output("call_1", "found")];

  const result = await streamResponsesWithTools({
    ...base,
    history: afterFirstRequest,
    input: [output("call_2", "[]")],
  });

  assert.deepEqual(bodies[0].input, [...instructions, ...afterFirstRequest, output("call_2", "[]")]);
  assert.deepEqual(result.items, [output("call_2", "[]"), answer]);
});

test("a final tool call ends the reply without another request", async () => {
  const bodies = mockResponses([[lookup]]);

  const result = await streamResponsesWithTools({ ...base, isFinalToolCall: () => true });

  assert.equal(bodies.length, 1);
  assert.deepEqual(result.items.at(-1), output("call_1", "found"));
  assert.deepEqual(result.pendingToolCalls, []);
});
