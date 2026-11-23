import { z } from "zod";
import { generateChatSessionTitle } from "@/lib/chatSessions/titleService";
import { generateSessionSummary } from "@/lib/chatSessions/sessionSummary";
import { consolidateMemoryNotes } from "@/lib/memory/userMemoryConsolidator";

// Notes come back from an earlier chat end, whose keywords the model wrote: trim, don't reject.
const keywordsSchema = z
  .array(z.string())
  .default([])
  .transform((keywords) => keywords.slice(0, 8).map((k) => k.slice(0, 40)));

export const chatEndRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(2)
    .max(500),
  sessionNotes: z
    .array(
      z.object({
        text: z.string().min(1).max(400),
        keywords: keywordsSchema,
        expiresAtISO: z.string().datetime().optional(),
      })
    )
    .max(200)
    .default([]),
  globalNotes: z
    .array(
      z.object({
        text: z.string().min(1).max(400),
        displayText: z.string().max(400).optional(),
        keywords: keywordsSchema,
        createdAtISO: z.string().datetime().optional(),
        expiresAtISO: z.string().datetime().optional(),
      })
    )
    .max(200)
    .default([]),
});

/**
 * Titles and summarises a finished conversation and folds its session notes into long-term
 * memory. Nothing is stored: the app sends what is needed and keeps the results, encrypted.
 */
export async function endChat(input: z.infer<typeof chatEndRequestSchema>) {
  const turns = input.messages.filter((m) => m.content.trim().length > 0);
  const hasSubstance = turns.length >= 2 && turns.some((t) => t.role === "user");
  const nowISO = new Date().toISOString();

  const [title, summary, globalNotes] = await Promise.all([
    generateChatSessionTitle({ kind: "guide", turns }),
    hasSubstance ? generateSessionSummary({ turns }).catch(() => null) : null,
    consolidateMemoryNotes({
      sessionNotes: input.sessionNotes.map((n) => ({ ...n, createdAtISO: nowISO })),
      globalNotes: input.globalNotes.map((n) => ({ ...n, createdAtISO: n.createdAtISO ?? nowISO })),
    }),
  ]);

  return { title, summary, globalNotes };
}
