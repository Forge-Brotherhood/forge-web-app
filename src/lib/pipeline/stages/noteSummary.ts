type NoteSummaryResult = {
  summary: string;
  tags?: string[];
};

const FALLBACK_SUMMARY = "Personal note on this verse";

function sanitize(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]")
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "[PHONE]")
    .trim();
}

function fallbackSummarize(content: string): NoteSummaryResult {
  const cleaned = sanitize(content);
  const preview =
    cleaned.length > 150 ? `${cleaned.substring(0, 150)}...` : cleaned;
  return { summary: preview || FALLBACK_SUMMARY };
}

export async function generateSafeNoteSummary(content: string): Promise<NoteSummaryResult> {
  const cleaned = sanitize(content).slice(0, 1200);
  if (!cleaned.trim()) return { summary: FALLBACK_SUMMARY };

  const system = `You are summarizing a private Bible note. Return a short, non-verbatim theme (<=30 words). ` +
    `Remove PII. Do NOT quote text. ` +
    `Output JSON: {"summary": "...", "tags": ["tag1","tag2"]?}`;
  const user = `Note: """${cleaned}"""`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_completion_tokens: 120,
        temperature: 1,
        reasoning_effort: "minimal",
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[NoteSummary] LLM error", { status: response.status, body: errText?.slice(0, 500) });
      return fallbackSummarize(cleaned);
    }
    const data = await response.json();
    const contentStr = data.choices?.[0]?.message?.content;
    if (!contentStr || !String(contentStr).trim()) {
      const choice0 = data.choices?.[0];
      console.warn("[NoteSummary] Empty response content, using fallback", {
        inputLength: cleaned.length,
        finishReason: choice0?.finish_reason,
        hasRefusal: !!choice0?.message?.refusal,
        messageKeys: choice0?.message ? Object.keys(choice0.message) : [],
      });
      return fallbackSummarize(cleaned);
    }
    const parsed = JSON.parse(contentStr) as NoteSummaryResult;
    const summaryText = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (!summaryText) {
      console.warn("[NoteSummary] Missing summary in response, using fallback");
      return fallbackSummarize(cleaned);
    }
    return {
      summary: sanitize(summaryText),
      tags: parsed.tags?.slice(0, 5).map((t: string) => sanitize(String(t))).filter(Boolean),
    };
  } catch (error) {
    console.error("[NoteSummary] Falling back:", error);
    return fallbackSummarize(cleaned);
  }
}

