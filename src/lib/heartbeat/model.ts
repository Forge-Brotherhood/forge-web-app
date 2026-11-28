/**
 * The one model call of a beat. `store: false`, JSON out: the same way the other auxiliary calls
 * (thread summary, goal candidates) are made. Nothing the model is sent or says is logged here.
 * At low reasoning effort: a smaller model wrote lead-ins that ignored what the person had made on
 * their readings. gpt-6.2-sol replaced gpt-5.5 (Lumen's chat model) after the heartbeat evals: it
 * kept closer to the rules (71 of 78 against 63) at about a third of the price.
 */

import { recordModelUsage } from "@/lib/modelUsage";

/** userId, when given, is whose beat it is, for recording its tokens. */
export type BeatModelInput = { system: string; user: string; userId?: string };
export type BeatModel = (input: BeatModelInput) => Promise<unknown>;

export const BEAT_MODEL = "gpt-6.2-sol";

export const callBeatModel: BeatModel = async ({ system, user, userId }) => {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: BEAT_MODEL,
      store: false,
      reasoning: { effort: "low" },
      instructions: system,
      input: user,
      max_output_tokens: 4000,
      text: { format: { type: "json_object" } },
    }),
  });
  // The error body can echo the prompt, so only the status is kept.
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

  const body = (await response.json()) as any;
  if (userId) await recordModelUsage({ userId, feature: "heartbeat", model: BEAT_MODEL, usage: [body?.usage] });
  const output = body?.output ?? [];
  const content = output.flatMap((item: any) => item?.content ?? []).find((c: any) => c?.type === "output_text")?.text;
  if (typeof content !== "string") throw new Error("No content in OpenAI response");
  return JSON.parse(content);
};
