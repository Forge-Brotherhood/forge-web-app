/**
 * The one model call of a beat. `store: false`, JSON out: the same way the other auxiliary calls
 * (thread summary, goal candidates) are made. Nothing the model is sent or says is logged here.
 * The same model as Lumen's chat, at low reasoning effort: a smaller model wrote lead-ins that
 * ignored what the person had made on their readings.
 */

export type BeatModelInput = { system: string; user: string };
export type BeatModel = (input: BeatModelInput) => Promise<unknown>;

export const BEAT_MODEL = "gpt-5.5";

export const callBeatModel: BeatModel = async ({ system, user }) => {
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

  const output = ((await response.json()) as any)?.output ?? [];
  const content = output.flatMap((item: any) => item?.content ?? []).find((c: any) => c?.type === "output_text")?.text;
  if (typeof content !== "string") throw new Error("No content in OpenAI response");
  return JSON.parse(content);
};
