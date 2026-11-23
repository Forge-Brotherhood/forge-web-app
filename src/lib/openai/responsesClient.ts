type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type ResponsesTool = {
  type: "function";
  name: string;
  description?: string;
  parameters: JsonValue;
};

export type ResponsesInputMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type ResponsesStreamResult = {
  responseId: string | null;
  /** Everything this request added (its input, the model's output, tool outputs), to append to `history`. */
  items: unknown[];
  /** Calls only the client can answer. When there are any, the reply is not finished. */
  pendingToolCalls: ContextToolCall[];
  /** Token usage of each model round, as OpenAI reports it. */
  usage: unknown[];
};

export type ContextToolCall = {
  callId: string;
  name: string;
  argumentsJson: string;
};

type StreamArgs = {
  apiKey: string;
  model: string;
  /** System messages for this request. Sent first; not part of the conversation's history. */
  instructions: ResponsesInputMessage[];
  /**
   * The conversation so far: every earlier request's `ResponsesStreamResult.items`, in order.
   * Nothing is stored at OpenAI, so the whole conversation is replayed on each request.
   */
  history: unknown[];
  /** What this request adds: the user's message, or the outputs of pending tool calls. */
  input: unknown[];
  tools: ResponsesTool[];
  maxToolIterations: number;
  signal?: AbortSignal;
  /** Omitted: the model's default. */
  reasoningEffort?: "low" | "medium" | "high";
  onTextDelta: (delta: string) => void;
  onToolCall: (call: ContextToolCall) => Promise<string>;
  /** Calls the server cannot answer (they read data only the client holds). They are left pending. */
  isClientToolCall?: (call: ContextToolCall) => boolean;
  /** A tool call has started streaming; its arguments follow. */
  onToolCallStarted?: (call: ToolCallStart) => void;
  /** A piece of a started call's arguments, as the model writes them. */
  onToolCallArgumentsDelta?: (itemId: string, delta: string) => void;
  /**
   * Calls that end the reply. When every call in a round is one of these, their outputs are
   * recorded and the model is not asked to continue (which costs a full round trip).
   */
  isFinalToolCall?: (call: ContextToolCall) => boolean;
};

export type ToolCallStart = {
  /** Identifies the call in the argument deltas that follow. */
  itemId: string;
  callId: string;
  name: string;
};

type ResponseCompletedEvent = {
  type: "response.completed";
  response: {
    id: string;
    output?: unknown[];
    usage?: unknown;
  };
};

type ResponseCreatedEvent = {
  type: "response.created";
  response: { id: string };
};

type OutputTextDeltaEvent = {
  type: string;
  delta?: string;
  text?: string;
};

type AnyEvent = Record<string, unknown>;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const extractResponseIdFromEvent = (evt: AnyEvent): string | null => {
  const response = evt["response"];
  if (isRecord(response) && typeof response["id"] === "string") return String(response["id"]);
  if (typeof evt["id"] === "string" && String(evt["id"]).startsWith("resp_")) return String(evt["id"]);
  return null;
};

const parseSseDataLines = (eventBlock: string): string[] => {
  const out: string[] = [];
  for (const line of eventBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.replace(/^data:\s?/, "");
    if (!data) continue;
    out.push(data);
  }
  return out;
};

const safeJsonParse = (text: string): AnyEvent | null => {
  try {
    return JSON.parse(text) as AnyEvent;
  } catch {
    return null;
  }
};

function extractOutputTextFromCompletedResponse(output: unknown[] | undefined): string {
  if (!Array.isArray(output) || output.length === 0) return "";

  const parts: string[] = [];

  for (const item of output) {
    if (!isRecord(item)) continue;
    const type = typeof item["type"] === "string" ? String(item["type"]) : "";
    if (!type.includes("output_text")) continue;

    // Common shapes:
    // - { type: "output_text", text: "..." }
    // - { type: "response.output_text", text: "..." }
    const text = item["text"];
    if (typeof text === "string" && text) parts.push(text);
  }

  return parts.join("");
}

function extractToolCallsFromCompletedResponse(output: unknown[] | undefined): ContextToolCall[] {
  if (!Array.isArray(output) || output.length === 0) return [];

  const calls: ContextToolCall[] = [];

  for (const item of output) {
    if (!isRecord(item)) continue;

    // Common shapes seen across OpenAI streaming APIs:
    // - { type: "function_call", call_id, name, arguments }
    // - { type: "tool_call", id/call_id, name, arguments }
    const type = typeof item["type"] === "string" ? String(item["type"]) : "";
    if (!type.includes("function_call") && !type.includes("tool_call")) continue;

    const callIdRaw = item["call_id"] ?? item["id"];
    const nameRaw = item["name"];
    const argsRaw = item["arguments"];

    const callId = typeof callIdRaw === "string" && callIdRaw.trim() ? callIdRaw : null;
    const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw : null;
    const argumentsJson = typeof argsRaw === "string" ? argsRaw : null;

    if (!callId || !name || argumentsJson === null) continue;
    calls.push({ callId, name, argumentsJson });
  }

  return calls;
}

async function runSingleResponsesStream(args: {
  apiKey: string;
  model: string;
  input: unknown;
  tools: ResponsesTool[];
  signal?: AbortSignal;
  reasoningEffort?: "low" | "medium" | "high";
  onTextDelta: (delta: string) => void;
  onToolCallStarted?: (call: ToolCallStart) => void;
  onToolCallArgumentsDelta?: (itemId: string, delta: string) => void;
}): Promise<{ responseId: string | null; completed: ResponseCompletedEvent | null }> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    signal: args.signal,
    body: JSON.stringify({
      model: args.model,
      input: args.input,
      tools: args.tools,
      // Nothing is kept at OpenAI, so the model's reasoning comes back encrypted for the
      // conversation's owner to replay on the next turn.
      store: false,
      include: ["reasoning.encrypted_content"],
      ...(args.reasoningEffort ? { reasoning: { effort: args.reasoningEffort } } : {}),
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI Responses API error: ${response.status} - ${text}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  let buffer = "";
  let lastResponseId: string | null = null;
  let completedEvent: ResponseCompletedEvent | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const sep = buffer.indexOf("\n\n");
      if (sep === -1) break;

      const eventBlock = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      for (const dataLine of parseSseDataLines(eventBlock)) {
        if (dataLine === "[DONE]") break;

        const evt = safeJsonParse(dataLine);
        if (!evt) continue;

        const maybeResponseId = extractResponseIdFromEvent(evt);
        if (maybeResponseId) lastResponseId = maybeResponseId;

        const type = typeof evt.type === "string" ? String(evt.type) : "";
        if (type === "response.created") {
          const created = evt as unknown as ResponseCreatedEvent;
          if (created?.response?.id) lastResponseId = created.response.id;
        }

        // Tool calls are run once the response completes, but announced as they start, so a
        // caller can show what is coming while the model is still writing the arguments.
        if (type === "response.output_item.added") {
          const item = evt["item"];
          if (isRecord(item) && item["type"] === "function_call" && typeof item["name"] === "string") {
            args.onToolCallStarted?.({
              itemId: String(item["id"] ?? ""),
              callId: String(item["call_id"] ?? ""),
              name: String(item["name"]),
            });
          }
          continue;
        }
        if (type === "response.function_call_arguments.delta" && typeof evt["delta"] === "string") {
          args.onToolCallArgumentsDelta?.(String(evt["item_id"] ?? ""), String(evt["delta"]));
          continue;
        }

        // Text deltas: handle a few common variants. We only stream user-facing text.
        if (type.includes("output_text") && typeof (evt as OutputTextDeltaEvent).delta === "string") {
          args.onTextDelta(String((evt as OutputTextDeltaEvent).delta));
          continue;
        }
        // IMPORTANT:
        // Some event types include a full `text` field (e.g., done/final events). If we emit that
        // in addition to deltas, clients will see duplicated output. We intentionally only stream
        // deltas here, and rely on the completed-response fallback when no deltas were emitted.

        if (type === "response.completed") {
          completedEvent = evt as unknown as ResponseCompletedEvent;
          if (completedEvent?.response?.id) lastResponseId = completedEvent.response.id;
        }
      }
    }
  }

  return { responseId: lastResponseId, completed: completedEvent };
}

export async function streamResponsesWithTools(args: StreamArgs): Promise<ResponsesStreamResult> {
  let lastResponseId: string | null = null;
  const items: unknown[] = [...args.input];
  const usage: unknown[] = [];
  let pendingToolCalls: ContextToolCall[] = [];
  let streamedAnyText = false;

  for (let i = 0; i < Math.max(1, args.maxToolIterations); i++) {
    const res = await runSingleResponsesStream({
      apiKey: args.apiKey,
      model: args.model,
      input: [...args.instructions, ...args.history, ...items],
      tools: args.tools,
      signal: args.signal,
      reasoningEffort: args.reasoningEffort,
      onTextDelta: (delta) => {
        if (delta) streamedAnyText = true;
        args.onTextDelta(delta);
      },
      onToolCallStarted: args.onToolCallStarted,
      onToolCallArgumentsDelta: args.onToolCallArgumentsDelta,
    });

    lastResponseId = res.responseId ?? lastResponseId;
    items.push(...(res.completed?.response?.output ?? []));
    if (res.completed?.response?.usage) usage.push(res.completed.response.usage);

    // Fallback: if no deltas were streamed for this segment, try to extract the final text
    // from the completed response output.
    if (!streamedAnyText) {
      const finalText = extractOutputTextFromCompletedResponse(res.completed?.response?.output);
      if (finalText) args.onTextDelta(finalText);
    }

    const toolCalls = extractToolCallsFromCompletedResponse(res.completed?.response?.output);
    if (toolCalls.length === 0) break;

    pendingToolCalls = args.isClientToolCall ? toolCalls.filter(args.isClientToolCall) : [];
    const ownCalls = toolCalls.filter((call) => !pendingToolCalls.includes(call));

    const outputs = await Promise.all(
      ownCalls.map(async (call) => {
        // Every call must get an output: the model rejects a conversation that holds a call
        // without one.
        const output = await args.onToolCall(call).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[Responses] Tool ${call.name} failed:`, message);
          return `Error: the ${call.name} tool failed. Continue without it.`;
        });
        return {
          type: "function_call_output",
          call_id: call.callId,
          output,
        };
      })
    );
    items.push(...outputs);

    // The client has to answer the rest before the model can continue.
    if (pendingToolCalls.length > 0) break;

    // The reply is finished: the outputs are recorded, and the model is not asked to continue.
    if (args.isFinalToolCall && toolCalls.every(args.isFinalToolCall)) break;

    streamedAnyText = false;
  }

  return { responseId: lastResponseId, items, pendingToolCalls, usage };
}
