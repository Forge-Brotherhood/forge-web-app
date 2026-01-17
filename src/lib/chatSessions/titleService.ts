export type ChatTitleTurn = {
  role: "user" | "assistant";
  content: string;
};

function fallbackTitleFromTurns(turns: ChatTitleTurn[]): string {
  const firstUser = turns.find((t) => t.role === "user" && t.content.trim().length > 0);
  const base = firstUser?.content.trim() || "Recent conversation";
  const words = base.split(/\s+/).slice(0, 5);
  if (words.length >= 3) return words.join(" ");
  return "Recent conversation";
}

function normalizeTitle(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ");

  const words = cleaned.split(/\s+/).filter(Boolean);
  const normalized = words.slice(0, 5).join(" ").trim();
  if (normalized.split(/\s+/).filter(Boolean).length >= 3) return normalized;
  return fallback;
}

export async function generateChatSessionTitle(input: {
  kind: "guide" | "bible";
  turns: ChatTitleTurn[];
}): Promise<string> {
  const turns = input.turns
    .map((t) => ({ role: t.role, content: String(t.content ?? "").trim() }))
    .filter((t) => t.content.length > 0)
    .slice(0, 16);

  const fallback = fallbackTitleFromTurns(turns);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  // Keep prompt small and deterministic: we only need a short list title.
  const prompt = [
    `KIND: ${input.kind}`,
    "",
    "TASK:",
    "Generate a short title for this chat session.",
    "Return ONLY 3–5 words, no punctuation at the end, no quotes.",
    "Avoid generic words like 'Chat' or 'Conversation' unless necessary.",
    "",
    "TURNS:",
    ...turns.map((t, i) => `Turn ${i + 1} ${t.role.toUpperCase()}: ${t.content}`),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You generate ultra-short session titles. Return ONLY the title text (3–5 words).",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 24,
      temperature: 0.2,
    }),
  });

  if (!response.ok) return fallback;

  const data = (await response.json()) as any;
  const raw = String(data?.choices?.[0]?.message?.content ?? "");
  return normalizeTitle(raw, fallback);
}


