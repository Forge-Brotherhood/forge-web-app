import { prisma } from "@/lib/prisma";

export type UsageFeature = "chat" | "explain" | "heartbeat" | "gate_check";

type UsageCounts = { inputTokens: number; cachedTokens: number; outputTokens: number };

/** The counts in one usage report from OpenAI's Responses API, or null when it has none. */
export function usageCounts(usage: unknown): UsageCounts | null {
  const u = usage as { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } } | null;
  if (typeof u?.input_tokens !== "number" || typeof u.output_tokens !== "number") return null;
  const cached = u.input_tokens_details?.cached_tokens;
  return { inputTokens: u.input_tokens, cachedTokens: typeof cached === "number" ? cached : 0, outputTokens: u.output_tokens };
}

/**
 * Records the tokens of a person's model calls, one row per call: counts only, never what was sent
 * or said. A failed write is logged by name and dropped, so it never breaks what the person sees.
 */
export async function recordModelUsage(args: { userId: string; feature: UsageFeature; model: string; usage: unknown[] }): Promise<void> {
  const data = args.usage.flatMap((u) => {
    const counts = usageCounts(u);
    return counts ? [{ userId: args.userId, feature: args.feature, model: args.model, ...counts }] : [];
  });
  if (!data.length) return;
  try {
    await prisma.modelUsage.createMany({ data });
  } catch (error) {
    console.error("[model-usage] write failed:", error instanceof Error ? error.name : "unknown");
  }
}
