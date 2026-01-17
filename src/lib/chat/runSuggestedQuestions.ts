export async function runSuggestedQuestions(args: {
  openaiApiKey: string;
  mode: "general" | "bible";
  selectionState: "selected" | "visible";
  verseReference?: string;
  verseText?: string;
  injectedInstructions: string;
}): Promise<string[]> {
  const selectionLabel = args.selectionState === "selected" ? "Selected verses" : "Visible verses";

  const system = [
    "Personalized Likely Reader Questions (Prompt B)",
    "You are Guide, anticipating the questions a thoughtful reader is likely asking internally about the current passage.",
    "The passage may be selected verses or verses visible on screen.",
    "You are also given user context (profile + memory notes). Use it only when it clearly helps specificity or warmth.",
    "",
    "Generate 2–3 short questions this reader is likely to ask about the passage.",
    "Rules:",
    '- Output JSON only: {"questions":["..."]}',
    "- Return 2–3 questions (prefer 3 when possible).",
    "- Each question <= 90 characters.",
    "- Avoid personal application questions.",
    "- Avoid yes/no questions.",
    "- Avoid speculation beyond the text.",
    "- Avoid theological jargon.",
    "- Avoid generic questions like “What does this mean?”",
    "",
    "User context:",
    args.injectedInstructions,
  ].join("\n");

  const user = [
    `Mode: ${args.mode}`,
    `Passage focus: ${selectionLabel}`,
    args.verseReference ? `Verse reference: ${args.verseReference}` : "",
    args.verseText ? `Verse text:\n${args.verseText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: process.env.SUGGESTED_QUESTIONS_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: 250,
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) return [];
  const data = (await resp.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return [];

  try {
    const parsed = JSON.parse(content) as any;
    const qs = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const cleaned = qs
      .filter((q: unknown) => typeof q === "string")
      .map((q: string) => q.trim())
      .filter((q: string) => q.length > 0 && q.length <= 90)
      .slice(0, 3);
    return cleaned;
  } catch {
    return [];
  }
}

