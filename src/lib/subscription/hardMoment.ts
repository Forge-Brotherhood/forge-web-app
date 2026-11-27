import { recordModelUsage } from "@/lib/modelUsage";

/**
 * The hard-moment pass at the gate (pricing-plan.md §5.3). Before a free account is refused a reply,
 * a small model is asked one question: is this person in distress or grief? The message is held in
 * memory for that one call (`store: false`) and nothing of it is logged or kept.
 */

export const GATE_CHECK_MODEL = process.env.GATE_CHECK_MODEL || "gpt-6-luna";

export const HARD_MOMENT_INSTRUCTIONS = `You screen one message sent to a Bible app's guide. Decide whether the person who wrote it is, right now, in distress or grief: bereavement, despair, thoughts of ending their life or harming themselves, a crisis, fear for their safety, or deep sorrow, whether said plainly or obliquely.

A question about death, suffering or grief as a topic (in the Bible, in theology, in history) is not distress, unless the person shows it is their own pain now.

Answer in JSON only: {"hardMoment": true} or {"hardMoment": false}.`;

/** userId, when given, is whose message it is, for recording the tokens. */
export type GateCheckModel = (input: { instructions: string; message: string; userId?: string }) => Promise<unknown>;

export const callGateCheckModel: GateCheckModel = async ({ instructions, message, userId }) => {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: GATE_CHECK_MODEL,
      store: false,
      instructions,
      input: message,
      max_output_tokens: 1000,
      // A schema, not "json_object": that format is refused unless the message itself contains the word "json".
      text: {
        format: {
          type: "json_schema",
          name: "hard_moment",
          strict: true,
          schema: { type: "object", properties: { hardMoment: { type: "boolean" } }, required: ["hardMoment"], additionalProperties: false },
        },
      },
    }),
  });
  // The error body can echo the message, so only the status is kept.
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

  const body = (await response.json()) as any;
  if (userId) await recordModelUsage({ userId, feature: "gate_check", model: GATE_CHECK_MODEL, usage: [body?.usage] });
  const output = body?.output ?? [];
  const content = output.flatMap((item: any) => item?.content ?? []).find((c: any) => c?.type === "output_text")?.text;
  if (typeof content !== "string") throw new Error("No content in OpenAI response");
  return JSON.parse(content);
};

/** True when the model says this is a hard moment, and also when the check itself fails: the gate errs toward answering. */
export async function isHardMoment(message: string, userId: string, callModel: GateCheckModel = callGateCheckModel): Promise<boolean> {
  try {
    const answer = (await callModel({ instructions: HARD_MOMENT_INSTRUCTIONS, message, userId })) as { hardMoment?: unknown } | null;
    if (typeof answer?.hardMoment !== "boolean") throw new Error("Unexpected answer");
    return answer.hardMoment;
  } catch (error) {
    console.warn(JSON.stringify({ tag: "subscription.gate", event: "hard_moment_check_failed", error: error instanceof Error ? error.name : "unknown" }));
    return true;
  }
}
