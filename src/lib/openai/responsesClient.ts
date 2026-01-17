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
};

export type ContextToolCall = {
  callId: string;
  name: string;
  argumentsJson: string;
};

type StreamArgs = {
  apiKey: string;
  model: string;
  input: unknown;
  previousResponseId: string | null;
  tools: ResponsesTool[];
  maxToolIterations: number;
  signal?: AbortSignal;
  onTextDelta: (delta: string) => void;
  onToolCall: (call: ContextToolCall) => Promise<string>;
};

type ResponseCompletedEvent = {
  type: "response.completed";
  response: {
    id: string;
    output?: unknown[];
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
  previousResponseId: string | null;
  signal?: AbortSignal;
  onTextDelta: (delta: string) => void;
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
      ...(args.previousResponseId ? { previous_response_id: args.previousResponseId } : {}),
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
  let previousResponseId = args.previousResponseId;
  let lastResponseId: string | null = null;
  let input: unknown = args.input;
  let streamedAnyText = false;

  for (let i = 0; i < Math.max(1, args.maxToolIterations); i++) {
    const res = await runSingleResponsesStream({
      apiKey: args.apiKey,
      model: args.model,
      input,
      tools: args.tools,
      previousResponseId,
      signal: args.signal,
      onTextDelta: (delta) => {
        if (delta) streamedAnyText = true;
        args.onTextDelta(delta);
      },
    });

    lastResponseId = res.responseId ?? lastResponseId;
    previousResponseId = lastResponseId;

    // Fallback: if no deltas were streamed for this segment, try to extract the final text
    // from the completed response output.
    if (!streamedAnyText) {
      const finalText = extractOutputTextFromCompletedResponse(res.completed?.response?.output);
      if (finalText) args.onTextDelta(finalText);
    }

    const toolCalls = extractToolCallsFromCompletedResponse(res.completed?.response?.output);
    if (toolCalls.length === 0) break;

    const outputs = await Promise.all(
      toolCalls.map(async (call) => {
        const output = await args.onToolCall(call);
        return {
          type: "function_call_output",
          call_id: call.callId,
          output,
        };
      })
    );

    // Next loop uses tool outputs as the new input, continuing the response chain.
    // We keep tools enabled so the model can call additional tools if needed.
    input = outputs;
    streamedAnyText = false;
  }

  return { responseId: lastResponseId };
}


