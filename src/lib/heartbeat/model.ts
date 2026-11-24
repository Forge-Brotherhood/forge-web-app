/**
 * The one model call of a beat. Small and fast, `store: false`, JSON out: the same way the other
 * auxiliary calls (thread summary, goal candidates) are made. Nothing the model is sent or says is
 * logged here.
 */

export type BeatModelInput = { system: string; user: string };
export type BeatModel = (input: BeatModelInput) => Promise<unknown>;

export const BEAT_MODEL = "gpt-4o-mini";

export const callBeatModel: BeatModel = async ({ system, user }) => {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: BEAT_MODEL,
      store: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1500,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });
  // The error body can echo the prompt, so only the status is kept.
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

  const content = ((await response.json()) as any)?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("No content in OpenAI response");
  return JSON.parse(content);
};
