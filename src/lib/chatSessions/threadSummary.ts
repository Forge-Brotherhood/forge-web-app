import { z } from "zod";

/**
 * The rolling summary of a goal's conversation. The app sends the summary so far and the turns
 * since, and keeps what comes back, encrypted. Nothing is stored here.
 */

export const MAX_THREAD_SUMMARY_CHARS = 1500;
const MAX_TURN_CHARS = 2000;

export const threadSummaryRequestSchema = z.object({
  previousSummary: z.string().max(3000).optional(),
  turns: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .min(1)
    .max(60),
});

export type ThreadSummaryRequest = z.infer<typeof threadSummaryRequestSchema>;

const SYSTEM_PROMPT = `
You keep the running summary of one long conversation between a user and a Bible-app guide about a single goal the user is working toward.

The summary is read by the guide at the start of every later turn, in place of the older turns. Fold the new turns into the summary so far.

Keep, in plain sentences:
- what the goal is, in the user's words, and why it matters to them if they said
- what has been tried or agreed (the approach, the pace) and what changed
- what the user has said about how it is going, in their own words
- anything the guide said it would do, and any question the user has not yet answered
- anything the guide should not repeat

BOUNDARIES:
- Only what is in the summary so far and the new turns. Do NOT infer personality traits, diagnoses or motives.
- Do NOT score or rate how the user is doing. Never write a number for progress in character or habit.
- Do NOT invent Scripture references, dates or events.
- Drop what no longer matters. Prefer the newer turn when two conflict.
- Neutral, factual, no more than ${MAX_THREAD_SUMMARY_CHARS} characters.

OUTPUT:
Return ONLY valid JSON: {"summary": string}
`.trim();

const buildPrompt = (input: ThreadSummaryRequest): string =>
  [
    `SUMMARY SO FAR:\n${input.previousSummary?.trim() || "(none yet)"}`,
    "",
    "NEW TURNS (chronological):",
    ...input.turns
      .filter((t) => t.content.trim().length > 0)
      .map((t) => `${t.role.toUpperCase()}: ${t.content.slice(0, MAX_TURN_CHARS)}`),
    "",
    "Write the updated summary.",
  ].join("\n");

/** Cuts at a word boundary, so a long answer from the model still fits the cap. */
export const clampSummary = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_THREAD_SUMMARY_CHARS) return trimmed;
  const cut = trimmed.slice(0, MAX_THREAD_SUMMARY_CHARS - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 0) || cut.length)}…`;
};

export async function generateThreadSummary(input: ThreadSummaryRequest): Promise<string> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      store: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(input) },
      ],
      max_tokens: 700,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  // The error body can echo the prompt, so only the status is kept.
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

  const content = ((await response.json()) as any)?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("No content in OpenAI response");
  const summary = (JSON.parse(content) as { summary?: unknown }).summary;
  if (typeof summary !== "string" || !summary.trim()) throw new Error("No summary in OpenAI response");
  return clampSummary(summary);
}
